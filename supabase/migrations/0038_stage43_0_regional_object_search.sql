-- Stage 43.0 — Regional Object Search
-- FIRMSGeoTools VERSION 1.0.0
-- schema_version 38
-- Polygon-scoped category search across Ukrainian oblasts.

create table if not exists public.regional_object_search_cache (
  query_key text primary key,
  oblast_id bigint not null references public.oblasts(id) on delete cascade,
  oblast_code text not null,
  oblast_name text not null,
  category_key text not null,
  queried_at timestamptz not null default now(),
  status text not null default 'active',
  source_status jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  objects jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists regional_object_search_cache_oblast_category_idx
  on public.regional_object_search_cache(oblast_id,category_key);

alter table public.regional_object_search_cache enable row level security;
revoke all on table public.regional_object_search_cache from public,anon,authenticated;
grant select,insert,update,delete on table public.regional_object_search_cache to service_role;

create or replace function public.firewatch_oblast_geometry(p_oblast_id bigint)
returns jsonb
language sql
stable security definer
set search_path to 'public','extensions','pg_temp'
as $function$
select jsonb_build_object(
  'id',o.id,
  'code',o.code,
  'name',o.name,
  'name_uk',o.name_uk,
  'name_en',o.name_en,
  'bbox',jsonb_build_array(
    st_xmin(box2d(o.geom)),
    st_ymin(box2d(o.geom)),
    st_xmax(box2d(o.geom)),
    st_ymax(box2d(o.geom))
  ),
  'center',jsonb_build_object(
    'longitude',st_x(st_pointonsurface(o.geom)),
    'latitude',st_y(st_pointonsurface(o.geom))
  ),
  'geometry',st_asgeojson(o.geom,6)::jsonb
)
from public.oblasts o
where o.id=p_oblast_id
limit 1;
$function$;

revoke all on function public.firewatch_oblast_geometry(bigint) from public,anon,authenticated;
grant execute on function public.firewatch_oblast_geometry(bigint) to service_role;

create or replace function public.firewatch_regional_search_cached(
  p_oblast_id bigint,
  p_category_key text
)
returns jsonb
language sql
stable security definer
set search_path to 'public','pg_temp'
as $function$
select coalesce((
  select jsonb_build_object(
    'query_key',c.query_key,
    'oblast_id',c.oblast_id,
    'oblast_code',c.oblast_code,
    'oblast_name',c.oblast_name,
    'category_key',c.category_key,
    'queried_at',c.queried_at,
    'status',c.status,
    'source_status',c.source_status,
    'summary',c.summary,
    'objects',c.objects,
    'errors',c.errors
  )
  from public.regional_object_search_cache c
  where c.oblast_id=p_oblast_id
    and c.category_key=lower(trim(p_category_key))
),jsonb_build_object('status','not_cached'));
$function$;

revoke all on function public.firewatch_regional_search_cached(bigint,text) from public,anon,authenticated;
grant execute on function public.firewatch_regional_search_cached(bigint,text) to service_role;
