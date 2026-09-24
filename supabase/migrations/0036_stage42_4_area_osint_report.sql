-- Stage 42.4 — Area OSINT Report
-- 2026-09-24
create table if not exists public.area_osint_reports(
  query_key text primary key,
  latitude double precision not null,
  longitude double precision not null,
  radius_m integer not null check(radius_m between 250 and 10000),
  generated_at timestamptz not null default now(),
  status text not null default 'active',
  report jsonb not null default '{}'::jsonb,
  source_status jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.area_osint_reports enable row level security;
revoke all on table public.area_osint_reports from anon,authenticated;
create index if not exists area_osint_reports_generated_idx on public.area_osint_reports(generated_at desc);

CREATE OR REPLACE FUNCTION public.firewatch_area_osint_nearby(p_lat double precision, p_lon double precision, p_radius_m integer DEFAULT 5000, p_hours integer DEFAULT 168, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
with params as (
  select
    ST_SetSRID(ST_MakePoint(p_lon,p_lat),4326)::geography g,
    greatest(250,least(coalesce(p_radius_m,5000),10000))::double precision r,
    greatest(1,least(coalesce(p_hours,168),8760)) h,
    greatest(1,least(coalesce(p_limit,30),100)) lim
),
docs as (
  select 'document'::text kind,d.id,d.source_key source,d.title,d.url source_url,d.published_at observed_at,
         ST_Distance(d.location,p.g)::double precision distance_m,
         d.summary,null::text category
  from public.osint_documents d,params p
  where d.location is not null
    and ST_DWithin(d.location,p.g,p.r)
    and coalesce(d.published_at,d.first_seen_at) >= now()-(p.h||' hours')::interval
  order by coalesce(d.published_at,d.first_seen_at) desc
  limit (select lim from params)
),
ev as (
  select 'evidence'::text kind,e.id,e.source,e.title,e.source_url,e.observed_at,
         ST_Distance(e.location,p.g)::double precision distance_m,
         null::text summary,e.category
  from public.osint_evidence e,params p
  where e.location is not null
    and ST_DWithin(e.location,p.g,p.r)
    and coalesce(e.observed_at,e.first_ingested_at) >= now()-(p.h||' hours')::interval
  order by coalesce(e.observed_at,e.first_ingested_at) desc
  limit (select lim from params)
),
u as (
  select * from docs
  union all
  select * from ev
),
ranked as (
  select * from u order by observed_at desc nulls last,distance_m asc limit (select lim from params)
)
select jsonb_build_object(
  'count',(select count(*) from ranked),
  'providers',coalesce((select jsonb_agg(x.source order by x.source) from (select distinct source from ranked where source is not null) x),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'kind',kind,'id',id,'source',source,'title',title,'url',source_url,'observed_at',observed_at,
    'distance_m',round(distance_m::numeric,0),'category',category,'summary',left(summary,600)
  ) order by observed_at desc nulls last,distance_m asc) from ranked),'[]'::jsonb)
);
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_area_registry_summary(p_query_key text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
select jsonb_build_object(
  'entities_with_hits',count(distinct h.entity_id),
  'hit_count',count(h.id),
  'confirmed',count(*) filter(where h.match_status='confirmed'),
  'probable',count(*) filter(where h.match_status='probable'),
  'candidate',count(*) filter(where h.match_status='candidate'),
  'hits',coalesce(jsonb_agg(jsonb_build_object(
     'entity_id',e.id,'entity_name',e.canonical_name,'source_key',h.source_key,'title',h.title,
     'publisher',h.publisher,'url',coalesce(h.landing_url,h.resource_url),
     'status',h.match_status,'confidence',h.match_confidence
  ) order by h.match_confidence desc,h.last_seen_at desc) filter(where h.id is not null),'[]'::jsonb)
)
from public.area_entities e
left join public.area_entity_registry_hits h on h.entity_id=e.id and h.match_status<>'rejected'
where e.query_key=p_query_key;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_area_report_cached(p_lat double precision, p_lon double precision, p_radius_m integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
select coalesce((
  select jsonb_build_object(
    'query_key',r.query_key,'latitude',r.latitude,'longitude',r.longitude,'radius_m',r.radius_m,
    'generated_at',r.generated_at,'status',r.status,'report',r.report,'source_status',r.source_status,'errors',r.errors
  )
  from public.area_osint_reports r
  where r.query_key=round(p_lat::numeric,5)::text||':'||round(p_lon::numeric,5)::text||':'||
    greatest(250,least(coalesce(p_radius_m,5000),10000))::text
),jsonb_build_object(
  'query_key',round(p_lat::numeric,5)::text||':'||round(p_lon::numeric,5)::text||':'||
    greatest(250,least(coalesce(p_radius_m,5000),10000))::text,
  'status','not_cached'
));
$function$
;



revoke all on function public.firewatch_area_osint_nearby(double precision,double precision,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.firewatch_area_osint_nearby(double precision,double precision,integer,integer,integer) to service_role;
revoke all on function public.firewatch_area_registry_summary(text) from public,anon,authenticated;
grant execute on function public.firewatch_area_registry_summary(text) to service_role;
revoke all on function public.firewatch_area_report_cached(double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.firewatch_area_report_cached(double precision,double precision,integer) to service_role;
