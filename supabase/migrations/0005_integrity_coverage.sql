-- FIRMSGeoTools Community Edition
-- Clean Core schema v0.5: notification integrity, source coverage/baseline, geographic integrity.

create table if not exists public.notification_integrity_findings(
  fire_event_id uuid primary key references public.fire_events(id) on delete cascade,
  finding_class text not null check(finding_class in('notification_gap','delivery_backlog','bootstrap_suppressed','other_suppressed')),
  severity text not null check(severity in('error','warning','info')),
  reason text not null,
  sources text[] not null default '{}',
  detection_count integer not null default 0,
  first_detection timestamptz,
  last_detection timestamptz,
  event_first_seen timestamptz,
  event_last_seen timestamptz,
  refreshed_at timestamptz not null default now()
);

create index if not exists notification_integrity_findings_class_idx
on public.notification_integrity_findings(finding_class,severity,refreshed_at desc);

alter table public.notification_integrity_findings enable row level security;
revoke all on public.notification_integrity_findings from public,anon,authenticated;
grant select,insert,update,delete on public.notification_integrity_findings to service_role;

create or replace function public.firewatch_notification_integrity_refresh()
returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_now timestamptz:=now();
  v_bootstrap_done boolean:=false;
  v_completed_at timestamptz;
  v_errors integer:=0; v_warnings integer:=0; v_info integer:=0;
begin
  select coalesce((value->>'done')::boolean,false),nullif(value->>'completed_at','')::timestamptz
  into v_bootstrap_done,v_completed_at
  from public.system_state where key='bootstrap';

  delete from public.notification_integrity_findings where fire_event_id is not null;

  insert into public.notification_integrity_findings(
    fire_event_id,finding_class,severity,reason,sources,detection_count,
    first_detection,last_detection,event_first_seen,event_last_seen,refreshed_at
  )
  with det as (
    select e.id,e.first_seen,e.last_seen,e.created_at,e.notification_required,e.telegram_sent,
           array_agg(distinct d.source order by d.source) sources,
           count(*)::int detection_count,min(d.acq_datetime) first_detection,max(d.acq_datetime) last_detection,
           bool_or(d.acq_datetime>=v_now-interval '24 hours') fresh_detection
    from public.fire_events e
    join public.detections d on d.event_id=e.id
    group by e.id
  ), classified as (
    select d.*,
      case
        when v_bootstrap_done and d.fresh_detection and not d.notification_required and not d.telegram_sent
             and (v_completed_at is null or d.first_seen>=v_completed_at)
          then 'notification_gap'
        when d.notification_required and not d.telegram_sent and d.first_seen<v_now-interval '45 minutes'
          then 'delivery_backlog'
        when not d.notification_required and not d.telegram_sent
             and v_completed_at is not null and d.first_seen<v_completed_at
          then 'bootstrap_suppressed'
        when not d.notification_required and not d.telegram_sent
          then 'other_suppressed'
        else null
      end finding_class
    from det d
  )
  select id,finding_class,
    case finding_class when 'notification_gap' then 'error' when 'delivery_backlog' then 'warning' else 'info' end,
    case finding_class
      when 'notification_gap' then 'Fresh post-bootstrap FIRMS event is suppressed and unsent.'
      when 'delivery_backlog' then 'Notification-required event has remained unsent for more than 45 minutes.'
      when 'bootstrap_suppressed' then 'Historical event was intentionally suppressed during first-run bootstrap.'
      else 'Event is suppressed by current notification state.'
    end,
    sources,detection_count,first_detection,last_detection,first_seen,last_seen,v_now
  from classified where finding_class is not null;

  select count(*) filter(where severity='error')::int,
         count(*) filter(where severity='warning')::int,
         count(*) filter(where severity='info')::int
  into v_errors,v_warnings,v_info
  from public.notification_integrity_findings;

  insert into public.system_state(key,value,updated_at)
  values('monitor_notification_integrity',jsonb_build_object(
    'status',case when v_errors>0 then 'error' when v_warnings>0 then 'degraded' else 'active' end,
    'last_success_run',v_now,
    'errors',v_errors,'warnings',v_warnings,'info',v_info,
    'notification_gaps',(select count(*) from public.notification_integrity_findings where finding_class='notification_gap'),
    'delivery_backlog',(select count(*) from public.notification_integrity_findings where finding_class='delivery_backlog'),
    'bootstrap_suppressed',(select count(*) from public.notification_integrity_findings where finding_class='bootstrap_suppressed')
  ),v_now)
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  return (select value from public.system_state where key='monitor_notification_integrity');
end $$;

