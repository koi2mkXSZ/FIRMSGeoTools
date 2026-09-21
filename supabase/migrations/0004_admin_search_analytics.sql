-- FIRMSGeoTools Community Edition
-- Clean Core schema v0.4: operator search, analytics and admin summaries.

create or replace function public.firewatch_event_detail(p_query text default null)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_event public.fire_events%rowtype;
  v_region text;
  v_max_frp numeric;
  v_avg_frp numeric;
  v_sources text[];
begin
  if nullif(trim(p_query),'') is null then
    select * into v_event from public.fire_events order by last_seen desc limit 1;
  else
    select * into v_event
    from public.fire_events
    where lower(id::text) like lower(trim(p_query))||'%'
    order by last_seen desc limit 1;
  end if;
  if v_event.id is null then return null; end if;

  select name into v_region from public.regions where id=v_event.region_id;

  select max(frp),round(avg(frp)::numeric,2),
         array_agg(distinct coalesce(nullif(satellite,''),source) order by coalesce(nullif(satellite,''),source))
  into v_max_frp,v_avg_frp,v_sources
  from public.detections where event_id=v_event.id;

  return jsonb_build_object(
    'id',v_event.id,
    'region',v_region,
    'status',v_event.status,
    'lifecycle_status',v_event.lifecycle_status,
    'first_seen',v_event.first_seen,
    'last_seen',v_event.last_seen,
    'latitude',coalesce(v_event.best_latitude,v_event.last_latitude,v_event.first_latitude),
    'longitude',coalesce(v_event.best_longitude,v_event.last_longitude,v_event.first_longitude),
    'resolution_m',v_event.best_location_resolution_m,
    'observation_count',v_event.observation_count,
    'multisource_count',v_event.multisource_count,
    'sources',coalesce(to_jsonb(v_sources),'[]'::jsonb),
    'max_frp_mw',v_max_frp,
    'avg_frp_mw',v_avg_frp,
    'telegram_sent',v_event.telegram_sent,
    'telegram_sent_at',v_event.telegram_sent_at,
    'telegram_message_id',v_event.telegram_message_id
  );
end $$;

create or replace function public.firewatch_search_events(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  v_limit integer:=greatest(1,least(coalesce(nullif(p_filters->>'limit','')::integer,20),50));
  v_id text:=nullif(trim(p_filters->>'id'),'');
  v_region text:=nullif(trim(coalesce(p_filters->>'region',p_filters->>'oblast')),'');
  v_status text:=nullif(trim(p_filters->>'status'),'');
  v_source text:=nullif(trim(p_filters->>'source'),'');
  v_from timestamptz:=nullif(p_filters->>'from','')::timestamptz;
  v_to timestamptz:=nullif(p_filters->>'to','')::timestamptz;
  v_min_frp numeric:=nullif(p_filters->>'min_frp','')::numeric;
  v_min_obs integer:=nullif(p_filters->>'min_obs','')::integer;
  v_min_platforms integer:=nullif(p_filters->>'min_platforms','')::integer;
  v_sent boolean:=case when p_filters ? 'sent' then (p_filters->>'sent')::boolean else null end;
  v_lat double precision:=nullif(p_filters->>'lat','')::double precision;
  v_lon double precision:=nullif(p_filters->>'lon','')::double precision;
  v_radius_km double precision:=nullif(p_filters->>'radius_km','')::double precision;
  v_rows jsonb;
begin
  if (v_lat is null)<>(v_lon is null) then raise exception 'lat and lon must be supplied together'; end if;
  if v_lat is not null and (v_lat<-90 or v_lat>90 or v_lon<-180 or v_lon>180) then raise exception 'invalid coordinates'; end if;
  if v_lat is not null and v_radius_km is null then v_radius_km:=10; end if;
  if v_radius_km is not null and (v_radius_km<0.1 or v_radius_km>500) then raise exception 'radius_km must be between 0.1 and 500'; end if;

  with candidate as (
    select e.id,e.first_seen,e.last_seen,e.lifecycle_status,e.status,
           e.observation_count,e.multisource_count,e.multisource_sources,
           coalesce(e.best_latitude,e.last_latitude,e.first_latitude) latitude,
           coalesce(e.best_longitude,e.last_longitude,e.first_longitude) longitude,
           coalesce(e.best_location,e.last_location,e.first_location) event_location,
           e.best_location_resolution_m,e.telegram_sent,e.telegram_message_id,
           r.name region,
           d.max_frp,d.sources
    from public.fire_events e
    left join public.regions r on r.id=e.region_id
    left join lateral (
      select max(x.frp) max_frp,array_agg(distinct x.source order by x.source) sources
      from public.detections x where x.event_id=e.id
    ) d on true
    where (v_id is null or lower(e.id::text) like lower(v_id)||'%')
      and (v_region is null or coalesce(r.name,'') ilike '%'||v_region||'%')
      and (v_status is null or e.lifecycle_status=v_status or e.status=v_status)
      and (v_from is null or e.last_seen>=v_from)
      and (v_to is null or e.first_seen<=v_to)
      and (v_min_frp is null or coalesce(d.max_frp,0)>=v_min_frp)
      and (v_min_obs is null or e.observation_count>=v_min_obs)
      and (v_min_platforms is null or e.multisource_count>=v_min_platforms)
      and (v_sent is null or e.telegram_sent=v_sent)
      and (v_source is null or v_source=any(coalesce(d.sources,'{}'::text[])))
  ), filtered as (
    select c.*,
      case when v_lat is not null then round((extensions.st_distance(
        c.event_location,
        extensions.st_setsrid(extensions.st_makepoint(v_lon,v_lat),4326)::extensions.geography
      )/1000.0)::numeric,3) end distance_km
    from candidate c
    where v_lat is null or extensions.st_dwithin(
      c.event_location,
      extensions.st_setsrid(extensions.st_makepoint(v_lon,v_lat),4326)::extensions.geography,
      v_radius_km*1000.0
    )
    order by
      case when v_lat is not null then extensions.st_distance(
        c.event_location,
        extensions.st_setsrid(extensions.st_makepoint(v_lon,v_lat),4326)::extensions.geography
      ) end asc nulls last,
      c.last_seen desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'region',region,'first_seen',first_seen,'last_seen',last_seen,
    'lifecycle_status',lifecycle_status,'status',status,
    'observation_count',observation_count,'multisource_count',multisource_count,
    'sources',coalesce(to_jsonb(sources),'[]'::jsonb),
    'latitude',latitude,'longitude',longitude,'distance_km',distance_km,
    'resolution_m',best_location_resolution_m,'max_frp_mw',max_frp,
    'telegram_sent',telegram_sent,'telegram_message_id',telegram_message_id
  ) order by
    case when v_lat is not null then distance_km end asc nulls last,last_seen desc),'[]'::jsonb)
  into v_rows from filtered;

  return jsonb_build_object(
    'filters',coalesce(p_filters,'{}'::jsonb),
    'geo',case when v_lat is null then null else jsonb_build_object('lat',v_lat,'lon',v_lon,'radius_km',v_radius_km) end,
    'count',jsonb_array_length(v_rows),'limit',v_limit,'events',v_rows
  );
