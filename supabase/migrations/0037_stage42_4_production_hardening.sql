-- Stage 42.4 production hardening
-- FIRMSGeoTools VERSION 1.0.0
-- schema_version 37
-- Keep SQL cache keys byte-compatible with JavaScript Number.toFixed(5).
CREATE OR REPLACE FUNCTION public.firewatch_area_report_cached(
  p_lat double precision,
  p_lon double precision,
  p_radius_m integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
with k as (
  select
    to_char(round(p_lat::numeric,5),'FM999990.00000')||':'||
    to_char(round(p_lon::numeric,5),'FM999990.00000')||':'||
    greatest(250,least(coalesce(p_radius_m,5000),10000))::text as query_key
)
select coalesce((
  select jsonb_build_object(
    'query_key',r.query_key,'latitude',r.latitude,'longitude',r.longitude,'radius_m',r.radius_m,
    'generated_at',r.generated_at,'status',r.status,'report',r.report,'source_status',r.source_status,'errors',r.errors
  )
  from public.area_osint_reports r
  where r.query_key=(select query_key from k)
),jsonb_build_object(
  'query_key',(select query_key from k),
  'status','not_cached'
));
$function$;

revoke all on function public.firewatch_area_report_cached(double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.firewatch_area_report_cached(double precision,double precision,integer) to service_role;