create or replace function public.firewatch_notification_integrity_summary()
returns jsonb
language sql security definer
set search_path=public,pg_temp
as $$
select jsonb_build_object(
  'state',coalesce((select value from public.system_state where key='monitor_notification_integrity'),'{}'::jsonb),
  'findings',coalesce((
    select jsonb_agg(jsonb_build_object(
      'event_id',fire_event_id,'class',finding_class,'severity',severity,'reason',reason,
      'sources',sources,'detection_count',detection_count,'first_detection',first_detection,
      'last_detection',last_detection,'first_seen',event_first_seen,'last_seen',event_last_seen
    ) order by case severity when 'error' then 0 when 'warning' then 1 else 2 end,last_detection desc)
    from (select * from public.notification_integrity_findings
          order by case severity when 'error' then 0 when 'warning' then 1 else 2 end,last_detection desc
          limit 50) x
  ),'[]'::jsonb)
);
$$;

create table if not exists public.source_coverage_current(
  source_id text primary key references public.firms_sources(source_id) on delete cascade,
  source_label text not null,
  status text not null check(status in('active','stale','error','empty_fetch','unknown')),
  activity text not null check(activity in('observed','quiet','unknown')),
  worker_last_success timestamptz,
  worker_age_minutes numeric,
  worker_stale_after_minutes integer not null,
  fetched_last_run integer,
  recent_last_run integer,
  detections_1h integer not null default 0,
  detections_6h integer not null default 0,
  detections_24h integer not null default 0,
  latest_detection timestamptz,
  latest_received timestamptz,
  last_error text,
  refreshed_at timestamptz not null default now()
);

create table if not exists public.source_coverage_hourly(
  bucket_hour timestamptz not null,
  source_id text not null,
  source_label text not null,
  status text not null,
  activity text not null,
  worker_age_minutes numeric,
  fetched_last_run integer,
  recent_last_run integer,
  detections_1h integer not null default 0,
  detections_6h integer not null default 0,
  detections_24h integer not null default 0,
  latest_detection timestamptz,
  latest_received timestamptz,
  captured_at timestamptz not null default now(),
  primary key(bucket_hour,source_id)
);

alter table public.source_coverage_current enable row level security;
alter table public.source_coverage_hourly enable row level security;
revoke all on public.source_coverage_current,public.source_coverage_hourly from public,anon,authenticated;
grant select,insert,update,delete on public.source_coverage_current,public.source_coverage_hourly to service_role;

create or replace function public.firewatch_source_coverage_refresh()
returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_now timestamptz:=now();
  v_bucket timestamptz:=date_trunc('hour',v_now);
  v_worker jsonb;
  v_last_success timestamptz;
  v_last_error text;
  v_stale_min integer;
  v_total integer:=0; v_active integer:=0; v_degraded integer:=0; v_quiet integer:=0;
