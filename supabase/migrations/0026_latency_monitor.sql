-- Source / Delivery Latency Monitor
-- 2026-09-24

CREATE OR REPLACE FUNCTION public.firewatch_event_latency(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event uuid;
begin
  select id into v_event
  from public.fire_events
  where lower(id::text) like lower(trim(p_query))||'%'
  order by last_seen desc limit 1;

  if v_event is null then return null; end if;

  return (
    with d as (
      select
        source,acq_datetime,received_at,
        greatest(0,extract(epoch from (received_at-acq_datetime))/60.0) source_latency_min
      from public.detections
      where event_id=v_event
      order by acq_datetime
    ),
    e as (
      select e.*, (select min(received_at) from public.detections where event_id=v_event) first_received_at
      from public.fire_events e where e.id=v_event
    )
    select jsonb_build_object(
      'event_id',v_event,
      'first_seen',e.first_seen,
      'first_received_at',e.first_received_at,
      'telegram_sent_at',e.telegram_sent_at,
      'telegram_sent',e.telegram_sent,
      'notification_required',e.notification_required,
      'source_latency_min',coalesce((select round(max(source_latency_min)::numeric,1) from d),0),
      'delivery_latency_min',case when e.telegram_sent_at is not null and e.first_received_at is not null
        then round((extract(epoch from (e.telegram_sent_at-e.first_received_at))/60.0)::numeric,1) end,
      'end_to_end_latency_min',case when e.telegram_sent_at is not null
        then round((extract(epoch from (e.telegram_sent_at-e.first_seen))/60.0)::numeric,1) end,
      'detections',coalesce((select jsonb_agg(jsonb_build_object(
        'source',source,'acq_datetime',acq_datetime,'received_at',received_at,
        'source_latency_min',round(source_latency_min::numeric,1)
      ) order by acq_datetime) from d),'[]'::jsonb)
    )
    from e
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_latency_health(p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  h integer:=greatest(1,least(coalesce(p_hours,24),168));
begin
  return (
    with det as (
      select
        d.id,d.event_id,d.source,d.acq_datetime,d.received_at,
        greatest(0,extract(epoch from (d.received_at-d.acq_datetime))/60.0) source_latency_min
      from public.detections d
      where d.received_at>=now()-(h||' hours')::interval
        and d.acq_datetime is not null
        and d.received_at is not null
    ),
    ev as (
      select
        e.id,e.first_seen,e.telegram_sent_at,e.telegram_sent,e.notification_required,
        min(d.received_at) first_received_at,
        greatest(0,extract(epoch from (e.telegram_sent_at-min(d.received_at)))/60.0) delivery_latency_min,
        greatest(0,extract(epoch from (e.telegram_sent_at-e.first_seen))/60.0) end_to_end_latency_min
      from public.fire_events e
      join public.detections d on d.event_id=e.id
      where e.first_seen>=now()-(h||' hours')::interval
      group by e.id
    ),
    src as (
      select source,
             count(*) detections,
             round(avg(source_latency_min)::numeric,1) avg_min,
             round(percentile_cont(0.50) within group(order by source_latency_min)::numeric,1) p50_min,
             round(percentile_cont(0.95) within group(order by source_latency_min)::numeric,1) p95_min,
             round(max(source_latency_min)::numeric,1) max_min,
             count(*) filter(where source_latency_min>90) over_90m
      from det
      group by source
    )
    select jsonb_build_object(
      'window_hours',h,
      'thresholds',jsonb_build_object('source_latency_warn_min',90,'delivery_latency_warn_min',10),
      'detections',jsonb_build_object(
        'count',(select count(*) from det),
        'avg_min',coalesce((select round(avg(source_latency_min)::numeric,1) from det),0),
        'p50_min',coalesce((select round(percentile_cont(0.50) within group(order by source_latency_min)::numeric,1) from det),0),
        'p95_min',coalesce((select round(percentile_cont(0.95) within group(order by source_latency_min)::numeric,1) from det),0),
        'max_min',coalesce((select round(max(source_latency_min)::numeric,1) from det),0),
        'over_90m',(select count(*) from det where source_latency_min>90)
      ),
      'delivery',jsonb_build_object(
        'published_events',(select count(*) from ev where telegram_sent and telegram_sent_at is not null),
        'required_unsent',(select count(*) from ev where notification_required and not coalesce(telegram_sent,false)),
        'avg_min',coalesce((select round(avg(delivery_latency_min)::numeric,1) from ev where telegram_sent_at is not null),0),
        'p50_min',coalesce((select round(percentile_cont(0.50) within group(order by delivery_latency_min)::numeric,1) from ev where telegram_sent_at is not null),0),
        'p95_min',coalesce((select round(percentile_cont(0.95) within group(order by delivery_latency_min)::numeric,1) from ev where telegram_sent_at is not null),0),
        'max_min',coalesce((select round(max(delivery_latency_min)::numeric,1) from ev where telegram_sent_at is not null),0),
        'over_10m',(select count(*) from ev where telegram_sent_at is not null and delivery_latency_min>10),
        'end_to_end_p95_min',coalesce((select round(percentile_cont(0.95) within group(order by end_to_end_latency_min)::numeric,1) from ev where telegram_sent_at is not null),0)
      ),
      'by_source',coalesce((select jsonb_agg(to_jsonb(src) order by p95_min desc nulls last,source) from src),'[]'::jsonb),
      'worst_source',coalesce((
        select jsonb_agg(jsonb_build_object(
          'event_id',event_id,'source',source,'acq_datetime',acq_datetime,'received_at',received_at,
          'latency_min',round(source_latency_min::numeric,1)
        ) order by source_latency_min desc)
        from (select * from det order by source_latency_min desc limit 10) x
      ),'[]'::jsonb),
      'worst_delivery',coalesce((
        select jsonb_agg(jsonb_build_object(
          'event_id',id,'first_received_at',first_received_at,'telegram_sent_at',telegram_sent_at,
          'delivery_latency_min',round(delivery_latency_min::numeric,1),
          'end_to_end_latency_min',round(end_to_end_latency_min::numeric,1)
        ) order by delivery_latency_min desc)
        from (select * from ev where telegram_sent_at is not null order by delivery_latency_min desc limit 10) x
      ),'[]'::jsonb),
      'generated_at',now()
    )
  );
end;
$function$
;



revoke all on function public.firewatch_latency_health(integer) from public,anon,authenticated;
grant execute on function public.firewatch_latency_health(integer) to service_role;
revoke all on function public.firewatch_event_latency(text) from public,anon,authenticated;
grant execute on function public.firewatch_event_latency(text) to service_role;