end $$;

create or replace function public.firewatch_analytics_summary(p_hours integer default 24)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_hours integer:=greatest(1,least(coalesce(p_hours,24),8760));
  v_from timestamptz:=now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,24),8760)));
begin
  return jsonb_build_object(
    'window_hours',v_hours,'from',v_from,'generated_at',now(),
    'events',(
      select jsonb_build_object(
        'new',count(*) filter(where first_seen>=v_from),
        'active_new',count(*) filter(where first_seen>=v_from and lifecycle_status<>'closed'),
        'closed_new',count(*) filter(where first_seen>=v_from and lifecycle_status='closed'),
        'touched',count(*) filter(where last_seen>=v_from),
        'telegram_sent',count(*) filter(where telegram_sent_at>=v_from),
        'multisource_new',count(*) filter(where first_seen>=v_from and multisource_count>=2)
      ) from public.fire_events
    ),
    'by_region',coalesce((
      select jsonb_agg(jsonb_build_object('region',name,'events',n) order by n desc,name)
      from (
        select r.name,count(e.id) n
        from public.regions r
        left join public.fire_events e on e.region_id=r.id and e.first_seen>=v_from
        where r.enabled
        group by r.id,r.name
        order by count(e.id) desc,r.name
      ) x
    ),'[]'::jsonb),
    'unassigned',(
      select count(*) from public.fire_events e where e.first_seen>=v_from and e.region_id is null
    ),
    'by_source',coalesce((
      select jsonb_agg(jsonb_build_object('source',source,'detections',n) order by n desc,source)
      from (
        select d.source,count(*) n from public.detections d
        where d.acq_datetime>=v_from group by d.source
      ) x
    ),'[]'::jsonb),
    'frp',(
      select jsonb_build_object(
        'max_mw',max(frp),'avg_mw',round(avg(frp)::numeric,2),'detections',count(*)
      ) from public.detections where acq_datetime>=v_from and frp is not null
    )
  );
end $$;

create or replace function public.firewatch_admin_summary()
returns jsonb
language plpgsql
security definer
set search_path=public,cron,pg_temp
as $$
begin
  return jsonb_build_object(
    'generated_at',now(),
    'project',(select to_jsonb(c) from public.project_config c where id=true),
    'bootstrap',coalesce((select value from public.system_state where key='bootstrap'),'{}'::jsonb),
    'firms',coalesce((select value from public.system_state where key='monitor_firms'),'{}'::jsonb),
    'telegram',coalesce((select value from public.system_state where key='monitor_telegram'),'{}'::jsonb),
    'geography',coalesce((select value from public.system_state where key='geography'),'{}'::jsonb),
    'cron',coalesce((select jsonb_agg(jsonb_build_object('jobname',jobname,'schedule',schedule,'active',active) order by jobname)
                     from cron.job where jobname like 'firmsgeotools-%'),'[]'::jsonb),
    'counts',jsonb_build_object(
      'detections_24h',(select count(*) from public.detections where acq_datetime>=now()-interval '24 hours'),
      'events_new_24h',(select count(*) from public.fire_events where first_seen>=now()-interval '24 hours'),
      'events_touched_24h',(select count(*) from public.fire_events where last_seen>=now()-interval '24 hours'),
      'pending_telegram',(select count(*) from public.fire_events where notification_required and not telegram_sent),
      'regions',(select count(*) from public.regions where enabled)
    )
  );
end $$;

revoke execute on function public.firewatch_event_detail(text) from public,anon,authenticated;
revoke execute on function public.firewatch_search_events(jsonb) from public,anon,authenticated;
revoke execute on function public.firewatch_analytics_summary(integer) from public,anon,authenticated;
revoke execute on function public.firewatch_admin_summary() from public,anon,authenticated;

grant execute on function public.firewatch_event_detail(text) to service_role;
grant execute on function public.firewatch_search_events(jsonb) to service_role;
grant execute on function public.firewatch_analytics_summary(integer) to service_role;
grant execute on function public.firewatch_admin_summary() to service_role;

insert into public.system_state(key,value,updated_at)
values('clean_install_stage',jsonb_build_object('stage',4,'version','core-v0.4','status','pre-release'),now())
on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
