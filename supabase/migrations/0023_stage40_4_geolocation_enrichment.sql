-- Stage 40.4 — Geolocation Enrichment Layer
-- 2026-09-24

create table if not exists public.event_geolocation_context(
  fire_event_id uuid primary key references public.fire_events(id) on delete cascade,
  queried_at timestamptz not null default now(),
  status text not null default 'pending',
  overture_status text,
  overture_release text,
  overture_places jsonb not null default '[]'::jsonb,
  overture_nearest_distance_m double precision,
  overture_tiles_ok integer,
  overture_tiles_total integer,
  geonames_status text,
  geonames_places jsonb not null default '[]'::jsonb,
  geonames_nearest_distance_m double precision,
  errors jsonb not null default '[]'::jsonb,
  failure_count integer not null default 0,
  next_retry_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.event_geolocation_context enable row level security;
revoke all on table public.event_geolocation_context from anon,authenticated;
create index if not exists event_geolocation_context_status_idx
  on public.event_geolocation_context(status,queried_at desc);
create index if not exists event_geolocation_context_retry_idx
  on public.event_geolocation_context(next_retry_at);

insert into public.osint_source_catalog(
  source_key,label,provider,source_class,transport,homepage,geographic_scope,content_scope,
  enabled,requires_secret,independent_for_corroboration,notes
) values
 ('OVERTURE_PLACES','Overture Maps Places','Overture Maps Foundation','geospatial_reference','Fused public mirror / Overture data','https://overturemaps.org','global','places, facilities, businesses, landmarks and public POI',true,false,true,'Stage 40.4. Transport is Fused public UDF; Overture data provenance retained separately.'),
 ('GEONAMES','GeoNames','GeoNames','geospatial_reference','REST API','https://www.geonames.org','global','toponyms, populated places, administrative names and alternate names',true,true,true,'Stage 40.4. GeoNames REST requires a free username; connector is fail-soft when absent.')
on conflict(source_key) do update set
 label=excluded.label,provider=excluded.provider,source_class=excluded.source_class,
 transport=excluded.transport,homepage=excluded.homepage,geographic_scope=excluded.geographic_scope,
 content_scope=excluded.content_scope,enabled=excluded.enabled,requires_secret=excluded.requires_secret,
 independent_for_corroboration=excluded.independent_for_corroboration,notes=excluded.notes,updated_at=now();

CREATE OR REPLACE FUNCTION public.firewatch_deep_osint(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d jsonb; s jsonb; g jsonb; a jsonb; loc jsonb;
begin
  d:=public.firewatch_deep_osint_stage401(p_query);
  if d is null then return null; end if;
  s:=public.firewatch_semantic_osint(p_query);
  g:=public.firewatch_osint_evidence_graph(p_query);
  a:=public.firewatch_air_context(p_query);
  loc:=public.firewatch_geolocation_context(p_query);

  return d
    || jsonb_build_object('semantic',coalesce(s,jsonb_build_object('summary',jsonb_build_object('items',0))))
    || jsonb_build_object('evidence_graph',coalesce(g,jsonb_build_object('nodes','[]'::jsonb,'edges','[]'::jsonb)))
    || jsonb_build_object('air_context',coalesce(a,jsonb_build_object('combined_context','unavailable')))
    || jsonb_build_object('geolocation',coalesce(loc,jsonb_build_object('status','not_cached')));
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_geolocation_context(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event uuid; c public.event_geolocation_context%rowtype;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event from public.fire_events order by last_seen desc limit 1;
  else
    select id into v_event from public.fire_events
    where lower(id::text) like lower(trim(p_query))||'%'
    order by last_seen desc limit 1;
  end if;
  if v_event is null then return null; end if;

  select * into c from public.event_geolocation_context where fire_event_id=v_event;
  if not found then
    return jsonb_build_object(
      'event_id',v_event,
      'status','not_cached',
      'overture',jsonb_build_object('status','not_cached'),
      'geonames',jsonb_build_object('status','not_cached')
    );
  end if;

  return jsonb_build_object(
    'event_id',v_event,
    'status',c.status,
    'queried_at',c.queried_at,
    'overture',jsonb_build_object(
      'status',c.overture_status,
      'release',c.overture_release,
      'places',c.overture_places,
      'nearest_distance_m',c.overture_nearest_distance_m,
      'tiles_ok',c.overture_tiles_ok,
      'tiles_total',c.overture_tiles_total,
      'transport','Fused public UDF mirror'
    ),
    'geonames',jsonb_build_object(
      'status',c.geonames_status,
      'places',c.geonames_places,
      'nearest_distance_m',c.geonames_nearest_distance_m
    ),
    'policy','Geospatial reference context only. Nearby place or infrastructure does not establish that the event occurred at, affected, or was caused by that feature.'
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_geolocation_health()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
select jsonb_build_object(
  'cached_events',(select count(*) from public.event_geolocation_context),
  'active',(select count(*) from public.event_geolocation_context where status='active'),
  'degraded',(select count(*) from public.event_geolocation_context where status='degraded'),
  'errors',(select count(*) from public.event_geolocation_context where status='error'),
  'latest_query',(select max(queried_at) from public.event_geolocation_context),
  'events_with_overture_places',(select count(*) from public.event_geolocation_context where jsonb_array_length(overture_places)>0),
  'geonames_configured',(select coalesce((value->>'geonames_status')='configured',false) from public.system_state where key='monitor_geolocation')
);
$function$
;



revoke all on function public.firewatch_geolocation_context(text) from public,anon,authenticated;
grant execute on function public.firewatch_geolocation_context(text) to service_role;
revoke all on function public.firewatch_geolocation_health() from public,anon,authenticated;
grant execute on function public.firewatch_geolocation_health() to service_role;
revoke all on function public.firewatch_deep_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint(text) to service_role;

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='firewatch-geolocation';
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule(
    'firewatch-geolocation','12 * * * *',
    $cron$
      select net.http_post(
        url := 'https://swvpqroxbsrmxdmedojd.supabase.co/functions/v1/firewatch-geolocation',
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
