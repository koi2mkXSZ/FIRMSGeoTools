-- Stage 41.0 — Operational source wave: DSNS + RainViewer + MTG LI
-- 2026-09-24

insert into public.telegram_osint_sources(channel,label,source_tier,enabled,created_at,updated_at)
values ('dsns_telegram','ДСНС України','official',true,now(),now())
on conflict(channel) do update set label=excluded.label,source_tier=excluded.source_tier,enabled=true,updated_at=now();

insert into public.osint_source_catalog(
  source_key,label,provider,source_class,transport,homepage,geographic_scope,content_scope,
  enabled,requires_secret,independent_for_corroboration,notes
) values
 ('UA_DSNS_TELEGRAM','ДСНС України Telegram','ДСНС України','official_incident_report','Telegram public preview','https://t.me/dsns_telegram','Ukraine','official incident, fire and emergency reports',true,false,true,'Stage 41.0. Official DSNS public channel; event match still requires explicit geography + incident vocabulary + time proximity.'),
 ('RAINVIEWER_RADAR','RainViewer Radar','RainViewer','weather_radar','JSON + raster tiles','https://www.rainviewer.com','radar coverage dependent','precipitation radar context',true,false,false,'Stage 41.0. Weather context only; public API keeps about two hours, therefore GeoWatch maintains its own frame-metadata rolling archive.'),
 ('EUMETSAT_MTG_LI','MTG Lightning Imager','EUMETSAT','official_sensor','OpenSearch / Data Store','https://user.eumetsat.int','MTG full disk','NRT lightning flash products',true,false,false,'Stage 41.0. Product coverage metadata only until local flash points are extracted from LI NetCDF; product availability alone is not lightning corroboration.')
on conflict(source_key) do update set
 label=excluded.label,provider=excluded.provider,source_class=excluded.source_class,
 transport=excluded.transport,homepage=excluded.homepage,geographic_scope=excluded.geographic_scope,
 content_scope=excluded.content_scope,enabled=excluded.enabled,requires_secret=excluded.requires_secret,
 independent_for_corroboration=excluded.independent_for_corroboration,notes=excluded.notes,updated_at=now();

