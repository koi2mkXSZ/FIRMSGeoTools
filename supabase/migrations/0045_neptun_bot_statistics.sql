-- FIRMSGeoTools VERSION 1.0.0
-- schema_version 45
-- Neptun statistics for bot analytics
-- 2026-09-25

create or replace function public.firewatch_neptun_stats(p_hours integer default 24)
returns jsonb
language sql
security definer
set search_path = public
as $$
with p as (
  select greatest(1,least(coalesce(p_hours,24),8760))::int as hours
),
rows as (
  select
    fire_event_id,
    lower(coalesce(threat_type,'')) as threat_type,
    time_offset_seconds,
    nearest_at
  from public.event_air_threat_context,p
  where source_name='Neptun'
    and nearest_at >= now() - make_interval(hours => p.hours)
),
agg as (
  select
    count(*)::int as correlations,
    count(distinct fire_event_id)::int as events,
    count(*) filter (where time_offset_seconds < 0)::int as before_firms,
    count(*) filter (where time_offset_seconds = 0)::int as simultaneous,
    count(*) filter (where time_offset_seconds > 0)::int as after_firms,
    count(*) filter (where threat_type='shahed')::int as shahed,
    count(*) filter (where threat_type='raketa')::int as raketa,
    count(*) filter (where threat_type='rozved')::int as rozved,
    count(*) filter (where threat_type not in ('shahed','raketa','rozved'))::int as other,
    round(avg(abs(time_offset_seconds))/60.0,1) as avg_abs_offset_minutes,
    round(min(abs(time_offset_seconds))/60.0,1) as closest_abs_offset_minutes
  from rows
)
select jsonb_build_object(
  'hours',(select hours from p),
  'correlations',correlations,
  'events',events,
  'before_firms',before_firms,
  'simultaneous',simultaneous,
  'after_firms',after_firms,
  'types',jsonb_build_object('shahed',shahed,'raketa',raketa,'rozved',rozved,'other',other),
  'avg_abs_offset_minutes',avg_abs_offset_minutes,
  'closest_abs_offset_minutes',closest_abs_offset_minutes
) from agg;
$$;

revoke all on function public.firewatch_neptun_stats(integer) from public,anon,authenticated;
grant execute on function public.firewatch_neptun_stats(integer) to service_role;