begin
  select value into v_worker from public.system_state where key='monitor_firms';
  v_last_success:=nullif(v_worker->>'last_success_run','')::timestamptz;
  v_last_error:=nullif(v_worker->>'last_error','');
  select greatest(20,poll_interval_minutes*3) into v_stale_min from public.project_config where id=true;

  with src as (
    select f.source_id,f.display_name,
           x.fetched_last_run,x.recent_last_run
    from public.firms_sources f
    left join lateral (
      select nullif(j->>'fetched','')::integer fetched_last_run,
             nullif(j->>'recent','')::integer recent_last_run
      from jsonb_array_elements(coalesce(v_worker->'sources','[]'::jsonb)) j
      where j->>'source'=f.source_id
      limit 1
    ) x on true
    where f.enabled
  ), det as (
    select s.source_id,
      count(d.*) filter(where d.acq_datetime>=v_now-interval '1 hour')::int detections_1h,
      count(d.*) filter(where d.acq_datetime>=v_now-interval '6 hours')::int detections_6h,
      count(d.*) filter(where d.acq_datetime>=v_now-interval '24 hours')::int detections_24h,
      max(d.acq_datetime) latest_detection,max(d.received_at) latest_received
    from src s left join public.detections d on d.source=s.source_id
    group by s.source_id
  ), calc as (
    select s.source_id,s.display_name,
      v_last_success worker_last_success,
      case when v_last_success is null then null else round((extract(epoch from(v_now-v_last_success))/60)::numeric,1) end worker_age_minutes,
      s.fetched_last_run,s.recent_last_run,
      coalesce(d.detections_1h,0) detections_1h,coalesce(d.detections_6h,0) detections_6h,
      coalesce(d.detections_24h,0) detections_24h,d.latest_detection,d.latest_received
    from src s left join det d using(source_id)
  )
  insert into public.source_coverage_current(
    source_id,source_label,status,activity,worker_last_success,worker_age_minutes,worker_stale_after_minutes,
    fetched_last_run,recent_last_run,detections_1h,detections_6h,detections_24h,
    latest_detection,latest_received,last_error,refreshed_at
  )
  select source_id,display_name,
    case
      when v_last_error is not null then 'error'
      when worker_last_success is null then 'unknown'
      when worker_age_minutes>v_stale_min then 'stale'
      when fetched_last_run=0 then 'empty_fetch'
      when fetched_last_run is null then 'unknown'
      else 'active'
    end,
    case when latest_detection is null then 'unknown' when detections_24h=0 then 'quiet' else 'observed' end,
    worker_last_success,worker_age_minutes,v_stale_min,
    fetched_last_run,recent_last_run,detections_1h,detections_6h,detections_24h,
    latest_detection,latest_received,v_last_error,v_now
  from calc
  on conflict(source_id) do update set
    source_label=excluded.source_label,status=excluded.status,activity=excluded.activity,
    worker_last_success=excluded.worker_last_success,worker_age_minutes=excluded.worker_age_minutes,
    worker_stale_after_minutes=excluded.worker_stale_after_minutes,
    fetched_last_run=excluded.fetched_last_run,recent_last_run=excluded.recent_last_run,
    detections_1h=excluded.detections_1h,detections_6h=excluded.detections_6h,detections_24h=excluded.detections_24h,
    latest_detection=excluded.latest_detection,latest_received=excluded.latest_received,
    last_error=excluded.last_error,refreshed_at=excluded.refreshed_at;

  delete from public.source_coverage_current c
  where not exists(select 1 from public.firms_sources f where f.source_id=c.source_id and f.enabled);

  insert into public.source_coverage_hourly(
    bucket_hour,source_id,source_label,status,activity,worker_age_minutes,fetched_last_run,recent_last_run,
    detections_1h,detections_6h,detections_24h,latest_detection,latest_received,captured_at
  )
  select v_bucket,source_id,source_label,status,activity,worker_age_minutes,fetched_last_run,recent_last_run,
         detections_1h,detections_6h,detections_24h,latest_detection,latest_received,v_now
  from public.source_coverage_current
  on conflict(bucket_hour,source_id) do update set
    source_label=excluded.source_label,status=excluded.status,activity=excluded.activity,
    worker_age_minutes=excluded.worker_age_minutes,fetched_last_run=excluded.fetched_last_run,
    recent_last_run=excluded.recent_last_run,detections_1h=excluded.detections_1h,
    detections_6h=excluded.detections_6h,detections_24h=excluded.detections_24h,
    latest_detection=excluded.latest_detection,latest_received=excluded.latest_received,captured_at=excluded.captured_at;

  select count(*)::int,count(*) filter(where status='active')::int,
         count(*) filter(where status<>'active')::int,count(*) filter(where activity='quiet')::int
  into v_total,v_active,v_degraded,v_quiet
  from public.source_coverage_current;

  insert into public.system_state(key,value,updated_at)
  values('monitor_source_coverage',jsonb_build_object(
    'status',case when v_degraded>0 then 'degraded' else 'active' end,
    'last_success_run',v_now,'sources_total',v_total,'sources_active',v_active,
    'sources_degraded',v_degraded,'sources_quiet',v_quiet,
    'worker_stale_after_minutes',v_stale_min
  ),v_now)
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  delete from public.source_coverage_hourly where bucket_hour<v_bucket-interval '90 days';
  return (select value from public.system_state where key='monitor_source_coverage');