create table if not exists public.rainviewer_frames(
  frame_time timestamptz primary key,
  generated_at timestamptz,
  host text not null,
  path text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.rainviewer_frames enable row level security;
revoke all on table public.rainviewer_frames from anon,authenticated;
create index if not exists rainviewer_frames_time_idx on public.rainviewer_frames(frame_time desc);

create table if not exists public.eumetsat_li_products(
  product_id text primary key,
  sensing_start timestamptz not null,
  sensing_end timestamptz not null,
  published_at timestamptz,
  quicklook_url text,
  download_url text,
  product_type text,
  platform text,
  collection_id text not null default 'EO:EUM:DAT:0691',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.eumetsat_li_products enable row level security;
revoke all on table public.eumetsat_li_products from anon,authenticated;
create index if not exists eumetsat_li_products_time_idx on public.eumetsat_li_products(sensing_start desc,sensing_end desc);

create table if not exists public.event_environment_context(
  fire_event_id uuid primary key references public.fire_events(id) on delete cascade,
  queried_at timestamptz not null default now(),
  radar_status text,
  radar_frame_time timestamptz,
  radar_time_delta_minutes numeric,
  radar_tile_url text,
  lightning_status text,
  lightning_product_count integer not null default 0,
  lightning_products jsonb not null default '[]'::jsonb,
  lightning_local_signal text not null default 'not_extracted',
  errors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.event_environment_context enable row level security;
revoke all on table public.event_environment_context from anon,authenticated;
create index if not exists event_environment_context_query_idx on public.event_environment_context(queried_at desc);

CREATE OR REPLACE FUNCTION public.firewatch_deep_osint(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d jsonb; s jsonb; g jsonb; a jsonb; loc jsonb; vis jsonb; prov jsonb; env jsonb;
begin
  d:=public.firewatch_deep_osint_stage401(p_query);
  if d is null then return null; end if;
  s:=public.firewatch_semantic_osint(p_query);
  g:=public.firewatch_osint_evidence_graph(p_query);
  a:=public.firewatch_air_context(p_query);
  loc:=public.firewatch_geolocation_context(p_query);
  vis:=public.firewatch_visual_context(p_query);
  prov:=public.firewatch_provenance_summary(p_query);
  env:=public.firewatch_environment_context(p_query);

  return d
    || jsonb_build_object('semantic',coalesce(s,jsonb_build_object('summary',jsonb_build_object('items',0))))
    || jsonb_build_object('evidence_graph',coalesce(g,jsonb_build_object('nodes','[]'::jsonb,'edges','[]'::jsonb)))
    || jsonb_build_object('air_context',coalesce(a,jsonb_build_object('combined_context','unavailable')))
    || jsonb_build_object('geolocation',coalesce(loc,jsonb_build_object('status','not_cached')))
    || jsonb_build_object('visual_context',coalesce(vis,jsonb_build_object('status','not_cached')))
    || jsonb_build_object('provenance',coalesce(prov,jsonb_build_object('statements',0,'pending_reviews',0)))
    || jsonb_build_object('environment_context',coalesce(env,jsonb_build_object('status','not_cached')));
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_environment_context(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event uuid; c public.event_environment_context%rowtype;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event from public.fire_events order by last_seen desc limit 1;
  else
    select id into v_event from public.fire_events
    where lower(id::text) like lower(trim(p_query))||'%'
    order by last_seen desc limit 1;
  end if;
  if v_event is null then return null; end if;

  select * into c from public.event_environment_context where fire_event_id=v_event;
  if not found then
    return jsonb_build_object(
      'event_id',v_event,'status','not_cached',
      'radar',jsonb_build_object('status','not_cached'),
      'lightning',jsonb_build_object('status','not_cached')
    );
  end if;

  return jsonb_build_object(
    'event_id',v_event,
    'status','active',
    'queried_at',c.queried_at,
    'radar',jsonb_build_object(
      'status',c.radar_status,
      'frame_time',c.radar_frame_time,
      'time_delta_minutes',c.radar_time_delta_minutes,
      'tile_url',c.radar_tile_url,
      'source','RainViewer'
    ),
    'lightning',jsonb_build_object(
      'status',c.lightning_status,
      'collection','EO:EUM:DAT:0691',
      'product_count',c.lightning_product_count,
      'products',c.lightning_products,
      'local_signal',c.lightning_local_signal,
      'source','EUMETSAT MTG LI'
    ),
    'policy','Weather-radar and lightning-data coverage are context only. LI product availability does not mean lightning occurred at the event location; local flash extraction is not yet enabled.'
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_environment_health()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
select jsonb_build_object(
  'radar_frames',(select count(*) from public.rainviewer_frames),
  'radar_earliest',(select min(frame_time) from public.rainviewer_frames),
  'radar_latest',(select max(frame_time) from public.rainviewer_frames),
  'li_products',(select count(*) from public.eumetsat_li_products),
  'li_earliest',(select min(sensing_start) from public.eumetsat_li_products),
  'li_latest',(select max(sensing_end) from public.eumetsat_li_products),
  'event_contexts',(select count(*) from public.event_environment_context),
  'latest_query',(select max(queried_at) from public.event_environment_context)
);
$function$
;



revoke all on function public.firewatch_environment_context(text) from public,anon,authenticated;
grant execute on function public.firewatch_environment_context(text) to service_role;
revoke all on function public.firewatch_environment_health() from public,anon,authenticated;
grant execute on function public.firewatch_environment_health() to service_role;
revoke all on function public.firewatch_deep_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint(text) to service_role;

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='firewatch-environment-context';
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule(
    'firewatch-environment-context','4,14,24,34,44,54 * * * *',
    $cron$
      select net.http_post(
        url := 'https://swvpqroxbsrmxdmedojd.supabase.co/functions/v1/firewatch-environment-context',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='firewatch_cron_secret' limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 90000
      );
    $cron$
  );
end $$;
