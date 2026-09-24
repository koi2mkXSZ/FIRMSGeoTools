-- Stage 40.5 — Visual Verification Context
-- 2026-09-24

create table if not exists public.event_visual_context(
  fire_event_id uuid primary key references public.fire_events(id) on delete cascade,
  queried_at timestamptz not null default now(),
  status text not null default 'pending',
  panoramax_status text,
  panoramax_items jsonb not null default '[]'::jsonb,
  panoramax_nearest_distance_m double precision,
  oam_status text,
  oam_items jsonb not null default '[]'::jsonb,
  oam_latest_datetime timestamptz,
  errors jsonb not null default '[]'::jsonb,
  failure_count integer not null default 0,
  next_retry_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.event_visual_context enable row level security;
revoke all on table public.event_visual_context from anon,authenticated;
create index if not exists event_visual_context_status_idx
  on public.event_visual_context(status,queried_at desc);
create index if not exists event_visual_context_retry_idx
  on public.event_visual_context(next_retry_at);

insert into public.osint_source_catalog(
  source_key,label,provider,source_class,transport,homepage,geographic_scope,content_scope,
  enabled,requires_secret,independent_for_corroboration,notes
) values
 ('PANORAMAX','Panoramax','Panoramax / community instances','visual_reference','STAC API','https://panoramax.fr','instance-dependent','geolocated street-level photographs and metadata',true,false,false,'Stage 40.5 visual availability context only; not independent event corroboration without manual/visual review.'),
 ('OPENAERIALMAP','OpenAerialMap','Humanitarian OpenStreetMap Team','visual_reference','STAC API','https://openaerialmap.org','global','open satellite/UAV imagery availability and metadata',true,false,false,'Stage 40.5 visual availability context only; not event corroboration by itself.')
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
declare d jsonb; s jsonb; g jsonb; a jsonb; loc jsonb; vis jsonb;
begin
  d:=public.firewatch_deep_osint_stage401(p_query);
  if d is null then return null; end if;
  s:=public.firewatch_semantic_osint(p_query);
  g:=public.firewatch_osint_evidence_graph(p_query);
  a:=public.firewatch_air_context(p_query);
  loc:=public.firewatch_geolocation_context(p_query);
  vis:=public.firewatch_visual_context(p_query);

  return d
    || jsonb_build_object('semantic',coalesce(s,jsonb_build_object('summary',jsonb_build_object('items',0))))
    || jsonb_build_object('evidence_graph',coalesce(g,jsonb_build_object('nodes','[]'::jsonb,'edges','[]'::jsonb)))
    || jsonb_build_object('air_context',coalesce(a,jsonb_build_object('combined_context','unavailable')))
    || jsonb_build_object('geolocation',coalesce(loc,jsonb_build_object('status','not_cached')))
    || jsonb_build_object('visual_context',coalesce(vis,jsonb_build_object('status','not_cached')));
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_visual_context(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event uuid; c public.event_visual_context%rowtype;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event from public.fire_events order by last_seen desc limit 1;
  else
    select id into v_event from public.fire_events
    where lower(id::text) like lower(trim(p_query))||'%'
    order by last_seen desc limit 1;
  end if;
  if v_event is null then return null; end if;

  select * into c from public.event_visual_context where fire_event_id=v_event;
  if not found then
    return jsonb_build_object(
      'event_id',v_event,'status','not_cached',
      'panoramax',jsonb_build_object('status','not_cached','count',0),
      'openaerialmap',jsonb_build_object('status','not_cached','count',0)
    );
  end if;

  return jsonb_build_object(
    'event_id',v_event,
    'status',c.status,
    'queried_at',c.queried_at,
    'panoramax',jsonb_build_object(
      'status',c.panoramax_status,
      'count',jsonb_array_length(c.panoramax_items),
      'nearest_distance_m',c.panoramax_nearest_distance_m,
      'items',c.panoramax_items
    ),
    'openaerialmap',jsonb_build_object(
      'status',c.oam_status,
      'count',jsonb_array_length(c.oam_items),
      'latest_datetime',c.oam_latest_datetime,
      'items',c.oam_items
    ),
    'policy','Visual-source availability only. A nearby or overlapping image does not by itself confirm the event, its cause, or its effects.'
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_visual_context_health()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
select jsonb_build_object(
  'cached_events',(select count(*) from public.event_visual_context),
  'active',(select count(*) from public.event_visual_context where status='active'),
  'degraded',(select count(*) from public.event_visual_context where status='degraded'),
  'errors',(select count(*) from public.event_visual_context where status='error'),
  'events_with_panoramax',(select count(*) from public.event_visual_context where jsonb_array_length(panoramax_items)>0),
  'events_with_oam',(select count(*) from public.event_visual_context where jsonb_array_length(oam_items)>0),
  'latest_query',(select max(queried_at) from public.event_visual_context)
);
$function$
;



revoke all on function public.firewatch_visual_context(text) from public,anon,authenticated;
grant execute on function public.firewatch_visual_context(text) to service_role;
revoke all on function public.firewatch_visual_context_health() from public,anon,authenticated;
grant execute on function public.firewatch_visual_context_health() to service_role;
revoke all on function public.firewatch_deep_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint(text) to service_role;

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='firewatch-visual-context';
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule(
    'firewatch-visual-context','23 */6 * * *',
    $cron$
      select net.http_post(
        url := 'https://swvpqroxbsrmxdmedojd.supabase.co/functions/v1/firewatch-visual-context',
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