end $$;

create or replace function public.firewatch_source_coverage_summary()
returns jsonb language sql security definer
set search_path=public,pg_temp
as $$
select jsonb_build_object(
  'state',coalesce((select value from public.system_state where key='monitor_source_coverage'),'{}'::jsonb),
  'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.source_id) from public.source_coverage_current s),'[]'::jsonb)
);
$$;

create table if not exists public.source_coverage_baseline(
  source_id text not null,
  metric text not null check(metric in('fetched_last_run','recent_last_run','worker_age_minutes','ingestion_delay_minutes')),
  slot_utc smallint not null check(slot_utc in(0,6,12,18)),
  sample_count integer not null default 0,
  median_value numeric,mad_value numeric,p10_value numeric,p90_value numeric,
  baseline_ready boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(source_id,metric,slot_utc)
);

create table if not exists public.source_coverage_anomalies(
  source_id text primary key,
  source_label text not null,
  status text not null check(status in('learning','normal','watch','anomaly')),
  baseline_ready boolean not null default false,
  consecutive_abnormal integer not null default 0,
  reasons jsonb not null default '[]'::jsonb,
  current_metrics jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now()
);

alter table public.source_coverage_baseline enable row level security;
alter table public.source_coverage_anomalies enable row level security;
revoke all on public.source_coverage_baseline,public.source_coverage_anomalies from public,anon,authenticated;
grant select,insert,update,delete on public.source_coverage_baseline,public.source_coverage_anomalies to service_role;

create or replace function public.firewatch_source_baseline_refresh()
returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  v_now timestamptz:=now();
  v_slot smallint:=(floor(extract(hour from v_now)::numeric/6)*6)::smallint;
  v_learning integer:=0;v_normal integer:=0;v_watch integer:=0;v_anomaly integer:=0;
