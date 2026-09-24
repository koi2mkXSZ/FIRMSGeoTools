-- Stage 42.0 — Infrastructure & Area Intelligence
-- 2026-09-24

insert into public.osint_source_catalog(
  source_key,label,provider,source_class,transport,homepage,geographic_scope,content_scope,
  enabled,requires_secret,independent_for_corroboration,notes
) values
 ('OSM_AREA_INTEL','OpenStreetMap Area Intelligence','OpenStreetMap','geospatial_reference','Geofabrik Postpass','https://www.openstreetmap.org','global','infrastructure, public services, buildings, land use and transport context',true,false,false,'Stage 42.0. Primary area-context source. Descriptive geospatial context only; not event corroboration.'),
 ('OVERTURE_AREA_INTEL','Overture Area Intelligence','Overture Maps Foundation','geospatial_reference','Fused public mirror','https://overturemaps.org','global','cross-source infrastructure/place context',true,false,false,'Stage 42.0. Secondary context. Public Fused mirror currently lags official 2026-09-23.0 release; freshness is exposed explicitly.')
on conflict(source_key) do update set
 label=excluded.label,provider=excluded.provider,source_class=excluded.source_class,
 transport=excluded.transport,homepage=excluded.homepage,geographic_scope=excluded.geographic_scope,
 content_scope=excluded.content_scope,enabled=excluded.enabled,requires_secret=excluded.requires_secret,
 independent_for_corroboration=excluded.independent_for_corroboration,notes=excluded.notes,updated_at=now();

create table if not exists public.area_intel_cache(
  query_key text primary key,
  latitude double precision not null,
  longitude double precision not null,
  radius_m integer not null check(radius_m between 250 and 10000),
  queried_at timestamptz not null default now(),
  status text not null default 'active',
  osm_base_at timestamptz,
  source_status jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  features jsonb not null default '[]'::jsonb,
  buildings jsonb not null default '{}'::jsonb,
  nearest jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.area_intel_cache enable row level security;
revoke all on table public.area_intel_cache from anon,authenticated;
create index if not exists area_intel_cache_query_idx on public.area_intel_cache(queried_at desc);
create index if not exists area_intel_cache_coord_idx on public.area_intel_cache(latitude,longitude,radius_m);

CREATE OR REPLACE FUNCTION public.firewatch_area_intel_cached(p_lat double precision, p_lon double precision, p_radius_m integer DEFAULT 2000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r integer:=greatest(250,least(coalesce(p_radius_m,2000),10000));
declare k text:=round(p_lat::numeric,5)::text||':'||round(p_lon::numeric,5)::text||':'||r::text;
declare x public.area_intel_cache%rowtype;
begin
  select * into x from public.area_intel_cache where query_key=k;
  if not found then return jsonb_build_object(
    'query_key',k,'status','not_cached','latitude',p_lat,'longitude',p_lon,'radius_m',r
  ); end if;
  return jsonb_build_object(
    'query_key',x.query_key,'status',x.status,'latitude',x.latitude,'longitude',x.longitude,
    'radius_m',x.radius_m,'queried_at',x.queried_at,'osm_base_at',x.osm_base_at,
    'source_status',x.source_status,'summary',x.summary,'features',x.features,
    'buildings',x.buildings,'nearest',x.nearest,'errors',x.errors,
    'policy','Area intelligence is descriptive context. It does not score vulnerability, target value, accessibility or suitability for action.'
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_event_area_intel_cached(p_query text, p_radius_m integer DEFAULT 2000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare e public.fire_events%rowtype;
declare lat double precision; lon double precision;
begin
  select * into e from public.fire_events
  where lower(id::text) like lower(trim(p_query))||'%'
  order by last_seen desc limit 1;
  if not found then return null; end if;
  lat:=coalesce(e.best_latitude,e.last_latitude,e.first_latitude);
  lon:=coalesce(e.best_longitude,e.last_longitude,e.first_longitude);
  return public.firewatch_area_intel_cached(lat,lon,p_radius_m)
    || jsonb_build_object('event_id',e.id);
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_resolve_event_point(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare e record;
begin
  select id,last_seen,
         coalesce(best_latitude,last_latitude,first_latitude) latitude,
         coalesce(best_longitude,last_longitude,first_longitude) longitude
  into e
  from public.fire_events
  where lower(id::text) like lower(trim(p_query))||'%'
  order by last_seen desc
  limit 1;
  if not found then return null; end if;
  return jsonb_build_object('id',e.id,'last_seen',e.last_seen,'latitude',e.latitude,'longitude',e.longitude);
end;
$function$
;



revoke all on function public.firewatch_area_intel_cached(double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.firewatch_area_intel_cached(double precision,double precision,integer) to service_role;
revoke all on function public.firewatch_event_area_intel_cached(text,integer) from public,anon,authenticated;
grant execute on function public.firewatch_event_area_intel_cached(text,integer) to service_role;
revoke all on function public.firewatch_resolve_event_point(text) from public,anon,authenticated;
grant execute on function public.firewatch_resolve_event_point(text) to service_role;