begin
  with samples as (
    select h.source_id,(floor(extract(hour from h.bucket_hour)::numeric/6)*6)::smallint slot_utc,v.metric,v.val
    from public.source_coverage_hourly h
    cross join lateral(values
      ('fetched_last_run',h.fetched_last_run::numeric),
      ('recent_last_run',h.recent_last_run::numeric),
      ('worker_age_minutes',h.worker_age_minutes::numeric)
    )v(metric,val)
    where h.bucket_hour>=v_now-interval '30 days' and h.status='active' and v.val is not null
  ), med as (
    select source_id,metric,slot_utc,count(*)::int n,
      percentile_cont(0.5) within group(order by val)::numeric median_value,
      percentile_cont(0.1) within group(order by val)::numeric p10_value,
      percentile_cont(0.9) within group(order by val)::numeric p90_value
    from samples group by source_id,metric,slot_utc
  ), stats as (
    select m.*,percentile_cont(0.5) within group(order by abs(s.val-m.median_value))::numeric mad_value
    from med m join samples s using(source_id,metric,slot_utc)
    group by m.source_id,m.metric,m.slot_utc,m.n,m.median_value,m.p10_value,m.p90_value
  )
  insert into public.source_coverage_baseline(source_id,metric,slot_utc,sample_count,median_value,mad_value,p10_value,p90_value,baseline_ready,updated_at)
  select source_id,metric,slot_utc,n,median_value,mad_value,p10_value,p90_value,n>=6,v_now from stats
  on conflict(source_id,metric,slot_utc) do update set
    sample_count=excluded.sample_count,median_value=excluded.median_value,mad_value=excluded.mad_value,
    p10_value=excluded.p10_value,p90_value=excluded.p90_value,baseline_ready=excluded.baseline_ready,updated_at=excluded.updated_at;

  with lag as (
    select source source_id,
      (floor(extract(hour from acq_datetime)::numeric/6)*6)::smallint slot_utc,
      extract(epoch from(received_at-acq_datetime))/60.0 val
    from public.detections
    where acq_datetime>=v_now-interval '30 days' and received_at>=acq_datetime
  ), med as (
    select source_id,slot_utc,count(*)::int n,
      percentile_cont(0.5) within group(order by val)::numeric median_value,
      percentile_cont(0.1) within group(order by val)::numeric p10_value,
      percentile_cont(0.9) within group(order by val)::numeric p90_value
    from lag where val between 0 and 1440 group by source_id,slot_utc
  ), stats as (
    select m.*,percentile_cont(0.5) within group(order by abs(l.val-m.median_value))::numeric mad_value
    from med m join lag l using(source_id,slot_utc) where l.val between 0 and 1440
    group by m.source_id,m.slot_utc,m.n,m.median_value,m.p10_value,m.p90_value
  )
  insert into public.source_coverage_baseline(source_id,metric,slot_utc,sample_count,median_value,mad_value,p10_value,p90_value,baseline_ready,updated_at)
  select source_id,'ingestion_delay_minutes',slot_utc,n,median_value,mad_value,p10_value,p90_value,n>=12,v_now from stats
  on conflict(source_id,metric,slot_utc) do update set
    sample_count=excluded.sample_count,median_value=excluded.median_value,mad_value=excluded.mad_value,
    p10_value=excluded.p10_value,p90_value=excluded.p90_value,baseline_ready=excluded.baseline_ready,updated_at=excluded.updated_at;

  with current_lag as (
    select source source_id,percentile_cont(0.5) within group(order by lag_min)::numeric lag
    from (
      select source,extract(epoch from(received_at-acq_datetime))/60.0 lag_min
      from public.detections
      where received_at>=v_now-interval '6 hours' and received_at>=acq_datetime
    )x where lag_min between 0 and 1440 group by source
  ), b as (
    select c.*,l.lag,
      fb.median_value f_med,fb.mad_value f_mad,fb.p10_value f_p10,fb.baseline_ready f_ready,
      wb.median_value w_med,wb.mad_value w_mad,wb.p90_value w_p90,wb.baseline_ready w_ready,
      lb.median_value l_med,lb.mad_value l_mad,lb.p90_value l_p90,lb.baseline_ready l_ready
    from public.source_coverage_current c
    left join current_lag l using(source_id)
    left join public.source_coverage_baseline fb on fb.source_id=c.source_id and fb.slot_utc=v_slot and fb.metric='fetched_last_run'
    left join public.source_coverage_baseline wb on wb.source_id=c.source_id and wb.slot_utc=v_slot and wb.metric='worker_age_minutes'
    left join public.source_coverage_baseline lb on lb.source_id=c.source_id and lb.slot_utc=v_slot and lb.metric='ingestion_delay_minutes'
  ), eval as (
    select b.*,
      (status<>'active') health_bad,
      (coalesce(f_ready,false) and coalesce(f_med,0)>=20 and fetched_last_run<
        least(coalesce(f_p10,fetched_last_run)*0.7,coalesce(f_med,fetched_last_run)-4*greatest(coalesce(f_mad,0),5))) feed_low,
      (coalesce(w_ready,false) and worker_age_minutes>
        greatest(coalesce(w_p90,0)*1.5,coalesce(w_med,0)+4*greatest(coalesce(w_mad,0),2))) worker_high,
      (coalesce(l_ready,false) and lag>
        greatest(coalesce(l_p90,0)*1.5,coalesce(l_med,0)+4*greatest(coalesce(l_mad,0),5))) lag_high
    from b
  ), assessed as (
    select e.*,(health_bad or feed_low or worker_high or lag_high) abnormal,
      (select coalesce(jsonb_agg(reason),'[]'::jsonb) from(values
        (case when health_bad then jsonb_build_object('kind','source_health','current',status) end),
        (case when feed_low then jsonb_build_object('kind','low_feed','current',fetched_last_run) end),
        (case when worker_high then jsonb_build_object('kind','high_worker_lag','current',worker_age_minutes) end),
        (case when lag_high then jsonb_build_object('kind','high_ingestion_delay','current',lag) end)
      )q(reason) where reason is not null) reasons
    from eval e
  )
  insert into public.source_coverage_anomalies(source_id,source_label,status,baseline_ready,consecutive_abnormal,reasons,current_metrics,checked_at)
  select a.source_id,a.source_label,
    case when not coalesce(a.f_ready,false) then 'learning'
         when not a.abnormal then 'normal'
         when coalesce(prev.consecutive_abnormal,0)>=1 then 'anomaly' else 'watch' end,
    coalesce(a.f_ready,false),
    case when not coalesce(a.f_ready,false) or not a.abnormal then 0 else coalesce(prev.consecutive_abnormal,0)+1 end,
    a.reasons,jsonb_build_object('coverage_status',a.status,'fetched_last_run',a.fetched_last_run,
      'worker_age_minutes',a.worker_age_minutes,'ingestion_delay_minutes',a.lag),v_now
  from assessed a left join public.source_coverage_anomalies prev using(source_id)
  on conflict(source_id) do update set
    source_label=excluded.source_label,status=excluded.status,baseline_ready=excluded.baseline_ready,
    consecutive_abnormal=excluded.consecutive_abnormal,reasons=excluded.reasons,
    current_metrics=excluded.current_metrics,checked_at=excluded.checked_at;

  select count(*) filter(where status='learning')::int,count(*) filter(where status='normal')::int,
         count(*) filter(where status='watch')::int,count(*) filter(where status='anomaly')::int
  into v_learning,v_normal,v_watch,v_anomaly from public.source_coverage_anomalies;

  insert into public.system_state(key,value,updated_at)
  values('monitor_source_baseline',jsonb_build_object(
    'status',case when v_anomaly>0 then 'anomaly' when v_watch>0 then 'watch' when v_learning>0 then 'learning' else 'normal' end,
    'last_success_run',v_now,'sources_learning',v_learning,'sources_normal',v_normal,
    'sources_watch',v_watch,'sources_anomaly',v_anomaly,
    'anomaly_requires_consecutive_checks',2,
    'fire_count_policy','Detection counts never directly trigger a source anomaly.'
  ),v_now)
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  return (select value from public.system_state where key='monitor_source_baseline');
end $$;

create or replace function public.firewatch_source_baseline_summary()
returns jsonb language sql security definer
set search_path=public,pg_temp
as $$
select jsonb_build_object(
  'state',coalesce((select value from public.system_state where key='monitor_source_baseline'),'{}'::jsonb),
  'sources',coalesce((select jsonb_agg(to_jsonb(a) order by a.source_id) from public.source_coverage_anomalies a),'[]'::jsonb)
);
$$;

create table if not exists public.geo_integrity_source_current(
  source_id text primary key,
  api_recent integer not null default 0,
  inside_aoi integer not null default 0,
  outside_aoi integer not null default 0,
  db_matched integer not null default 0,
  missing_in_db integer not null default 0,
  status text not null check(status in('active','degraded','unknown')),
  refreshed_at timestamptz not null default now()
);

create table if not exists public.geo_integrity_region_current(
  region_id bigint primary key references public.regions(id) on delete cascade,
  region_name text not null,
  api_detections integer not null default 0,
  db_matched integer not null default 0,
  missing_in_db integer not null default 0,
  distinct_events integer not null default 0,
  telegram_events integer not null default 0,
  source_breakdown jsonb not null default '{}'::jsonb,
  status text not null check(status in('active','degraded','quiet')),
  refreshed_at timestamptz not null default now()
);

alter table public.geo_integrity_source_current enable row level security;
alter table public.geo_integrity_region_current enable row level security;
revoke all on public.geo_integrity_source_current,public.geo_integrity_region_current from public,anon,authenticated;
grant select,insert,update,delete on public.geo_integrity_source_current,public.geo_integrity_region_current to service_role;

create or replace function public.firewatch_geo_integrity_refresh(p_records jsonb)
returns jsonb
language plpgsql security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_now timestamptz:=now();
  v_total_api integer:=0;v_inside integer:=0;v_outside integer:=0;v_matched integer:=0;v_missing integer:=0;
begin
  if jsonb_typeof(p_records)<>'array' then raise exception 'p_records must be JSON array'; end if;

  create temporary table if not exists fw_geo_audit_tmp(
    source text,satellite text,instrument text,acq_datetime timestamptz,
    latitude double precision,longitude double precision,detection_hash text,
    inside_aoi boolean,region_id bigint,region_name text,
    detection_id uuid,event_id uuid,telegram_sent boolean
  ) on commit drop;
  truncate fw_geo_audit_tmp;

  insert into fw_geo_audit_tmp
  select r.source,r.satellite,r.instrument,r.acq_datetime,r.latitude,r.longitude,
    encode(extensions.digest(concat_ws('|',
      coalesce(r.source,''),coalesce(r.satellite,''),coalesce(r.instrument,''),
      to_char(r.acq_datetime at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
      to_char(round(r.latitude::numeric,6),'FM999990.000000'),
      to_char(round(r.longitude::numeric,6),'FM999990.000000')
    ),'sha256'),'hex'),
    exists(select 1 from public.monitoring_areas a where a.enabled and extensions.st_covers(
      a.geom,extensions.st_setsrid(extensions.st_makepoint(r.longitude,r.latitude),4326))),
    rg.id,rg.name,d.id,d.event_id,e.telegram_sent
  from jsonb_to_recordset(p_records) as r(
    source text,satellite text,instrument text,acq_datetime timestamptz,latitude double precision,longitude double precision
  )
  left join lateral(
    select x.id,x.name from public.regions x
    where x.enabled and extensions.st_covers(x.geom,extensions.st_setsrid(extensions.st_makepoint(r.longitude,r.latitude),4326))
    order by x.id limit 1
  )rg on true
  left join public.detections d on d.detection_hash=encode(extensions.digest(concat_ws('|',
      coalesce(r.source,''),coalesce(r.satellite,''),coalesce(r.instrument,''),
      to_char(r.acq_datetime at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
      to_char(round(r.latitude::numeric,6),'FM999990.000000'),
      to_char(round(r.longitude::numeric,6),'FM999990.000000')
    ),'sha256'),'hex')
  left join public.fire_events e on e.id=d.event_id;

  delete from public.geo_integrity_source_current where source_id is not null;
  insert into public.geo_integrity_source_current(source_id,api_recent,inside_aoi,outside_aoi,db_matched,missing_in_db,status,refreshed_at)
  select source,count(*)::int,
    count(*) filter(where inside_aoi)::int,
    count(*) filter(where not inside_aoi)::int,
    count(*) filter(where inside_aoi and detection_id is not null)::int,
    count(*) filter(where inside_aoi and detection_id is null)::int,
    case when count(*) filter(where inside_aoi and detection_id is null)>0 then 'degraded' else 'active' end,v_now
  from fw_geo_audit_tmp group by source;

  delete from public.geo_integrity_region_current where region_id is not null;
  insert into public.geo_integrity_region_current(
    region_id,region_name,api_detections,db_matched,missing_in_db,distinct_events,telegram_events,source_breakdown,status,refreshed_at
  )
  select r.id,r.name,
    count(t.source)::int,
    count(t.source) filter(where t.detection_id is not null)::int,
    count(t.source) filter(where t.detection_id is null)::int,
    count(distinct t.event_id)::int,
    count(distinct t.event_id) filter(where t.telegram_sent)::int,
    coalesce((
      select jsonb_object_agg(z.source,z.n)
      from (
        select x.source,count(*)::int n from fw_geo_audit_tmp x
        where x.region_id=r.id group by x.source
      )z
    ),'{}'::jsonb),
    case when count(t.source)=0 then 'quiet'
         when count(t.source) filter(where t.detection_id is null)>0 then 'degraded'
         else 'active' end,
    v_now
  from public.regions r
  left join fw_geo_audit_tmp t on t.region_id=r.id
  where r.enabled
  group by r.id,r.name;

  select count(*)::int,count(*) filter(where inside_aoi)::int,count(*) filter(where not inside_aoi)::int,
         count(*) filter(where inside_aoi and detection_id is not null)::int,
         count(*) filter(where inside_aoi and detection_id is null)::int
  into v_total_api,v_inside,v_outside,v_matched,v_missing
  from fw_geo_audit_tmp;

  insert into public.system_state(key,value,updated_at)
  values('monitor_geo_integrity',jsonb_build_object(
    'status',case when v_missing>0 then 'degraded' else 'active' end,
    'last_success_run',v_now,'api_recent',v_total_api,'inside_aoi',v_inside,'outside_aoi',v_outside,
    'db_matched',v_matched,'missing_in_db',v_missing,
    'regions_degraded',(select count(*) from public.geo_integrity_region_current where status='degraded'),
    'regions_active',(select count(*) from public.geo_integrity_region_current where status='active'),
    'regions_quiet',(select count(*) from public.geo_integrity_region_current where status='quiet'),
    'inside_without_region',(select count(*) from fw_geo_audit_tmp where inside_aoi and region_id is null),
    'boundary_method','ST_Covers','window_hours',24
  ),v_now)
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  return (select value from public.system_state where key='monitor_geo_integrity');
end $$;

create or replace function public.firewatch_geo_integrity_summary()
returns jsonb language sql security definer
set search_path=public,pg_temp
as $$
select jsonb_build_object(
  'state',coalesce((select value from public.system_state where key='monitor_geo_integrity'),'{}'::jsonb),
  'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.source_id) from public.geo_integrity_source_current s),'[]'::jsonb),
  'regions',coalesce((select jsonb_agg(to_jsonb(r) order by r.api_detections desc,r.region_name) from public.geo_integrity_region_current r),'[]'::jsonb)
);
$$;

revoke execute on function public.firewatch_notification_integrity_refresh() from public,anon,authenticated;
revoke execute on function public.firewatch_notification_integrity_summary() from public,anon,authenticated;
revoke execute on function public.firewatch_source_coverage_refresh() from public,anon,authenticated;
revoke execute on function public.firewatch_source_coverage_summary() from public,anon,authenticated;
revoke execute on function public.firewatch_source_baseline_refresh() from public,anon,authenticated;
revoke execute on function public.firewatch_source_baseline_summary() from public,anon,authenticated;
revoke execute on function public.firewatch_geo_integrity_refresh(jsonb) from public,anon,authenticated;
revoke execute on function public.firewatch_geo_integrity_summary() from public,anon,authenticated;

grant execute on function public.firewatch_notification_integrity_refresh() to service_role;
grant execute on function public.firewatch_notification_integrity_summary() to service_role;
grant execute on function public.firewatch_source_coverage_refresh() to service_role;
grant execute on function public.firewatch_source_coverage_summary() to service_role;
grant execute on function public.firewatch_source_baseline_refresh() to service_role;
grant execute on function public.firewatch_source_baseline_summary() to service_role;
grant execute on function public.firewatch_geo_integrity_refresh(jsonb) to service_role;
grant execute on function public.firewatch_geo_integrity_summary() to service_role;

do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname in(
    'firmsgeotools-notification-integrity','firmsgeotools-source-coverage','firmsgeotools-source-baseline'
  ) loop perform cron.unschedule(j.jobid); end loop;

  perform cron.schedule('firmsgeotools-source-coverage','34 * * * *','select public.firewatch_source_coverage_refresh();');
  perform cron.schedule('firmsgeotools-source-baseline','36 * * * *','select public.firewatch_source_baseline_refresh();');
  perform cron.schedule('firmsgeotools-notification-integrity','38 * * * *','select public.firewatch_notification_integrity_refresh();');
end $$;

insert into public.system_state(key,value,updated_at)
values('clean_install_stage',jsonb_build_object('stage',5,'version','core-v0.5','status','pre-release'),now())
on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
