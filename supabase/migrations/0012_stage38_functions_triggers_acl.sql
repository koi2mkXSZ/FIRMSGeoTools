-- Stage 38 production function/trigger reconciliation\n-- Generated from live production catalog on 2026-09-24.\n\nset search_path=public,extensions,pg_temp;\n\nCREATE OR REPLACE FUNCTION public.complete_bootstrap()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into public.system_state(key,value,updated_at)
  values ('bootstrap', jsonb_build_object('done',true,'completed_at',now()), now())
  on conflict (key) do update
  set value = jsonb_build_object('done',true,'completed_at',now()),
      updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.find_hotspot_history_nearby(p_lat double precision, p_lon double precision, p_radius_m integer DEFAULT 1000, p_days integer DEFAULT 365, p_limit integer DEFAULT 15)
 RETURNS TABLE(day date, latitude double precision, longitude double precision, distance_m double precision, sensors text[], detection_count bigint, max_frp double precision, high_confidence_count bigint, source_kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
with params as (
  select
    st_setsrid(st_makepoint(p_lon,p_lat),4326)::geography as q,
    greatest(100, least(coalesce(p_radius_m,1000),5000))::integer as radius_m,
    greatest(1, least(coalesce(p_days,365),3650))::integer as days_n,
    greatest(1, least(coalesce(p_limit,15),50))::integer as limit_n
), archive as (
  select
    h.day,
    h.cell_lat,
    h.cell_lon,
    h.latitude,
    h.longitude,
    h.location,
    h.sensor_family as sensor,
    h.detection_count::bigint as detection_count,
    h.max_frp,
    h.high_confidence_count::bigint as high_confidence_count,
    'archive'::text as source_kind
  from public.hotspot_history_daily h, params p
  where h.day >= current_date - p.days_n
    and st_dwithin(h.location,p.q,p.radius_m)
), live as (
  select
    (d.acq_datetime at time zone 'UTC')::date as day,
    floor(d.latitude / 0.0025)::integer as cell_lat,
    floor(d.longitude / 0.0025)::integer as cell_lon,
    avg(d.latitude)::double precision as latitude,
    avg(d.longitude)::double precision as longitude,
    st_centroid(st_collect(d.location::geometry))::geography as location,
    coalesce(nullif(trim(d.instrument),''),nullif(trim(d.satellite),''),'FIRMS') as sensor,
    count(*)::bigint as detection_count,
    max(d.frp)::double precision as max_frp,
    count(*) filter (where lower(coalesce(d.confidence,'')) in ('h','high'))::bigint as high_confidence_count,
    'live'::text as source_kind
  from public.detections d, params p
  where d.acq_datetime >= now() - make_interval(days => p.days_n)
    and st_dwithin(d.location,p.q,p.radius_m)
  group by 1,2,3,7
), combined as (
  select * from archive
  union all
  select * from live
), grouped as (
  select
    c.day,
    c.cell_lat,
    c.cell_lon,
    avg(c.latitude)::double precision as latitude,
    avg(c.longitude)::double precision as longitude,
    st_centroid(st_collect(c.location::geometry))::geography as location,
    array_agg(distinct c.sensor order by c.sensor) as sensors,
    sum(c.detection_count)::bigint as detection_count,
    max(c.max_frp)::double precision as max_frp,
    sum(c.high_confidence_count)::bigint as high_confidence_count,
    case when bool_or(c.source_kind='live') then 'live' else 'archive' end as source_kind
  from combined c
  group by c.day,c.cell_lat,c.cell_lon
)
select
  g.day,
  g.latitude,
  g.longitude,
  round(st_distance(g.location,p.q))::double precision as distance_m,
  g.sensors,
  g.detection_count,
  g.max_frp,
  g.high_confidence_count,
  g.source_kind
from grouped g, params p
where st_dwithin(g.location,p.q,p.radius_m)
order by g.day desc, st_distance(g.location,p.q) asc
limit (select limit_n from params);
$function$
;

CREATE OR REPLACE FUNCTION public.fire_event_atmosphere(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
select jsonb_build_object(
  'cams_observed_at',e.cams_observed_at,
  'cams_carbon_monoxide_ug_m3',e.cams_carbon_monoxide_ug_m3,
  'cams_pm2_5_ug_m3',e.cams_pm2_5_ug_m3,
  'cams_aerosol_optical_depth',e.cams_aerosol_optical_depth,
  'cams_pm10_wildfires_ug_m3',e.cams_pm10_wildfires_ug_m3,
  'cams_european_aqi',e.cams_european_aqi,
  'plume_direction_deg',e.plume_direction_deg,
  's5p_co_observed_at',e.s5p_co_observed_at,
  's5p_co_mol_m2',e.s5p_co_mol_m2,
  's5p_co_qa',e.s5p_co_qa,
  's5p_co_distance_km',e.s5p_co_distance_km,
  's5p_aer_observed_at',e.s5p_aer_observed_at,
  's5p_aer_ai_340_380',e.s5p_aer_ai_340_380,
  's5p_aer_ai_354_388',e.s5p_aer_ai_354_388,
  's5p_aer_qa',e.s5p_aer_qa,
  's5p_aer_distance_km',e.s5p_aer_distance_km,
  'atmosphere_signal_level',e.atmosphere_signal_level,
  'atmosphere_updated_at',e.atmosphere_updated_at
)
from public.fire_events e
where e.id=p_event_id;
$function$
;

CREATE OR REPLACE FUNCTION public.fire_event_intelligence(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
select jsonb_build_object(
  'frp_trend',e.frp_trend,
  'frp_latest_avg',e.frp_latest_avg,
  'frp_previous_avg',e.frp_previous_avg,
  'frp_change_pct',e.frp_change_pct,
  'cluster_diameter_m',e.cluster_diameter_m,
  'cluster_motion_m',e.cluster_motion_m,
  'cluster_motion_bearing_deg',e.cluster_motion_bearing_deg,
  'plume_forecast',e.plume_forecast,
  'plume_sector_geojson',e.plume_sector_geojson,
  'plume_reference_place',e.plume_reference_place,
  'plume_reference_place_type',e.plume_reference_place_type,
  'plume_reference_place_distance_km',e.plume_reference_place_distance_km,
  'plume_reference_place_hour',e.plume_reference_place_hour,
  'event_summary',e.event_summary,
  'intelligence_updated_at',e.intelligence_updated_at
)
from public.fire_events e where e.id=p_event_id;
$function$
;

CREATE OR REPLACE FUNCTION public.fire_event_multisource(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'multisource_count',e.multisource_count,
    'multisource_sources',e.multisource_sources,
    'event_confidence_level',e.event_confidence_level,
    'event_confidence_label',e.event_confidence_label,
    'best_latitude',e.best_latitude,
    'best_longitude',e.best_longitude,
    'best_location_source',e.best_location_source,
    'best_location_resolution_m',e.best_location_resolution_m,
    'multisource_updated_at',e.multisource_updated_at
  )
  from public.fire_events e
  where e.id=p_event_id;
$function$
;

CREATE OR REPLACE FUNCTION public.fire_event_rollup(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    jsonb_build_object(
      'observation_count', e.observation_count,
      'first_seen', e.first_seen,
      'last_seen', e.last_seen,
      'first_latitude', e.first_latitude,
      'first_longitude', e.first_longitude,
      'last_latitude', e.last_latitude,
      'last_longitude', e.last_longitude,
      'status', e.status,
      'lifecycle_status', e.lifecycle_status,
      'telegram_message_id', e.telegram_message_id,
      'telegram_message_kind', e.telegram_message_kind,
      'telegram_sent', e.telegram_sent,
      'telegram_last_observation_count', e.telegram_last_observation_count,
      'telegram_last_seen_snapshot', e.telegram_last_seen_snapshot,
      'telegram_last_frp', e.telegram_last_frp,
      'telegram_last_status', e.telegram_last_status,
      'telegram_last_update_at', e.telegram_last_update_at,
      'oblast_name_uk', o.name_uk,
      'oblast_name_en', o.name_en,
      'latest_frp', (select d.frp from public.detections d where d.event_id=e.id and d.frp is not null order by d.acq_datetime desc limit 1),
      'max_frp', (select max(d.frp) from public.detections d where d.event_id=e.id),
      'latest_confidence', (select d.confidence from public.detections d where d.event_id=e.id order by d.acq_datetime desc limit 1),
      'satellites_raw', coalesce((select jsonb_agg(x.satellite order by x.satellite) from (select distinct nullif(trim(d.satellite),'') satellite from public.detections d where d.event_id=e.id and nullif(trim(d.satellite),'') is not null) x),'[]'::jsonb),
      'satellites', coalesce((
        select jsonb_agg(x.label order by x.sort_key, x.label)
        from (
          select distinct
            case
              when upper(trim(d.instrument))='VIIRS' and upper(trim(d.satellite)) in ('N20','NOAA20','NOAA-20') then 'NOAA-2' || chr(8203) || '0 • VIIRS ~375 м'
              when upper(trim(d.instrument))='VIIRS' and upper(trim(d.satellite)) in ('N21','NOAA21','NOAA-21') then 'NOAA-2' || chr(8203) || '1 • VIIRS ~375 м'
              when upper(trim(d.instrument))='VIIRS' and upper(trim(d.satellite)) like '%NPP%' then 'Suomi N' || chr(8203) || 'PP • VIIRS ~375 м'
              when upper(trim(d.instrument))='MODIS' and lower(trim(d.satellite))='terra' then 'Terra • MODIS ~1 км'
              when upper(trim(d.instrument))='MODIS' and lower(trim(d.satellite))='aqua' then 'Aqua • MODIS ~1 км'
              when upper(trim(d.instrument))='VIIRS' then coalesce(nullif(trim(d.satellite),''),'VIIRS') || ' • VIIRS ~375 м'
              when upper(trim(d.instrument))='MODIS' then coalesce(nullif(trim(d.satellite),''),'MODIS') || ' • MODIS ~1 км'
              else coalesce(nullif(trim(d.satellite),''),nullif(trim(d.instrument),''),'не указан')
            end as label,
            case when upper(trim(d.instrument))='VIIRS' then 1 when upper(trim(d.instrument))='MODIS' then 2 else 3 end as sort_key
          from public.detections d
          where d.event_id=e.id
        ) x
      ),'[]'::jsonb),
      'instruments', coalesce((select jsonb_agg(x.instrument order by x.instrument) from (select distinct nullif(trim(d.instrument),'') instrument from public.detections d where d.event_id=e.id and nullif(trim(d.instrument),'') is not null) x),'[]'::jsonb),
      'sources', coalesce((select jsonb_agg(x.source order by x.source) from (select distinct nullif(trim(d.source),'') source from public.detections d where d.event_id=e.id and nullif(trim(d.source),'') is not null) x),'[]'::jsonb),
      'reliability_score', e.reliability_score,
      'reliability_level', e.reliability_level,
      'nearest_place_name', e.nearest_place_name,
      'nearest_place_type', e.nearest_place_type,
      'nearest_place_distance_km', e.nearest_place_distance_km,
      'weather_observed_at', e.weather_observed_at,
      'weather_temperature_c', e.weather_temperature_c,
      'weather_relative_humidity_pct', e.weather_relative_humidity_pct,
      'weather_precipitation_mm', e.weather_precipitation_mm,
      'weather_wind_speed_ms', e.weather_wind_speed_ms,
      'weather_wind_gust_ms', e.weather_wind_gust_ms,
      'weather_wind_direction_deg', e.weather_wind_direction_deg,
      'enrichment_updated_at', e.enrichment_updated_at,
      'osm_context_type', e.osm_context_type,
      'osm_context_score', e.osm_context_score,
      'osm_nearest_feature', e.osm_nearest_feature,
      'osm_nearest_feature_distance_m', e.osm_nearest_feature_distance_m,
      'osm_features', e.osm_features,
      'osm_context_latitude', e.osm_context_latitude,
      'osm_context_longitude', e.osm_context_longitude,
      'osm_context_updated_at', e.osm_context_updated_at
    )
    || jsonb_build_object(
      'history_events_30d', e.history_events_30d,
      'history_events_90d', e.history_events_90d,
      'history_events_365d', e.history_events_365d,
      'history_days_365d', e.history_days_365d,
      'history_max_frp_365d', e.history_max_frp_365d,
      'history_radius_m', e.history_radius_m,
      'hotspot_score', e.hotspot_score,
      'hotspot_class', e.hotspot_class,
      'history_updated_at', e.history_updated_at
    )
  from public.fire_events e
  left join public.oblasts o on o.id=e.oblast_id
  where e.id=p_event_id;
$function$
;

CREATE OR REPLACE FUNCTION public.fire_events_osm_circuit_breaker()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.osm_context_updated_at is null then
    new.osm_context_latitude := new.last_latitude;
    new.osm_context_longitude := new.last_longitude;
    new.osm_context_updated_at := now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fire_events_requiring_telegram_sync(p_limit integer DEFAULT 100)
 RETURNS TABLE(event_id uuid, sync_reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with enrich as (
    select e.id,
      greatest(
        coalesce(g.updated_at,'epoch'::timestamptz),
        coalesce(h.updated_at,'epoch'::timestamptz),
        coalesce((select max(x.first_seen_at) from public.event_public_osint x where x.fire_event_id=e.id),'epoch'::timestamptz),
        coalesce((select max(a.updated_at) from public.event_air_threat_context a where a.fire_event_id=e.id),'epoch'::timestamptz),
        coalesce(s.updated_at,'epoch'::timestamptz)
      ) enrichment_at
    from public.fire_events e
    left join public.geo_osint_event_cache g on g.fire_event_id=e.id
    left join public.ghsl_event_cache h on h.fire_event_id=e.id
    left join public.satellite_surface_evidence s on s.fire_event_id=e.id
  ),
  q as (
    select e.id,
      case
        when e.notification_required and not e.telegram_sent then 'new'
        when e.telegram_sent and e.status <> 'closed' and e.last_seen < now() - interval '24 hours' then 'close'
        when e.telegram_sent and e.status <> 'closed' and (
          e.telegram_last_observation_count is null or e.observation_count > e.telegram_last_observation_count
          or e.telegram_last_seen_snapshot is null or e.last_seen > e.telegram_last_seen_snapshot
        ) then 'update'
        when e.telegram_sent and e.telegram_message_id is not null
          and e.first_seen >= now()-interval '72 hours'
          and x.enrichment_at > coalesce(e.telegram_last_update_at,'epoch'::timestamptz)
          then 'enrichment'
        else null
      end reason,e.first_seen
    from public.fire_events e join enrich x on x.id=e.id
    where (e.notification_required and not e.telegram_sent)
       or (e.telegram_sent and e.telegram_message_id is not null and e.status <> 'closed' and (
            e.last_seen < now()-interval '24 hours'
            or e.telegram_last_observation_count is null or e.observation_count > e.telegram_last_observation_count
            or e.telegram_last_seen_snapshot is null or e.last_seen > e.telegram_last_seen_snapshot))
       or (e.telegram_sent and e.telegram_message_id is not null and e.first_seen>=now()-interval '72 hours'
           and x.enrichment_at > coalesce(e.telegram_last_update_at,'epoch'::timestamptz))
  )
  select id,reason from q where reason is not null
  order by case reason when 'new' then 0 when 'close' then 1 when 'update' then 2 else 3 end,first_seen asc
  limit greatest(1,least(coalesce(p_limit,100),500));
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_acquire_telegram_lease(p_holder text, p_ttl_seconds integer DEFAULT 120)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ok boolean:=false;
begin
  if nullif(trim(p_holder),'') is null then return false; end if;
  update public.telegram_delivery_lease
  set holder=p_holder,
      expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_ttl_seconds,120),300))),
      updated_at=now()
  where id=true
    and (expires_at is null or expires_at<now() or holder=p_holder);
  get diagnostics v_ok = row_count;
  return v_ok;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_admin_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
  with s as (select public.firewatch_watchdog_snapshot() as base)
  select coalesce(base,'{}'::jsonb) || jsonb_build_object(
    'quota',public.firewatch_quota_snapshot(),
    'monitor_osint',coalesce((select value from public.system_state where key='monitor_osint'),'{}'::jsonb),
    'monitor_ground_osint',coalesce((select value from public.system_state where key='monitor_ground_osint'),'{}'::jsonb),
    'monitor_geo_osint',coalesce((select value from public.system_state where key='monitor_geo_osint'),'{}'::jsonb),
    'geo_source_policy',coalesce((select value from public.system_state where key='geo_source_policy'),'{}'::jsonb),
    'monitor_dossier',coalesce((select value from public.system_state where key='monitor_dossier'),'{}'::jsonb),
    'monitor_satellite_evidence',coalesce((select value from public.system_state where key='monitor_satellite_evidence'),'{}'::jsonb),
    'satellite_visual_policy',coalesce((select value from public.system_state where key='satellite_visual_policy'),'{}'::jsonb),
    'event_report_policy',coalesce((select value from public.system_state where key='event_report_policy'),'{}'::jsonb),
    'monitor_notification_integrity',coalesce((select value from public.system_state where key='monitor_notification_integrity'),'{}'::jsonb),
    'monitor_source_coverage',coalesce((select value from public.system_state where key='monitor_source_coverage'),'{}'::jsonb),
    'monitor_source_baseline',coalesce((select value from public.system_state where key='monitor_source_baseline'),'{}'::jsonb),
    'stage31_search_policy',coalesce((select value from public.system_state where key='stage31_search_policy'),'{}'::jsonb),
    'eumetsat_lsa_saf',coalesce((select value from public.system_state where key='eumetsat_lsa_saf'),'{}'::jsonb),
    'monitor_eumetsat',coalesce((select value from public.system_state where key='monitor_eumetsat'),'{}'::jsonb),
    'monitor_sentinel3_slstr',coalesce((select value from public.system_state where key='monitor_sentinel3_slstr'),'{}'::jsonb),
    'admin_bot_state',coalesce((select value from public.system_state where key='admin_bot_state'),'{}'::jsonb)
  ) from s;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_analytics_summary(p_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_hours integer:=greatest(1,least(coalesce(p_hours,24),8760));
  v_from timestamptz:=now()-make_interval(hours=>greatest(1,least(coalesce(p_hours,24),8760)));
begin
  return jsonb_build_object(
    'window_hours',v_hours,
    'from',v_from,
    'generated_at',now(),
    'events',(
      select jsonb_build_object(
        'total',count(*) filter(where e.first_seen>=v_from),
        'new',count(*) filter(where e.first_seen>=v_from),
        'active',count(*) filter(where e.first_seen>=v_from and e.lifecycle_status<>'closed'),
        'closed',count(*) filter(where e.first_seen>=v_from and e.lifecycle_status='closed'),
        'telegram_sent',count(*) filter(where e.telegram_sent_at>=v_from),
        'multisource',count(*) filter(where e.first_seen>=v_from and e.multisource_count>=2),
        'surface_ready',count(*) filter(where e.first_seen>=v_from and se.status='ready'),
        'touched',count(*) filter(where e.last_seen>=v_from),
        'touched_active',count(*) filter(where e.last_seen>=v_from and e.lifecycle_status<>'closed'),
        'touched_closed',count(*) filter(where e.last_seen>=v_from and e.lifecycle_status='closed')
      )
      from public.fire_events e
      left join public.satellite_surface_evidence se on se.fire_event_id=e.id
    ),
    'by_oblast',coalesce((
      select jsonb_agg(jsonb_build_object('oblast',oblast,'events',n) order by n desc,oblast)
      from (
        select o.name_uk oblast,count(e.id) n
        from public.oblasts o
        left join public.fire_events e on e.oblast_id=o.id and e.first_seen>=v_from
        group by o.id,o.name_uk
        order by count(e.id) desc,o.name_uk
      ) x
    ),'[]'::jsonb),
    'by_oblast_touched',coalesce((
      select jsonb_agg(jsonb_build_object('oblast',oblast,'events',n) order by n desc,oblast)
      from (
        select o.name_uk oblast,count(e.id) n
        from public.oblasts o
        left join public.fire_events e on e.oblast_id=o.id and e.last_seen>=v_from
        group by o.id,o.name_uk
        order by count(e.id) desc,o.name_uk
      ) x
    ),'[]'::jsonb),
    'by_source',coalesce((
      select jsonb_agg(jsonb_build_object('source',source,'detections',n) order by n desc,source)
      from (
        select d.source,count(*) n
        from public.detections d
        where d.acq_datetime>=v_from
        group by d.source
        order by count(*) desc
      ) x
    ),'[]'::jsonb),
    'frp',(
      select jsonb_build_object(
        'max_mw',max(d.frp),
        'avg_mw',round(avg(d.frp)::numeric,2),
        'detections',count(*)
      )
      from public.detections d
      where d.acq_datetime>=v_from and d.frp is not null
    ),
    'quality',jsonb_build_object(
      'notification_integrity',coalesce((select value from public.system_state where key='monitor_notification_integrity'),'{}'::jsonb),
      'source_coverage',coalesce((select value from public.system_state where key='monitor_source_coverage'),'{}'::jsonb),
      'source_baseline',coalesce((select value from public.system_state where key='monitor_source_baseline'),'{}'::jsonb),
      'geo_integrity',coalesce((select value from public.system_state where key='monitor_geo_integrity'),'{}'::jsonb)
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_build_event_dossier(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  d jsonb;
  s public.satellite_surface_evidence%rowtype;
  v_flags text[] := '{}';
  v_classes text[] := '{}';
  v_surface jsonb;
begin
  d:=public.firewatch_build_event_dossier_stage28(p_event);
  if d is null then return null; end if;

  select * into s from public.satellite_surface_evidence where fire_event_id=p_event;

  if found then
    select coalesce(array_agg(value),'{}'::text[]) into v_flags
    from jsonb_array_elements_text(coalesce(d->'context_flags','[]'::jsonb));
    select coalesce(array_agg(value),'{}'::text[]) into v_classes
    from jsonb_array_elements_text(coalesce(d->'evidence_classes','[]'::jsonb));

    if not ('satellite_surface'=any(v_classes)) then v_classes:=array_append(v_classes,'satellite_surface'); end if;
    if s.before_item_id is not null and not ('sentinel2_before_available'=any(v_flags)) then v_flags:=array_append(v_flags,'sentinel2_before_available'); end if;
    if s.after_item_id is not null and not ('sentinel2_after_available'=any(v_flags)) then v_flags:=array_append(v_flags,'sentinel2_after_available'); end if;
    if s.status='ready' and not ('surface_change_pair_ready'=any(v_flags)) then v_flags:=array_append(v_flags,'surface_change_pair_ready'); end if;
    if s.visual_status='ready' and not ('surface_visual_ready'=any(v_flags)) then v_flags:=array_append(v_flags,'surface_visual_ready'); end if;

    v_surface:=jsonb_build_object(
      'provider',s.provider,'collection',s.collection,'algorithm_version',s.algorithm_version,
      'status',s.status,'searched_at',s.searched_at,'next_retry_at',s.next_retry_at,
      'roi_radius_m',s.roi_radius_m,'max_scene_cloud_pct',s.max_scene_cloud_pct,
      'before',case when s.before_item_id is null then null else jsonb_build_object(
        'item_id',s.before_item_id,'datetime',s.before_datetime,'cloud_pct',s.before_cloud_pct,
        'local_valid_fraction',s.before_local_valid_fraction,'nbr',s.before_nbr,'ndvi',s.before_ndvi,
        'thumbnail_url',s.before_thumbnail_url,'stac_url',s.before_stac_url
      ) end,
      'after',case when s.after_item_id is null then null else jsonb_build_object(
        'item_id',s.after_item_id,'datetime',s.after_datetime,'cloud_pct',s.after_cloud_pct,
        'local_valid_fraction',s.after_local_valid_fraction,'nbr',s.after_nbr,'ndvi',s.after_ndvi,
        'thumbnail_url',s.after_thumbnail_url,'stac_url',s.after_stac_url
      ) end,
      'dnbr',s.dnbr,'dndvi',s.dndvi,'spectral_change_magnitude',s.spectral_change_magnitude,
      'visual',jsonb_build_object(
        'status',s.visual_status,'version',s.visual_version,'storage_path',s.visual_storage_path,
        'generated_at',s.visual_generated_at,'bytes',s.visual_bytes,'last_error',s.visual_last_error
      ),
      'method','Sentinel-2 L2A; local median NBR/NDVI with SCL cloud mask',
      'note','Before/after surface spectral evidence is contextual only and does not establish event cause.'
    );

    d:=d || jsonb_build_object(
      'schema_version','stage29.1-dossier-v1',
      'satellite_surface',v_surface,
      'context_flags',to_jsonb(v_flags),
      'evidence_classes',to_jsonb(v_classes)
    );
  else
    d:=d || jsonb_build_object(
      'schema_version','stage29.1-dossier-v1',
      'satellite_surface',jsonb_build_object('status','pending','visual',jsonb_build_object('status','pending'))
    );
  end if;
  return d;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_build_event_dossier_stage28(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  e public.fire_events%rowtype;
  g public.geo_osint_event_cache%rowtype;
  o_name text;
  v_point geography(Point,4326);
  v_satellite_stats jsonb := '[]'::jsonb;
  v_raw_observations integer := 0;
  v_frp_max double precision;
  v_frp_avg double precision;
  v_ground jsonb := '[]'::jsonb;
  v_ground_stations integer := 0;
  v_ground_sources integer := 0;
  v_external jsonb := '[]'::jsonb;
  v_external_count integer := 0;
  v_external_sources integer := 0;
  v_flags text[] := '{}';
  v_classes text[] := '{}';
  v_duration_min double precision := 0;
  v_infra_count integer := 0;
  v_general_count integer := 0;
  v_sat_count integer := 0;
  v_oim_url text;
  v_dossier jsonb;
begin
  select * into e from public.fire_events where id=p_event;
  if not found then return null; end if;

  select name_uk into o_name from public.oblasts where id=e.oblast_id;
  v_point := coalesce(e.best_location,e.last_location,e.first_location);
  v_duration_min := greatest(0,extract(epoch from (e.last_seen-e.first_seen))/60.0);

  select coalesce(jsonb_agg(jsonb_build_object(
           'source',s.label,
           'observations',s.n,
           'first_seen',s.first_seen,
           'last_seen',s.last_seen,
           'frp_max_mw',case when s.frp_max is null then null else round(s.frp_max::numeric,2) end,
           'frp_avg_mw',case when s.frp_avg is null then null else round(s.frp_avg::numeric,2) end
         ) order by s.last_seen desc),'[]'::jsonb),
         coalesce(sum(s.n),0),
         max(s.frp_max),
         case when sum(s.n) filter (where s.frp_avg is not null)>0
              then sum(s.frp_avg*s.n) filter (where s.frp_avg is not null)
                   / nullif(sum(s.n) filter (where s.frp_avg is not null),0)
              else null end
    into v_satellite_stats,v_raw_observations,v_frp_max,v_frp_avg
  from (
    select label,count(*)::integer n,min(acq_datetime) first_seen,max(acq_datetime) last_seen,
           max(frp) frp_max,avg(frp) frp_avg
    from (
      select coalesce(nullif(trim(satellite),''),nullif(trim(source),''),'FIRMS') label,acq_datetime,frp
      from public.detections where event_id=p_event
      union all
      select coalesce(nullif(trim(platform),''),nullif(trim(source),''),'EUMETSAT') label,acq_datetime,frp
      from public.eumetsat_frp_detections where event_id=p_event
    ) x
    group by label
  ) s;

  v_sat_count := greatest(coalesce(e.multisource_count,0),jsonb_array_length(v_satellite_stats));
  if v_sat_count>0 then v_classes:=array_append(v_classes,'satellite'); end if;

  select * into g from public.geo_osint_event_cache where fire_event_id=p_event;
  if found then
    v_general_count:=coalesce(g.feature_count,0);
    v_infra_count:=coalesce(jsonb_array_length(g.infrastructure_features),0);
    v_oim_url:=g.openinframap_url;
    v_classes:=array_append(v_classes,'geospatial');
    if v_infra_count>0 then v_classes:=array_append(v_classes,'infrastructure'); end if;
  end if;

  if v_point is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'source',q.source,
             'station_id',q.station_id,
             'station_name',q.station_name,
             'parameter',q.parameter,
             'value',q.value,
             'unit',q.unit,
             'observed_at',q.observed_at,
             'distance_km',round((q.distance_m/1000.0)::numeric,1),
             'time_delta_h',round((q.time_delta_s/3600.0)::numeric,1),
             'is_old',q.is_old
           ) order by q.distance_m,q.observed_at desc),'[]'::jsonb),
           count(distinct (q.source,q.station_id)),
           count(distinct q.source)
      into v_ground,v_ground_stations,v_ground_sources
    from (
      select x.*,
             st_distance(x.location,v_point) distance_m,
             abs(extract(epoch from (x.observed_at-e.last_seen))) time_delta_s
      from public.ground_sensor_latest x
      where st_dwithin(x.location,v_point,25000)
        and x.observed_at between e.last_seen-interval '12 hours' and e.last_seen+interval '12 hours'
      order by st_distance(x.location,v_point),x.observed_at desc
      limit 12
    ) q;
  end if;
  if v_ground_stations>0 then v_classes:=array_append(v_classes,'ground'); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'source',x.source,
           'source_event_id',x.source_event_id,
           'title',x.title,
           'category',x.category,
           'observed_at',x.observed_at,
           'distance_km',case when x.distance_m is null then null else round((x.distance_m/1000.0)::numeric,1) end,
           'time_delta_h',case when x.time_delta_minutes is null then null else round((x.time_delta_minutes/60.0)::numeric,1) end,
           'correlation_class',x.correlation_class,
           'source_url',x.source_url
         ) order by x.observed_at desc),'[]'::jsonb),
         count(*),count(distinct x.source)
    into v_external,v_external_count,v_external_sources
  from (
    select * from public.osint_evidence
    where fire_event_id=p_event
    order by observed_at desc
    limit 20
  ) x;
  if v_external_count>0 then v_classes:=array_append(v_classes,'external_osint'); end if;

  if coalesce(e.cams_observed_at,e.s5p_co_observed_at,e.s5p_aer_observed_at) is not null
     or e.atmosphere_signal_level is not null then
    v_classes:=array_append(v_classes,'atmosphere');
  end if;
  if coalesce(e.history_archive_loaded,false) or coalesce(e.history_events_365d,0)>0 then
    v_classes:=array_append(v_classes,'history');
  end if;

  -- Transparent descriptive context flags.
  if coalesce(e.multisource_count,0)>=2 then v_flags:=array_append(v_flags,'multi_satellite_confirmed'); end if;
  if coalesce(e.history_events_30d,0)>0 then v_flags:=array_append(v_flags,'repeat_hotspot_30d'); end if;
  if coalesce(e.history_events_365d,0)>0 then v_flags:=array_append(v_flags,'repeat_hotspot_365d'); end if;
  if v_duration_min>=180 then v_flags:=array_append(v_flags,'persistent_gt_3h'); end if;
  if coalesce(v_frp_max,e.frp_latest_avg,0)>=50 then v_flags:=array_append(v_flags,'frp_ge_50mw'); end if;
  if coalesce(e.cluster_diameter_m,0)>=1000 then v_flags:=array_append(v_flags,'cluster_ge_1km'); end if;
  if e.plume_forecast is not null and e.plume_forecast<>'{}'::jsonb then v_flags:=array_append(v_flags,'wind_transport_context'); end if;
  if coalesce(e.atmosphere_signal_level,'background') not in ('background','none','unknown') then
    v_flags:=array_append(v_flags,'atmospheric_signal_above_background');
  end if;
  if v_ground_stations>0 then v_flags:=array_append(v_flags,'ground_sensor_context'); end if;
  if v_external_count>0 then v_flags:=array_append(v_flags,'external_osint_match'); end if;
  if v_infra_count>0 then v_flags:=array_append(v_flags,'infrastructure_context'); end if;

  if g.fire_event_id is not null then
    if exists (
      select 1 from jsonb_array_elements(g.infrastructure_features) z
      where z->>'infra_type'='power_line' and coalesce((z->>'distance_m')::double precision,1e12)<=500
    ) then v_flags:=array_append(v_flags,'near_power_line_500m'); end if;

    if exists (
      select 1 from jsonb_array_elements(g.infrastructure_features) z
      where z->>'infra_type' in ('power_line','power_substation','power_plant','power_generator','power_transformer')
        and coalesce((z->>'distance_m')::double precision,1e12)<=2000
    ) then v_flags:=array_append(v_flags,'near_power_infrastructure_2km'); end if;

    if exists (
      select 1 from jsonb_array_elements(g.infrastructure_features) z
      where z->>'infra_type' in ('petroleum_pipeline','water_pipeline','other_pipeline')
        and coalesce((z->>'distance_m')::double precision,1e12)<=1000
    ) then v_flags:=array_append(v_flags,'near_pipeline_1km'); end if;

    if exists (
      select 1 from jsonb_array_elements(g.features) z
      where z->>'category'='industrial' and coalesce((z->>'distance_m')::double precision,1e12)<=2000
    ) then v_flags:=array_append(v_flags,'near_industrial_2km'); end if;

    if exists (
      select 1 from jsonb_array_elements(g.features) z
      where z->>'category'='forest' and coalesce((z->>'distance_m')::double precision,1e12)<=500
    ) then v_flags:=array_append(v_flags,'forest_context'); end if;

    if exists (
      select 1 from jsonb_array_elements(g.features) z
      where z->>'category'='agriculture' and coalesce((z->>'distance_m')::double precision,1e12)<=500
    ) then v_flags:=array_append(v_flags,'agriculture_context'); end if;

    if exists (
      select 1 from jsonb_array_elements(g.features) z
      where z->>'category'='settlement' and coalesce((z->>'distance_m')::double precision,1e12)<=2000
    ) then v_flags:=array_append(v_flags,'settlement_near_2km'); end if;
  end if;

  v_dossier:=jsonb_build_object(
    'schema_version','stage28-dossier-v1',
    'generated_at',now(),
    'event',jsonb_build_object(
      'id',e.id,
      'status',e.status,
      'lifecycle_status',e.lifecycle_status,
      'first_seen',e.first_seen,
      'last_seen',e.last_seen,
      'duration_minutes',round(v_duration_min::numeric,1),
      'observation_count',e.observation_count,
      'oblast',o_name,
      'latitude',coalesce(e.best_latitude,e.last_latitude,e.first_latitude),
      'longitude',coalesce(e.best_longitude,e.last_longitude,e.first_longitude),
      'nearest_place',e.nearest_place_name,
      'nearest_place_distance_km',e.nearest_place_distance_km,
      'confidence_level',e.event_confidence_level,
      'confidence_label',e.event_confidence_label,
      'reliability_level',e.reliability_level
    ),
    'satellite',jsonb_build_object(
      'source_count',v_sat_count,
      'declared_sources',coalesce(e.multisource_sources,'[]'::jsonb),
      'raw_observations',v_raw_observations,
      'source_stats',v_satellite_stats,
      'frp_max_mw',case when v_frp_max is null then null else round(v_frp_max::numeric,2) end,
      'frp_avg_mw',case when v_frp_avg is null then null else round(v_frp_avg::numeric,2) end,
      'frp_latest_avg_mw',e.frp_latest_avg,
      'frp_previous_avg_mw',e.frp_previous_avg,
      'frp_change_pct',e.frp_change_pct,
      'frp_trend',e.frp_trend,
      'cluster_diameter_m',e.cluster_diameter_m
    ),
    'atmosphere',jsonb_build_object(
      'signal_level',e.atmosphere_signal_level,
      'cams_observed_at',e.cams_observed_at,
      'cams_pm2_5_ug_m3',e.cams_pm2_5_ug_m3,
      'cams_co_ug_m3',e.cams_carbon_monoxide_ug_m3,
      'cams_aod',e.cams_aerosol_optical_depth,
      'cams_pm10_wildfires_ug_m3',e.cams_pm10_wildfires_ug_m3,
      'cams_european_aqi',e.cams_european_aqi,
      's5p_co_observed_at',e.s5p_co_observed_at,
      's5p_co_mol_m2',e.s5p_co_mol_m2,
      's5p_aer_observed_at',e.s5p_aer_observed_at,
      's5p_aer_ai_340_380',e.s5p_aer_ai_340_380,
      'plume_direction_deg',e.plume_direction_deg,
      'plume_forecast',coalesce(e.plume_forecast,'{}'::jsonb),
      'note','Atmospheric products are contextual and non-attributive.'
    ),
    'geospatial',jsonb_build_object(
      'context_type',g.context_type,
      'nearest_feature',g.nearest_feature,
      'nearest_feature_distance_m',g.nearest_feature_distance_m,
      'feature_count',v_general_count,
      'categories',coalesce(g.categories,'{}'::jsonb),
      'features',coalesce(g.features,'[]'::jsonb),
      'queried_at',g.queried_at,
      'source',g.endpoint
    ),
    'infrastructure',jsonb_build_object(
      'profile_version',g.infra_profile_version,
      'feature_count',v_infra_count,
      'counts',coalesce(g.infrastructure_counts,'{}'::jsonb),
      'nearest',g.nearest_infrastructure,
      'features',coalesce(g.infrastructure_features,'[]'::jsonb),
      'openinframap_url',v_oim_url,
      'note','Infrastructure proximity is descriptive public-map context only.'
    ),
    'ground',jsonb_build_object(
      'station_count',v_ground_stations,
      'source_count',v_ground_sources,
      'measurements',v_ground,
      'radius_km',25,
      'time_window_hours',12,
      'note','Ground measurements are contextual and do not establish source attribution.'
    ),
    'external_osint',jsonb_build_object(
      'evidence_count',v_external_count,
      'source_count',v_external_sources,
      'evidence',v_external,
      'note','Spatiotemporal correlation does not establish causation.'
    ),
    'history',jsonb_build_object(
      'events_30d',coalesce(e.history_events_30d,0),
      'events_90d',coalesce(e.history_events_90d,0),
      'events_365d',coalesce(e.history_events_365d,0),
      'days_30d',coalesce(e.history_days_30d,0),
      'days_90d',coalesce(e.history_days_90d,0),
      'days_365d',coalesce(e.history_days_365d,0),
      'max_frp_365d',e.history_max_frp_365d,
      'archive_cells_365d',coalesce(e.history_archive_cells_365d,0),
      'archive_loaded',coalesce(e.history_archive_loaded,false),
      'hotspot_class',e.hotspot_class,
      'radius_m',e.history_radius_m
    ),
    'context_flags',to_jsonb(v_flags),
    'evidence_classes',to_jsonb(v_classes),
    'summary',e.event_summary,
    'disclaimer','The dossier aggregates public-source observations. Context flags are descriptive and do not identify a cause.'
  );
  return v_dossier;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_build_event_dossier_stage37(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  d jsonb;
  v_news jsonb := '[]'::jsonb;
  v_news_count integer := 0;
  v_news_sources integer := 0;
  v_alerts jsonb := '[]'::jsonb;
  v_alert_count integer := 0;
  v_classes text[] := '{}';
  v_flags text[] := '{}';
begin
  d:=public.firewatch_build_event_dossier(p_event);
  if d is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'source',x.source_name,
      'published_at',x.published_at,
      'title',x.title,
      'url',x.source_url,
      'category',x.category,
      'relevance_score',x.relevance_score,
      'match_basis',x.match_basis
    ) order by x.published_at desc),'[]'::jsonb),
    count(*),count(distinct x.source_name)
  into v_news,v_news_count,v_news_sources
  from (
    select * from public.event_public_osint
    where fire_event_id=p_event and source_kind='news'
    order by published_at desc nulls last,last_seen_at desc
    limit 20
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
      'source',x.source_name,
      'observed_at',x.published_at,
      'title',x.title,
      'category',x.category,
      'match_basis',x.match_basis
    ) order by x.published_at desc),'[]'::jsonb),
    count(*)
  into v_alerts,v_alert_count
  from (
    select * from public.event_public_osint
    where fire_event_id=p_event and source_kind='air_alert'
    order by published_at desc nulls last,last_seen_at desc
    limit 10
  ) x;

  select coalesce(array_agg(value),'{}'::text[]) into v_classes
  from jsonb_array_elements_text(coalesce(d->'evidence_classes','[]'::jsonb));
  select coalesce(array_agg(value),'{}'::text[]) into v_flags
  from jsonb_array_elements_text(coalesce(d->'context_flags','[]'::jsonb));

  if v_news_count>0 and not ('public_news'=any(v_classes)) then v_classes:=array_append(v_classes,'public_news'); end if;
  if v_alert_count>0 and not ('air_alert_context'=any(v_classes)) then v_classes:=array_append(v_classes,'air_alert_context'); end if;
  if v_news_count>0 and not ('public_news_match'=any(v_flags)) then v_flags:=array_append(v_flags,'public_news_match'); end if;
  if v_alert_count>0 and not ('air_alert_overlap_context'=any(v_flags)) then v_flags:=array_append(v_flags,'air_alert_overlap_context'); end if;

  return d || jsonb_build_object(
    'schema_version','stage37-event-osint-v1',
    'public_osint',jsonb_build_object(
      'news_count',v_news_count,
      'news_source_count',v_news_sources,
      'news',v_news,
      'air_alert_context_count',v_alert_count,
      'air_alert_context',v_alerts,
      'note','News and alert matches are contextual public-source evidence. Temporal or geographic overlap does not establish cause.'
    ),
    'evidence_classes',to_jsonb(v_classes),
    'context_flags',to_jsonb(v_flags)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_build_event_dossier_stage371(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  d jsonb;
  v_tg jsonb := '[]'::jsonb;
  v_tg_count integer := 0;
  v_tg_sources integer := 0;
  v_classes text[] := '{}';
  v_flags text[] := '{}';
begin
  d:=public.firewatch_build_event_dossier_stage37(p_event);
  if d is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'source',x.source_name,
      'published_at',x.published_at,
      'title',x.title,
      'url',x.source_url,
      'relevance_score',x.relevance_score,
      'match_basis',x.match_basis
    ) order by x.published_at desc),'[]'::jsonb),
    count(*),count(distinct x.source_name)
  into v_tg,v_tg_count,v_tg_sources
  from (
    select * from public.event_public_osint
    where fire_event_id=p_event and source_kind='telegram'
    order by published_at desc nulls last,last_seen_at desc
    limit 20
  ) x;

  select coalesce(array_agg(value),'{}'::text[]) into v_classes
  from jsonb_array_elements_text(coalesce(d->'evidence_classes','[]'::jsonb));
  select coalesce(array_agg(value),'{}'::text[]) into v_flags
  from jsonb_array_elements_text(coalesce(d->'context_flags','[]'::jsonb));

  if v_tg_count>0 and not ('public_telegram'=any(v_classes)) then
    v_classes:=array_append(v_classes,'public_telegram');
  end if;
  if v_tg_count>0 and not ('public_telegram_match'=any(v_flags)) then
    v_flags:=array_append(v_flags,'public_telegram_match');
  end if;

  return d || jsonb_build_object(
    'schema_version','stage37.1-event-osint-v1',
    'public_osint',
      coalesce(d->'public_osint','{}'::jsonb) ||
      jsonb_build_object(
        'telegram_count',v_tg_count,
        'telegram_source_count',v_tg_sources,
        'telegram',v_tg
      ),
    'evidence_classes',to_jsonb(v_classes),
    'context_flags',to_jsonb(v_flags)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_build_event_dossier_stage373(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  d jsonb;
  v_air jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_classes text[] := '{}';
  v_flags text[] := '{}';
begin
  d:=public.firewatch_build_event_dossier_stage371(p_event);
  if d is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'track_id',x.track_id,
    'type',x.threat_type,
    'label',x.label,
    'nearest_distance_m',x.nearest_distance_m,
    'nearest_at',x.nearest_at,
    'time_offset_seconds',x.time_offset_seconds,
    'heading_deg',x.heading_deg,
    'group_count',x.group_count,
    'confidence_0_100',x.confidence_0_100,
    'place',x.place,
    'description',x.description,
    'source',x.source_name,
    'url',x.source_url
  ) order by x.nearest_distance_m asc),'[]'::jsonb),
  count(*)
  into v_air,v_count
  from (
    select * from public.event_air_threat_context
    where fire_event_id=p_event
    order by nearest_distance_m asc, abs(time_offset_seconds) asc
    limit 10
  ) x;

  select coalesce(array_agg(value),'{}'::text[]) into v_classes
  from jsonb_array_elements_text(coalesce(d->'evidence_classes','[]'::jsonb));
  select coalesce(array_agg(value),'{}'::text[]) into v_flags
  from jsonb_array_elements_text(coalesce(d->'context_flags','[]'::jsonb));

  if v_count>0 and not ('air_threat_context'=any(v_classes)) then
    v_classes:=array_append(v_classes,'air_threat_context');
  end if;
  if v_count>0 and not ('neptun_track_proximity'=any(v_flags)) then
    v_flags:=array_append(v_flags,'neptun_track_proximity');
  end if;

  return d || jsonb_build_object(
    'schema_version','stage37.3-event-osint-v1',
    'air_threat_context',jsonb_build_object(
      'source','Neptun',
      'count',v_count,
      'tracks',v_air,
      'note','Public air-threat track proximity is contextual evidence only. Spatial or temporal proximity does not establish causation.'
    ),
    'evidence_classes',to_jsonb(v_classes),
    'context_flags',to_jsonb(v_flags)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_client_access(p_telegram_user_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (
      select jsonb_build_object(
        'registered', true,
        'allowed', status='active',
        'status', status,
        'role', role
      )
      from public.client_users
      where telegram_user_id = p_telegram_user_id
    ),
    jsonb_build_object(
      'registered', false,
      'allowed', false,
      'status', 'new',
      'role', null
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_client_create_invite(p_code text, p_role text DEFAULT 'premium'::text, p_max_uses integer DEFAULT 1, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hash text;
  v_id uuid;
begin
  if p_code is null or length(trim(p_code)) < 10 then
    raise exception 'invite code must be at least 10 characters';
  end if;
  if p_role <> 'premium' then
    raise exception 'only premium role is supported';
  end if;
  if p_max_uses < 1 then
    raise exception 'max_uses must be >= 1';
  end if;

  v_hash := encode(extensions.digest(trim(p_code), 'sha256'),'hex');

  insert into public.client_invites(code_hash,role,max_uses,expires_at,label)
  values(v_hash,'premium',p_max_uses,p_expires_at,p_label)
  returning id into v_id;

  return jsonb_build_object(
    'ok',true,
    'invite_id',v_id,
    'role','premium',
    'max_uses',p_max_uses,
    'expires_at',p_expires_at
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_client_increment_request(p_telegram_user_id bigint)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.client_users
  set request_count=request_count+1,
      last_seen_at=now(),
      updated_at=now()
  where telegram_user_id=p_telegram_user_id
    and status='active';
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_client_redeem_invite(p_telegram_user_id bigint, p_code text, p_username text DEFAULT NULL::text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_hash text;
  inv public.client_invites;
  u public.client_users;
begin
  if p_code is null or length(trim(p_code)) < 6 then
    insert into public.client_audit_log(telegram_user_id,action,result,meta)
    values(p_telegram_user_id,'invite_redeem','invalid_format','{}');
    return jsonb_build_object('ok',false,'error','invalid_invite');
  end if;

  v_hash := encode(extensions.digest(trim(p_code), 'sha256'),'hex');

  select * into inv
  from public.client_invites
  where code_hash=v_hash
  for update;

  if not found
     or not inv.enabled
     or inv.used_count>=inv.max_uses
     or (inv.expires_at is not null and inv.expires_at<=now()) then
    insert into public.client_audit_log(telegram_user_id,action,result,meta)
    values(p_telegram_user_id,'invite_redeem','rejected',
      jsonb_build_object('reason',
        case
          when not found then 'not_found'
          when inv.enabled is false then 'disabled'
          when inv.used_count>=inv.max_uses then 'exhausted'
          else 'expired'
        end));
    return jsonb_build_object('ok',false,'error','invalid_or_expired_invite');
  end if;

  insert into public.client_users(
    telegram_user_id,username,first_name,last_name,
    role,status,activated_at,last_seen_at,updated_at
  )
  values(
    p_telegram_user_id,nullif(p_username,''),nullif(p_first_name,''),nullif(p_last_name,''),
    'premium','active',now(),now(),now()
  )
  on conflict (telegram_user_id) do update set
    username=excluded.username,
    first_name=excluded.first_name,
    last_name=excluded.last_name,
    role='premium',
    status='active',
    activated_at=coalesce(public.client_users.activated_at,now()),
    last_seen_at=now(),
    updated_at=now()
  returning * into u;

  update public.client_invites
  set used_count=used_count+1,
      enabled=case when used_count+1>=max_uses then false else enabled end,
      updated_at=now()
  where id=inv.id;

  insert into public.client_audit_log(telegram_user_id,action,result,meta)
  values(p_telegram_user_id,'invite_redeem','activated',
    jsonb_build_object('role','premium','invite_id',inv.id));

  return jsonb_build_object(
    'ok',true,
    'status',u.status,
    'role','premium',
    'activated_at',u.activated_at
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_client_touch_user(p_telegram_user_id bigint, p_username text DEFAULT NULL::text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  u public.client_users;
begin
  insert into public.client_users(
    telegram_user_id, username, first_name, last_name, last_seen_at, updated_at
  )
  values(
    p_telegram_user_id, nullif(p_username,''), nullif(p_first_name,''), nullif(p_last_name,''), now(), now()
  )
  on conflict (telegram_user_id) do update set
    username = excluded.username,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    last_seen_at = now(),
    updated_at = now()
  returning * into u;

  return jsonb_build_object(
    'telegram_user_id', u.telegram_user_id,
    'role', u.role,
    'status', u.status,
    'activated_at', u.activated_at
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_cron_health_summary()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'active_jobs', count(*) filter (where active),
    'second_level_jobs', count(*) filter (
      where active and lower(schedule) ~ '(^|[^a-z])(second|seconds)([^a-z]|$)'
    ),
    'second_level_job_ids', coalesce(
      jsonb_agg(jobid order by jobid) filter (
        where active and lower(schedule) ~ '(^|[^a-z])(second|seconds)([^a-z]|$)'
      ),
      '[]'::jsonb
    )
  )
  from cron.job;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_dossier(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_event uuid;
  v_event_updated timestamptz;
  v_built timestamptz;
  d jsonb;
begin
  if nullif(trim(p_query),'') is null then
    select id,updated_at into v_event,v_event_updated
    from public.fire_events order by last_seen desc limit 1;
  else
    select id,updated_at into v_event,v_event_updated
    from public.fire_events
    where lower(id::text) like lower(trim(p_query)) || '%'
    order by last_seen desc limit 1;
  end if;
  if v_event is null then return null; end if;

  select built_at,dossier into v_built,d
  from public.event_osint_dossiers where fire_event_id=v_event;

  if d is null or v_built is null or v_built<v_event_updated or v_built<now()-interval '30 minutes' then
    d:=public.firewatch_refresh_event_dossier(v_event);
  end if;
  return d;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_event_detail(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  e public.fire_events%rowtype;
  v_oblast text;
  v_query text := trim(coalesce(p_query,''));
begin
  if v_query='' then
    select * into e from public.fire_events order by last_seen desc limit 1;
  elsif length(v_query)>=8 then
    select * into e from public.fire_events
    where id::text=v_query or id::text like v_query||'%'
    order by last_seen desc limit 1;
  else
    raise exception 'Event query must be empty or at least 8 characters';
  end if;

  if e.id is null then return null; end if;
  select name_uk into v_oblast from public.oblasts where id=e.oblast_id;

  return jsonb_build_object(
    'id',e.id,'oblast',v_oblast,'first_seen',e.first_seen,'last_seen',e.last_seen,
    'observation_count',e.observation_count,'lifecycle_status',e.lifecycle_status,
    'best_latitude',coalesce(e.best_latitude,e.last_latitude),
    'best_longitude',coalesce(e.best_longitude,e.last_longitude),
    'best_location_resolution_m',e.best_location_resolution_m,
    'multisource_count',e.multisource_count,'multisource_sources',e.multisource_sources,
    'event_confidence_level',e.event_confidence_level,'event_confidence_label',e.event_confidence_label,
    'frp_trend',e.frp_trend,'frp_latest_avg',e.frp_latest_avg,
    'frp_previous_avg',e.frp_previous_avg,'frp_change_pct',e.frp_change_pct,
    'cluster_diameter_m',e.cluster_diameter_m,'cluster_motion_m',e.cluster_motion_m,
    'cluster_motion_bearing_deg',e.cluster_motion_bearing_deg,
    'atmosphere_signal_level',e.atmosphere_signal_level,
    's5p_aer_ai_340_380',e.s5p_aer_ai_340_380,
    'cams_aerosol_optical_depth',e.cams_aerosol_optical_depth,
    'plume_direction_deg',e.plume_direction_deg,'plume_forecast',e.plume_forecast,
    'plume_reference_place',e.plume_reference_place,
    'plume_reference_place_distance_km',e.plume_reference_place_distance_km,
    'event_summary',e.event_summary,'intelligence_updated_at',e.intelligence_updated_at,
    'telegram_message_id',e.telegram_message_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_event_timeline(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query text:=trim(coalesce(p_query,''));
  v_event_id uuid;
  v_total integer:=0;
  v_points jsonb:='[]'::jsonb;
  v_sources jsonb:='[]'::jsonb;
  v_milestones jsonb:='[]'::jsonb;
  v_event jsonb;
begin
  if length(v_query)<8 then
    raise exception 'Event query must be at least 8 characters';
  end if;

  select id into v_event_id
  from public.fire_events
  where id::text=v_query or id::text like v_query||'%'
  order by last_seen desc
  limit 1;

  if v_event_id is null then
    return null;
  end if;

  select public.firewatch_event_detail(v_event_id::text) into v_event;

  select count(*) into v_total
  from public.detections
  where event_id=v_event_id;

  with x as (
    select
      d.id,d.source,d.satellite,d.instrument,d.acq_datetime,d.received_at,
      d.latitude,d.longitude,d.frp,d.confidence,d.daynight,
      case when d.received_at is not null and d.acq_datetime is not null
        then round((extract(epoch from (d.received_at-d.acq_datetime))/60.0)::numeric,1)
      end latency_min
    from public.detections d
    where d.event_id=v_event_id
    order by d.acq_datetime desc,d.created_at desc
    limit 300
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'source',source,'satellite',satellite,'instrument',instrument,
    'time',acq_datetime,'received_at',received_at,'latency_min',latency_min,
    'latitude',latitude,'longitude',longitude,'frp',frp,
    'confidence',confidence,'daynight',daynight
  ) order by acq_datetime asc),'[]'::jsonb)
  into v_points
  from x;

  with s as (
    select
      source,count(*) n,min(acq_datetime) first_seen,max(acq_datetime) last_seen,
      max(frp) max_frp,round(avg(frp)::numeric,2) avg_frp
    from public.detections
    where event_id=v_event_id
    group by source
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'source',source,'detections',n,'first_seen',first_seen,'last_seen',last_seen,
    'max_frp',max_frp,'avg_frp',avg_frp
  ) order by first_seen,source),'[]'::jsonb)
  into v_sources
  from s;

  with e as (
    select * from public.fire_events where id=v_event_id
  ), se as (
    select * from public.satellite_surface_evidence where fire_event_id=v_event_id
  ), dos as (
    select * from public.event_osint_dossiers where fire_event_id=v_event_id
  ), m as (
    select first_seen at,'event_first_seen' kind,'Первое тепловое обнаружение' label from e
    union all
    select telegram_sent_at,'telegram_sent','Первое сообщение Telegram' from e where telegram_sent_at is not null
    union all
    select multisource_updated_at,'multisource','Обновлена мультисенсорная агрегация' from e where multisource_updated_at is not null
    union all
    select atmosphere_updated_at,'atmosphere','Обновлён атмосферный контекст' from e where atmosphere_updated_at is not null
    union all
    select intelligence_updated_at,'intelligence','Обновлена событийная аналитика' from e where intelligence_updated_at is not null
    union all
    select built_at,'dossier','Построено OSINT-досье' from dos where built_at is not null
    union all
    select searched_at,'surface_search','Запущена проверка Sentinel-2' from se where searched_at is not null
    union all
    select after_datetime,'surface_after','Получено post-event Sentinel-2 наблюдение' from se where after_datetime is not null
    union all
    select updated_at,'event_closed','Событие закрыто' from e where lifecycle_status='closed'
  )
  select coalesce(jsonb_agg(jsonb_build_object('time',at,'kind',kind,'label',label) order by at),'[]'::jsonb)
  into v_milestones
  from m
  where at is not null;

  return jsonb_build_object(
    'event_id',v_event_id,
    'generated_at',now(),
    'event',v_event,
    'stats',jsonb_build_object(
      'detection_count',v_total,
      'timeline_points',jsonb_array_length(v_points),
      'truncated',v_total>300,
      'duration_hours',(
        select round((extract(epoch from (last_seen-first_seen))/3600.0)::numeric,2)
        from public.fire_events where id=v_event_id
      ),
      'max_frp',(select max(frp) from public.detections where event_id=v_event_id),
      'avg_frp',(select round(avg(frp)::numeric,2) from public.detections where event_id=v_event_id and frp is not null),
      'avg_latency_min',(
        select round(avg(extract(epoch from (received_at-acq_datetime))/60.0)::numeric,1)
        from public.detections
        where event_id=v_event_id and received_at is not null and acq_datetime is not null
      )
    ),
    'sources',v_sources,
    'points',v_points,
    'milestones',v_milestones
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_geo_context(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_event uuid;
  v_result jsonb;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event
    from public.fire_events
    order by last_seen desc
    limit 1;
  else
    select id into v_event
    from public.fire_events
    where lower(id::text) like lower(trim(p_query)) || '%'
    order by last_seen desc
    limit 1;
  end if;

  if v_event is null then return null; end if;

  select jsonb_build_object(
    'id',e.id,
    'last_seen',e.last_seen,
    'oblast',o.name_uk,
    'latitude',coalesce(e.best_latitude,e.last_latitude),
    'longitude',coalesce(e.best_longitude,e.last_longitude),
    'cache_available',c.fire_event_id is not null,
    'queried_at',c.queried_at,
    'query_radius_m',c.query_radius_m,
    'osm_base_at',c.osm_base_at,
    'endpoint',c.endpoint,
    'endpoint_method',c.endpoint_method,
    'feature_count',coalesce(c.feature_count,0),
    'context_type',c.context_type,
    'nearest_feature',c.nearest_feature,
    'nearest_feature_distance_m',c.nearest_feature_distance_m,
    'categories',coalesce(c.categories,'{}'::jsonb),
    'features',coalesce(c.features,'[]'::jsonb),
    'infra_profile_version',c.infra_profile_version,
    'infrastructure_counts',coalesce(c.infrastructure_counts,'{}'::jsonb),
    'infrastructure_features',coalesce(c.infrastructure_features,'[]'::jsonb),
    'nearest_infrastructure',c.nearest_infrastructure,
    'infrastructure_summary',coalesce(c.infrastructure_summary,'{}'::jsonb),
    'infrastructure_rings',coalesce(c.infrastructure_rings,'{}'::jsonb),
    'infrastructure_context_flags',coalesce(c.infrastructure_context_flags,'[]'::jsonb),
    'openinframap_url',c.openinframap_url,
    'last_error',c.last_error,
    'ghsl',case when g.fire_event_id is null then null else jsonb_build_object(
      'profile_version',g.profile_version,
      'epoch',g.epoch,
      'resolution',g.resolution,
      'queried_at',g.queried_at,
      'population_cell',g.population_cell,
      'built_surface_cell_m2',g.built_surface_cell_m2,
      'population_1km',g.population_1km,
      'population_5km',g.population_5km,
      'population_10km',g.population_10km,
      'built_surface_1km_m2',g.built_surface_1km_m2,
      'built_surface_5km_m2',g.built_surface_5km_m2,
      'built_surface_10km_m2',g.built_surface_10km_m2,
      'built_fraction_1km_pct',g.built_fraction_1km_pct,
      'built_fraction_5km_pct',g.built_fraction_5km_pct,
      'built_fraction_10km_pct',g.built_fraction_10km_pct,
      'last_error',g.last_error
    ) end
  ) into v_result
  from public.fire_events e
  left join public.oblasts o on o.id=e.oblast_id
  left join public.geo_osint_event_cache c on c.fire_event_id=e.id
  left join public.ghsl_event_cache g on g.fire_event_id=e.id
  where e.id=v_event;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_geo_integrity_refresh(p_records jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_now timestamptz:=now();
  v_total_api integer:=0;
  v_total_inside integer:=0;
  v_total_outside integer:=0;
  v_total_matched integer:=0;
  v_total_missing integer:=0;
begin
  if jsonb_typeof(p_records)<>'array' then
    raise exception 'p_records must be JSON array';
  end if;

  create temporary table if not exists fw_geo_audit_tmp(
    source text,
    satellite text,
    instrument text,
    acq_datetime timestamptz,
    latitude double precision,
    longitude double precision,
    detection_hash text,
    oblast_id bigint,
    oblast_name text,
    detection_id uuid,
    event_id uuid,
    telegram_sent boolean
  ) on commit drop;
  truncate fw_geo_audit_tmp;

  insert into fw_geo_audit_tmp(
    source,satellite,instrument,acq_datetime,latitude,longitude,
    detection_hash,oblast_id,oblast_name,detection_id,event_id,telegram_sent
  )
  select
    r.source,r.satellite,r.instrument,r.acq_datetime,r.latitude,r.longitude,
    encode(extensions.digest(concat_ws('|',
      coalesce(r.source,''),coalesce(r.satellite,''),coalesce(r.instrument,''),
      to_char(r.acq_datetime at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
      to_char(round(r.latitude::numeric,6),'FM999990.000000'),
      to_char(round(r.longitude::numeric,6),'FM999990.000000')
    ),'sha256'),'hex') detection_hash,
    o.id,o.name_uk,
    d.id,d.event_id,e.telegram_sent
  from jsonb_to_recordset(p_records) as r(
    source text,satellite text,instrument text,acq_datetime timestamptz,
    latitude double precision,longitude double precision
  )
  left join lateral (
    select ob.id,ob.name_uk
    from public.oblasts ob
    where extensions.st_covers(
      ob.geom,
      extensions.st_setsrid(extensions.st_makepoint(r.longitude,r.latitude),4326)
    )
    order by ob.id limit 1
  ) o on true
  left join public.detections d on d.detection_hash=encode(extensions.digest(concat_ws('|',
      coalesce(r.source,''),coalesce(r.satellite,''),coalesce(r.instrument,''),
      to_char(r.acq_datetime at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
      to_char(round(r.latitude::numeric,6),'FM999990.000000'),
      to_char(round(r.longitude::numeric,6),'FM999990.000000')
    ),'sha256'),'hex')
  left join public.fire_events e on e.id=d.event_id;

  delete from public.geo_integrity_source_current where source_id is not null;

  insert into public.geo_integrity_source_current(
    source_id,api_recent,inside_ukraine,outside_ukraine,db_matched,missing_in_db,status,refreshed_at
  )
  select source,
         count(*)::int,
         count(*) filter(where oblast_id is not null)::int,
         count(*) filter(where oblast_id is null)::int,
         count(*) filter(where oblast_id is not null and detection_id is not null)::int,
         count(*) filter(where oblast_id is not null and detection_id is null)::int,
         case when count(*) filter(where oblast_id is not null and detection_id is null)>0 then 'degraded' else 'active' end,
         v_now
  from fw_geo_audit_tmp
  group by source;

  delete from public.geo_integrity_oblast_current where oblast_id is not null;

  insert into public.geo_integrity_oblast_current(
    oblast_id,oblast_name,api_detections,db_matched,missing_in_db,
    distinct_events,telegram_events,source_breakdown,status,refreshed_at
  )
  select
    o.id,o.name_uk,
    count(t.*)::int,
    count(t.*) filter(where t.detection_id is not null)::int,
    count(t.*) filter(where t.detection_id is null)::int,
    count(distinct t.event_id)::int,
    count(distinct t.event_id) filter(where t.telegram_sent)::int,
    coalesce(jsonb_object_agg(t.source,t.n) filter(where t.source is not null),'{}'::jsonb),
    case
      when count(t.*)=0 then 'quiet'
      when count(t.*) filter(where t.detection_id is null)>0 then 'degraded'
      else 'active'
    end,
    v_now
  from public.oblasts o
  left join lateral (
    select x.source,count(*)::int n,
           x.detection_id,x.event_id,x.telegram_sent
    from fw_geo_audit_tmp x
    where x.oblast_id=o.id
    group by x.source,x.detection_id,x.event_id,x.telegram_sent
  ) t on true
  group by o.id,o.name_uk;

  select count(*)::int,
         count(*) filter(where oblast_id is not null)::int,
         count(*) filter(where oblast_id is null)::int,
         count(*) filter(where oblast_id is not null and detection_id is not null)::int,
         count(*) filter(where oblast_id is not null and detection_id is null)::int
  into v_total_api,v_total_inside,v_total_outside,v_total_matched,v_total_missing
  from fw_geo_audit_tmp;

  insert into public.system_state(key,value,updated_at)
  values(
    'monitor_geo_integrity',
    jsonb_build_object(
      'status',case when v_total_missing>0 then 'degraded' else 'active' end,
      'last_success_run',v_now,
      'api_recent',v_total_api,
      'inside_ukraine',v_total_inside,
      'outside_ukraine',v_total_outside,
      'db_matched',v_total_matched,
      'missing_in_db',v_total_missing,
      'oblasts_degraded',(select count(*) from public.geo_integrity_oblast_current where status='degraded'),
      'oblasts_active',(select count(*) from public.geo_integrity_oblast_current where status='active'),
      'oblasts_quiet',(select count(*) from public.geo_integrity_oblast_current where status='quiet'),
      'boundary_source','UN OCHA COD Ukraine ADM1 v05 / CDCgov mirror',
      'boundary_method','ST_Covers',
      'bbox','21.5,43.5,41.5,53.5',
      'window_hours',24
    ),
    v_now
  )
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  return (select value from public.system_state where key='monitor_geo_integrity');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_geo_integrity_summary()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
select jsonb_build_object(
  'state',coalesce((select value from public.system_state where key='monitor_geo_integrity'),'{}'::jsonb),
  'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.source_id) from public.geo_integrity_source_current s),'[]'::jsonb),
  'oblasts',coalesce((select jsonb_agg(to_jsonb(o) order by o.api_detections desc,o.oblast_name) from public.geo_integrity_oblast_current o),'[]'::jsonb)
);
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_ground_context(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_event uuid;
  v_point geography(Point,4326);
  v_seen timestamptz;
  v_result jsonb;
begin
  if nullif(trim(p_query),'') is null then
    select id,coalesce(best_location,last_location),last_seen
      into v_event,v_point,v_seen
    from public.fire_events
    order by last_seen desc
    limit 1;
  else
    select id,coalesce(best_location,last_location),last_seen
      into v_event,v_point,v_seen
    from public.fire_events
    where lower(id::text) like lower(trim(p_query)) || '%'
    order by last_seen desc
    limit 1;
  end if;

  if v_event is null or v_point is null then return null; end if;

  select jsonb_build_object(
    'id',e.id,
    'last_seen',e.last_seen,
    'oblast',o.name_uk,
    'latitude',coalesce(e.best_latitude,e.last_latitude),
    'longitude',coalesce(e.best_longitude,e.last_longitude),
    'station_count',(
      select count(distinct (g.source,g.station_id))
      from public.ground_sensor_latest g
      where st_dwithin(g.location,v_point,25000)
        and g.observed_at >= v_seen - interval '12 hours'
        and g.observed_at <= v_seen + interval '12 hours'
    ),
    'source_count',(
      select count(distinct g.source)
      from public.ground_sensor_latest g
      where st_dwithin(g.location,v_point,25000)
        and g.observed_at >= v_seen - interval '12 hours'
        and g.observed_at <= v_seen + interval '12 hours'
    ),
    'measurements',coalesce((
      select jsonb_agg(jsonb_build_object(
        'source',x.source,
        'station_id',x.station_id,
        'station_name',x.station_name,
        'provider',x.provider,
        'parameter',x.parameter,
        'value',x.value,
        'unit',x.unit,
        'observed_at',x.observed_at,
        'distance_km',round((st_distance(x.location,v_point)/1000.0)::numeric,1),
        'time_delta_h',round((abs(extract(epoch from (x.observed_at-v_seen)))/3600.0)::numeric,1),
        'is_old',x.is_old,
        'source_url',x.source_url
      ) order by st_distance(x.location,v_point), x.observed_at desc)
      from (
        select *
        from public.ground_sensor_latest g
        where st_dwithin(g.location,v_point,25000)
          and g.observed_at >= v_seen - interval '12 hours'
          and g.observed_at <= v_seen + interval '12 hours'
        order by st_distance(g.location,v_point),g.observed_at desc
        limit 20
      ) x
    ),'[]'::jsonb)
  ) into v_result
  from public.fire_events e
  left join public.oblasts o on o.id=e.oblast_id
  where e.id=v_event;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_maintenance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'net', 'pg_temp'
AS $function$
declare
  a int:=0;b int:=0;c int:=0;d int:=0;e int:=0;
begin
  delete from cron.job_run_details where start_time < now()-interval '7 days';
  get diagnostics a = row_count;

  delete from net._http_response where created < now()-interval '7 days';
  get diagnostics b = row_count;

  delete from public.processed_source_products where processed_at < now()-interval '30 days';
  get diagnostics c = row_count;

  delete from public.detections where received_at < now()-interval '90 days';
  get diagnostics d = row_count;

  delete from public.hotspot_history_daily where day < current_date-365;
  get diagnostics e = row_count;

  delete from public.firewatch_usage_daily where day < current_date-45;

  insert into public.system_state(key,value,updated_at)
  values('quota_guard',public.firewatch_quota_snapshot() || jsonb_build_object(
    'maintenance',jsonb_build_object(
      'cron_rows_deleted',a,
      'http_rows_deleted',b,
      'processed_products_deleted',c,
      'raw_detections_deleted',d,
      'history_rows_deleted',e
    )
  ),now())
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  return (select value from public.system_state where key='quota_guard');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_notification_integrity_refresh()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_started timestamptz:=clock_timestamp();
  v_now timestamptz:=now();
  v_total integer:=0;
  v_errors integer:=0;
  v_warnings integer:=0;
  v_info integer:=0;
begin
  delete from public.notification_integrity_findings;

  insert into public.notification_integrity_findings(
    fire_event_id,finding_class,severity,reason,sources,detection_count,source_count,
    first_detection,last_detection,queue_reason,queue_eligible_at,
    event_first_seen,event_last_seen,observation_count,multisource_count,refreshed_at
  )
  with b as (
    select coalesce((value->>'completed_at')::timestamptz,'epoch'::timestamptz) bootstrap_at
    from public.system_state where key='bootstrap'
  ), det as (
    select e.id,e.first_seen,e.last_seen,e.created_at,e.updated_at,e.status,
           e.notification_required,e.telegram_sent,e.telegram_sent_at,
           e.observation_count,e.multisource_count,
           array_agg(distinct d.source order by d.source) as sources,
           count(*)::int detection_count,
           count(distinct d.source)::int source_count,
           min(d.acq_datetime) first_detection,
           max(d.acq_datetime) last_detection,
           bool_or(
             d.source in ('VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT','VIIRS_SNPP_NRT','MODIS_NRT')
             and d.acq_datetime>=v_now-interval '24 hours'
           ) fresh_polar,
           bool_or(d.source='EUMETSAT_MTG_MTFRPPIXEL' and d.acq_datetime>=v_now-interval '24 hours') fresh_mtg,
           bool_or(d.source like 'COPERNICUS_S3_%' and d.acq_datetime>=v_now-interval '24 hours') fresh_s3
    from public.fire_events e
    join public.detections d on d.event_id=e.id
    where e.status<>'closed'
    group by e.id
  ), q as (
    select q.event_id,q.sync_reason,
           case
             when q.sync_reason='new' then e.created_at
             when q.sync_reason='close' then e.last_seen+interval '24 hours'
             else e.updated_at
           end eligible_at
    from public.fire_events_requiring_telegram_sync(500) q
    join public.fire_events e on e.id=q.event_id
  ), findings as (
    select d.*,
      q.sync_reason,q.eligible_at,
      case
        when d.notification_required=false and d.telegram_sent=false and d.fresh_polar
          then 'notification_gap'
        when d.notification_required=true and d.telegram_sent=false
             and q.sync_reason='new' and q.eligible_at < v_now-interval '45 minutes'
          then 'delivery_backlog'
        when d.notification_required=false and d.telegram_sent=false and d.fresh_mtg and d.fresh_s3
          then 'support_only_multi_sensor'
        when d.notification_required=false and d.telegram_sent=false and d.fresh_mtg
          then 'support_only_mtg'
        when d.notification_required=false and d.telegram_sent=false and d.fresh_s3
          then 'support_only_sentinel3'
        when d.notification_required=false and d.telegram_sent=false and d.last_detection < v_now-interval '24 hours'
          then 'historical_suppressed'
        when d.notification_required=false and d.telegram_sent=false
          then 'other_policy_suppressed'
        else null
      end finding_class
    from det d
    left join q on q.event_id=d.id
  )
  select
    id,
    finding_class,
    case
      when finding_class='notification_gap' then 'error'
      when finding_class='delivery_backlog' then 'warning'
      else 'info'
    end,
    case finding_class
      when 'notification_gap' then 'Fresh polar FIRMS detection exists but the event is still suppressed and unsent.'
      when 'delivery_backlog' then 'Notification-required event has waited more than 45 minutes for its first Telegram delivery.'
      when 'support_only_multi_sensor' then 'Fresh MTG and Sentinel-3 support exists; publication remains intentionally policy-suppressed.'
      when 'support_only_mtg' then 'Fresh MTG support only; publication remains intentionally policy-suppressed.'
      when 'support_only_sentinel3' then 'Fresh Sentinel-3 support only; publication remains intentionally policy-suppressed.'
      when 'historical_suppressed' then 'Historical bootstrap/policy-suppressed event with no detection in the last 24 hours.'
      else 'Recent support-only event suppressed by current notification policy.'
    end,
    sources,detection_count,source_count,first_detection,last_detection,
    sync_reason,eligible_at,first_seen,last_seen,observation_count,multisource_count,v_now
  from findings
  where finding_class is not null;

  select count(*)::int,
         count(*) filter(where severity='error')::int,
         count(*) filter(where severity='warning')::int,
         count(*) filter(where severity='info')::int
  into v_total,v_errors,v_warnings,v_info
  from public.notification_integrity_findings;

  insert into public.system_state(key,value,updated_at)
  values(
    'monitor_notification_integrity',
    jsonb_build_object(
      'status',case when v_errors>0 then 'error' when v_warnings>0 then 'degraded' else 'active' end,
      'last_success_run',v_now,
      'total_findings',v_total,
      'errors',v_errors,
      'warnings',v_warnings,
      'info',v_info,
      'notification_gaps',(select count(*) from public.notification_integrity_findings where finding_class='notification_gap'),
      'delivery_backlog',(select count(*) from public.notification_integrity_findings where finding_class='delivery_backlog'),
      'support_only_mtg',(select count(*) from public.notification_integrity_findings where finding_class='support_only_mtg'),
      'support_only_sentinel3',(select count(*) from public.notification_integrity_findings where finding_class='support_only_sentinel3'),
      'support_only_multi_sensor',(select count(*) from public.notification_integrity_findings where finding_class='support_only_multi_sensor'),
      'historical_suppressed',(select count(*) from public.notification_integrity_findings where finding_class='historical_suppressed'),
      'other_policy_suppressed',(select count(*) from public.notification_integrity_findings where finding_class='other_policy_suppressed'),
      'elapsed_ms',round((extract(epoch from(clock_timestamp()-v_started))*1000)::numeric,1),
      'policy','Only errors/warnings indicate integrity problems. Support-only/historical findings are informational.'
    ),
    v_now
  )
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  return (select value from public.system_state where key='monitor_notification_integrity');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_notification_integrity_summary()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'state',coalesce((select value from public.system_state where key='monitor_notification_integrity'),'{}'::jsonb),
    'findings',coalesce((
      select jsonb_agg(jsonb_build_object(
        'event_id',fire_event_id,
        'class',finding_class,
        'severity',severity,
        'reason',reason,
        'sources',sources,
        'detection_count',detection_count,
        'source_count',source_count,
        'last_detection',last_detection,
        'queue_reason',queue_reason,
        'queue_eligible_at',queue_eligible_at,
        'first_seen',event_first_seen,
        'last_seen',event_last_seen,
        'observations',observation_count,
        'multisource_count',multisource_count
      ) order by
        case severity when 'error' then 0 when 'warning' then 1 else 2 end,
        last_detection desc
      )
      from (
        select * from public.notification_integrity_findings
        order by
          case severity when 'error' then 0 when 'warning' then 1 else 2 end,
          last_detection desc
        limit 30
      ) x
    ),'[]'::jsonb)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_optional_vault_secret(p_name text)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select decrypted_secret
  from vault.decrypted_secrets
  where name=p_name
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_osint_event_detail(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_event uuid;
  v_result jsonb;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event
    from public.fire_events
    order by last_seen desc
    limit 1;
  else
    select id into v_event
    from public.fire_events
    where lower(id::text) like lower(trim(p_query)) || '%'
    order by last_seen desc
    limit 1;
  end if;

  if v_event is null then return null; end if;

  select jsonb_build_object(
    'id',e.id,
    'last_seen',e.last_seen,
    'oblast',o.name_uk,
    'latitude',coalesce(e.best_latitude,e.last_latitude),
    'longitude',coalesce(e.best_longitude,e.last_longitude),
    'evidence_count',(select count(*) from public.osint_evidence x where x.fire_event_id=e.id),
    'source_count',(select count(distinct x.source) from public.osint_evidence x where x.fire_event_id=e.id),
    'sources',coalesce((
      select jsonb_agg(s.source order by s.source)
      from (select distinct x.source from public.osint_evidence x where x.fire_event_id=e.id) s
    ),'[]'::jsonb),
    'evidence',coalesce((
      select jsonb_agg(jsonb_build_object(
        'source',x.source,
        'source_event_id',x.source_event_id,
        'observed_at',x.observed_at,
        'title',x.title,
        'category',x.category,
        'source_url',x.source_url,
        'distance_km',case when x.distance_m is null then null else round((x.distance_m/1000.0)::numeric,1) end,
        'time_delta_h',case when x.time_delta_minutes is null then null else round((x.time_delta_minutes/60.0)::numeric,1) end,
        'correlation_class',x.correlation_class
      ) order by x.observed_at desc)
      from (
        select * from public.osint_evidence
        where fire_event_id=e.id
        order by observed_at desc
        limit 20
      ) x
    ),'[]'::jsonb)
  ) into v_result
  from public.fire_events e
  left join public.oblasts o on o.id=e.oblast_id
  where e.id=v_event;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_public_post_context(p_event uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'ghsl', case when h.fire_event_id is null then null else jsonb_build_object(
      'population_1km',h.population_1km,'population_5km',h.population_5km,'population_10km',h.population_10km,
      'built_fraction_5km_pct',h.built_fraction_5km_pct,'updated_at',h.updated_at
    ) end,
    'infrastructure', case when g.fire_event_id is null then null else jsonb_build_object(
      'nearest',g.nearest_infrastructure,'flags',coalesce(g.infrastructure_context_flags,'[]'::jsonb),
      'profile_version',g.infra_profile_version,'updated_at',g.updated_at
    ) end,
    'public_osint', jsonb_build_object(
      'telegram_count',(select count(*) from public.event_public_osint x where x.fire_event_id=p_event and x.source_kind='telegram'),
      'news_count',(select count(*) from public.event_public_osint x where x.fire_event_id=p_event and x.source_kind='news'),
      'air_alert_count',(select count(*) from public.event_public_osint x where x.fire_event_id=p_event and x.source_kind='air_alert'),
      'best_match',(
        select jsonb_build_object(
          'kind',x.source_kind,'source',x.source_name,'published_at',x.published_at,
          'relevance_score',x.relevance_score,
          'scope',case
            when x.match_basis->'location'->>'kind'='nearest_place' then 'local'
            when x.match_basis->'location'->>'matched'='true' then 'regional'
            else 'context' end
        )
        from public.event_public_osint x where x.fire_event_id=p_event
        order by
          case when x.match_basis->'location'->>'kind'='nearest_place' then 0
               when x.match_basis->'location'->>'matched'='true' then 1 else 2 end,
          x.relevance_score desc,x.published_at desc nulls last
        limit 1
      ),
      'first_evidence_at',(select max(x.first_seen_at) from public.event_public_osint x where x.fire_event_id=p_event)
    ),
    'air_threat',(
      select jsonb_build_object(
        'source','Neptun','label',a.label,'type',a.threat_type,'nearest_distance_m',a.nearest_distance_m,
        'nearest_at',a.nearest_at,'time_offset_seconds',a.time_offset_seconds,'heading_deg',a.heading_deg,
        'group_count',a.group_count,'confidence_0_100',a.confidence_0_100,'updated_at',a.updated_at
      )
      from public.event_air_threat_context a
      where a.fire_event_id=p_event
      order by a.nearest_distance_m asc,abs(a.time_offset_seconds) asc
      limit 1
    ),
    'surface',(
      select jsonb_build_object('status',s.status,'dnbr',s.dnbr,'dndvi',s.dndvi,'updated_at',s.updated_at)
      from public.satellite_surface_evidence s where s.fire_event_id=p_event
    )
  )
  from public.fire_events e
  left join public.ghsl_event_cache h on h.fire_event_id=e.id
  left join public.geo_osint_event_cache g on g.fire_event_id=e.id
  where e.id=p_event;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_quota_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
declare
  v_db bigint;
  v_media bigint;
  v_uploads bigint;
  v_caption bigint;
  v_history bigint;
  v_cron bigint := 31080;
begin
  select pg_database_size(current_database()) into v_db;
  select coalesce(sum(media_bytes),0),coalesce(sum(media_uploads),0),coalesce(sum(media_caption_only_edits),0)
    into v_media,v_uploads,v_caption
  from public.firewatch_usage_daily
  where day>=current_date-29;
  select pg_total_relation_size('public.hotspot_history_daily'::regclass) into v_history;

  return jsonb_build_object(
    'checked_at',now(),'plan','free',
    'database_bytes',v_db,'database_quota_bytes',524288000,
    'database_pct',round((v_db::numeric/524288000)*100,1),
    'history_table_bytes',v_history,
    'estimated_cron_edge_invocations_30d',v_cron,
    'edge_invocation_quota_30d',500000,
    'edge_invocation_pct',round((v_cron::numeric/500000)*100,1),
    'tracked_media_uploads_30d',v_uploads,
    'tracked_media_bytes_30d',v_media,
    'free_uncached_egress_quota_bytes',5368709120,
    'tracked_media_egress_pct',round((v_media::numeric/5368709120)*100,2),
    'caption_only_edits_30d',v_caption
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_refresh_dossiers(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  r record;
  n integer:=0;
  started timestamptz:=clock_timestamp();
begin
  for r in
    select id
    from public.fire_events
    where last_seen>=now()-interval '48 hours'
    order by last_seen desc
    limit greatest(1,least(coalesce(p_limit,20),50))
  loop
    perform public.firewatch_refresh_event_dossier(r.id);
    n:=n+1;
  end loop;

  insert into public.system_state(key,value,updated_at)
  values (
    'monitor_dossier',
    jsonb_build_object(
      'status','active',
      'last_success_run',now(),
      'events_refreshed',n,
      'schema_version','stage29.1-dossier-v1',
      'elapsed_ms',round((extract(epoch from (clock_timestamp()-started))*1000)::numeric,1),
      'note','Dossiers aggregate independent evidence classes, Sentinel-2 surface evidence and descriptive context flags; no causal score.'
    ),
    now()
  )
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  return jsonb_build_object(
    'ok',true,'events_refreshed',n,
    'schema_version','stage29.1-dossier-v1',
    'elapsed_ms',round((extract(epoch from (clock_timestamp()-started))*1000)::numeric,1)
  );
exception when others then
  insert into public.system_state(key,value,updated_at)
  values ('monitor_dossier',jsonb_build_object('status','error','last_error',sqlerrm,'failed_at',now()),now())
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
  raise;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_refresh_event_dossier(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  d jsonb;
  e public.fire_events%rowtype;
  v_flags text[];
  v_classes text[];
  v_sat integer;
  v_ext integer;
  v_ground integer;
  v_infra integer;
begin
  select * into e from public.fire_events where id=p_event;
  if not found then return null; end if;

  d:=public.firewatch_build_event_dossier_stage373(p_event);
  if d is null then return null; end if;

  select coalesce(array_agg(value),'{}'::text[]) into v_flags
  from jsonb_array_elements_text(coalesce(d->'context_flags','[]'::jsonb));
  select coalesce(array_agg(value),'{}'::text[]) into v_classes
  from jsonb_array_elements_text(coalesce(d->'evidence_classes','[]'::jsonb));

  v_sat:=coalesce((d#>>'{satellite,source_count}')::integer,0);
  v_ext:=coalesce((d#>>'{external_osint,source_count}')::integer,0)
        +coalesce((d#>>'{public_osint,news_source_count}')::integer,0)
        +coalesce((d#>>'{public_osint,telegram_source_count}')::integer,0)
        +case when coalesce((d#>>'{air_threat_context,count}')::integer,0)>0 then 1 else 0 end;
  v_ground:=coalesce((d#>>'{ground,station_count}')::integer,0);
  v_infra:=coalesce((d#>>'{infrastructure,feature_count}')::integer,0);

  insert into public.event_osint_dossiers(
    fire_event_id,built_at,event_last_seen,event_updated_at,flags,evidence_classes,
    satellite_source_count,external_osint_source_count,ground_station_count,
    infrastructure_feature_count,dossier,updated_at
  ) values (
    p_event,now(),e.last_seen,e.updated_at,v_flags,v_classes,
    v_sat,v_ext,v_ground,v_infra,d,now()
  )
  on conflict(fire_event_id) do update set
    built_at=excluded.built_at,event_last_seen=excluded.event_last_seen,event_updated_at=excluded.event_updated_at,
    flags=excluded.flags,evidence_classes=excluded.evidence_classes,
    satellite_source_count=excluded.satellite_source_count,
    external_osint_source_count=excluded.external_osint_source_count,
    ground_station_count=excluded.ground_station_count,
    infrastructure_feature_count=excluded.infrastructure_feature_count,
    dossier=excluded.dossier,updated_at=now();

  return d;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_release_telegram_lease(p_holder text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_count integer:=0;
begin
  update public.telegram_delivery_lease
  set holder=null,expires_at=null,updated_at=now()
  where id=true and holder=p_holder;
  get diagnostics v_count = row_count;
  return v_count>0;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_report_status(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event uuid;
  r public.event_evidence_reports%rowtype;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event from public.fire_events order by last_seen desc limit 1;
  else
    select id into v_event
    from public.fire_events
    where lower(id::text) like lower(trim(p_query)) || '%'
    order by last_seen desc limit 1;
  end if;
  if v_event is null then return null; end if;

  select * into r from public.event_evidence_reports where fire_event_id=v_event;

  return jsonb_build_object(
    'event_id',v_event,
    'available',r.fire_event_id is not null,
    'report_version',r.report_version,
    'generated_at',r.generated_at,
    'dossier_schema_version',r.dossier_schema_version,
    'evidence_classes',coalesce(to_jsonb(r.evidence_classes),'[]'::jsonb),
    'context_flags',coalesce(to_jsonb(r.context_flags),'[]'::jsonb),
    'coverage_available',coalesce(r.coverage_available,0),
    'coverage_expected',coalesce(r.coverage_expected,8),
    'html_storage_path',r.html_storage_path,
    'json_storage_path',r.json_storage_path,
    'html_bytes',r.html_bytes,
    'json_bytes',r.json_bytes,
    'last_error',r.last_error
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_satellite_evidence(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_event uuid;
  v_result jsonb;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event from public.fire_events order by last_seen desc limit 1;
  else
    select id into v_event
    from public.fire_events
    where lower(id::text) like lower(trim(p_query)) || '%'
    order by last_seen desc
    limit 1;
  end if;
  if v_event is null then return null; end if;

  select jsonb_build_object(
    'event_id',e.id,
    'oblast',o.name_uk,
    'first_seen',e.first_seen,
    'last_seen',e.last_seen,
    'latitude',coalesce(e.best_latitude,e.last_latitude,e.first_latitude),
    'longitude',coalesce(e.best_longitude,e.last_longitude,e.first_longitude),
    'available',s.fire_event_id is not null,
    'provider',s.provider,
    'collection',s.collection,
    'algorithm_version',s.algorithm_version,
    'status',coalesce(s.status,'pending'),
    'searched_at',s.searched_at,
    'next_retry_at',s.next_retry_at,
    'roi_radius_m',s.roi_radius_m,
    'max_scene_cloud_pct',s.max_scene_cloud_pct,
    'before',case when s.before_item_id is null then null else jsonb_build_object(
      'item_id',s.before_item_id,'datetime',s.before_datetime,'cloud_pct',s.before_cloud_pct,
      'local_valid_fraction',s.before_local_valid_fraction,'nbr',s.before_nbr,'ndvi',s.before_ndvi,
      'thumbnail_url',s.before_thumbnail_url,'stac_url',s.before_stac_url
    ) end,
    'after',case when s.after_item_id is null then null else jsonb_build_object(
      'item_id',s.after_item_id,'datetime',s.after_datetime,'cloud_pct',s.after_cloud_pct,
      'local_valid_fraction',s.after_local_valid_fraction,'nbr',s.after_nbr,'ndvi',s.after_ndvi,
      'thumbnail_url',s.after_thumbnail_url,'stac_url',s.after_stac_url
    ) end,
    'dnbr',s.dnbr,'dndvi',s.dndvi,
    'spectral_change_magnitude',s.spectral_change_magnitude,
    'visual',jsonb_build_object(
      'status',coalesce(s.visual_status,'pending'),
      'version',s.visual_version,
      'storage_path',s.visual_storage_path,
      'generated_at',s.visual_generated_at,
      'bytes',s.visual_bytes,
      'last_error',s.visual_last_error
    ),
    'source_metadata',coalesce(s.source_metadata,'{}'::jsonb),
    'last_error',s.last_error,
    'note','Delayed surface spectral verification and visual evidence are contextual only; they do not establish cause.'
  ) into v_result
  from public.fire_events e
  left join public.oblasts o on o.id=e.oblast_id
  left join public.satellite_surface_evidence s on s.fire_event_id=e.id
  where e.id=v_event;

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_search_events(p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_limit integer:=greatest(1,least(coalesce((p_filters->>'limit')::integer,20),50));
  v_id text:=nullif(trim(p_filters->>'id'),'');
  v_oblast text:=nullif(trim(p_filters->>'oblast'),'');
  v_status text:=nullif(trim(p_filters->>'status'),'');
  v_source text:=nullif(trim(p_filters->>'source'),'');
  v_flag text:=nullif(trim(p_filters->>'flag'),'');
  v_surface text:=nullif(trim(p_filters->>'surface'),'');
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
  if (v_lat is null) <> (v_lon is null) then
    raise exception 'lat and lon must be supplied together';
  end if;
  if v_lat is not null and (v_lat < -90 or v_lat > 90 or v_lon < -180 or v_lon > 180) then
    raise exception 'invalid coordinates';
  end if;
  if v_lat is not null and v_radius_km is null then v_radius_km:=10; end if;
  if v_radius_km is not null and (v_radius_km < 0.1 or v_radius_km > 500) then
    raise exception 'radius_km must be between 0.1 and 500';
  end if;

  with candidate as (
    select
      e.id,e.first_seen,e.last_seen,e.lifecycle_status,e.status,
      e.observation_count,e.multisource_count,e.multisource_sources,
      e.event_confidence_level,e.event_confidence_label,
      coalesce(e.best_latitude,e.last_latitude,e.first_latitude) latitude,
      coalesce(e.best_longitude,e.last_longitude,e.first_longitude) longitude,
      coalesce(e.best_location,e.last_location,e.first_location) event_location,
      e.best_location_resolution_m,e.nearest_place_name,e.nearest_place_distance_km,
      e.frp_trend,e.frp_latest_avg,e.history_events_365d,e.hotspot_class,
      e.telegram_sent,e.telegram_message_id,o.name_uk oblast,
      d.max_frp,d.sources,
      se.status surface_status,se.dnbr,se.dndvi,se.visual_status,
      dos.flags,dos.evidence_classes
    from public.fire_events e
    left join public.oblasts o on o.id=e.oblast_id
    left join lateral (
      select max(x.frp) max_frp,
             array_agg(distinct x.source order by x.source) sources
      from public.detections x
      where x.event_id=e.id
    ) d on true
    left join public.satellite_surface_evidence se on se.fire_event_id=e.id
    left join public.event_osint_dossiers dos on dos.fire_event_id=e.id
    where
      (v_id is null or lower(e.id::text) like lower(v_id)||'%')
      and (v_oblast is null or coalesce(o.name_uk,'') ilike '%'||v_oblast||'%')
      and (v_status is null or e.lifecycle_status=v_status or e.status=v_status)
      and (v_from is null or e.last_seen>=v_from)
      and (v_to is null or e.first_seen<=v_to)
      and (v_min_frp is null or coalesce(d.max_frp,0)>=v_min_frp)
      and (v_min_obs is null or e.observation_count>=v_min_obs)
      and (v_min_platforms is null or e.multisource_count>=v_min_platforms)
      and (v_sent is null or e.telegram_sent=v_sent)
      and (v_source is null or v_source=any(coalesce(d.sources,'{}'::text[])))
      and (v_surface is null or coalesce(se.status,'pending')=v_surface)
      and (v_flag is null or v_flag=any(coalesce(dos.flags,'{}'::text[])))
  ), filtered as (
    select c.*,
      case when v_lat is not null and c.event_location is not null then
        round((st_distance(
          c.event_location::geography,
          st_setsrid(st_makepoint(v_lon,v_lat),4326)::geography
        )/1000.0)::numeric,3)
      end distance_km
    from candidate c
    where v_lat is null
       or (c.event_location is not null and st_dwithin(
         c.event_location::geography,
         st_setsrid(st_makepoint(v_lon,v_lat),4326)::geography,
         v_radius_km*1000.0
       ))
    order by
      case when v_lat is not null then st_distance(
        c.event_location::geography,
        st_setsrid(st_makepoint(v_lon,v_lat),4326)::geography
      ) end asc nulls last,
      c.last_seen desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'oblast',oblast,'first_seen',first_seen,'last_seen',last_seen,
    'lifecycle_status',lifecycle_status,'status',status,
    'observation_count',observation_count,'multisource_count',multisource_count,
    'sources',coalesce(to_jsonb(sources),'[]'::jsonb),
    'event_confidence_level',event_confidence_level,'event_confidence_label',event_confidence_label,
    'latitude',latitude,'longitude',longitude,'distance_km',distance_km,
    'best_location_resolution_m',best_location_resolution_m,
    'nearest_place_name',nearest_place_name,'nearest_place_distance_km',nearest_place_distance_km,
    'max_frp',max_frp,'frp_latest_avg',frp_latest_avg,'frp_trend',frp_trend,
    'history_events_365d',history_events_365d,'hotspot_class',hotspot_class,
    'surface_status',coalesce(surface_status,'pending'),'dnbr',dnbr,'dndvi',dndvi,'visual_status',visual_status,
    'flags',coalesce(to_jsonb(flags),'[]'::jsonb),'evidence_classes',coalesce(to_jsonb(evidence_classes),'[]'::jsonb),
    'telegram_sent',telegram_sent,'telegram_message_id',telegram_message_id
  ) order by
    case when v_lat is not null then distance_km end asc nulls last,
    last_seen desc),'[]'::jsonb)
  into v_rows from filtered;

  return jsonb_build_object(
    'filters',coalesce(p_filters,'{}'::jsonb),
    'geo',case when v_lat is null then null else jsonb_build_object(
      'lat',v_lat,'lon',v_lon,'radius_km',v_radius_km
    ) end,
    'count',jsonb_array_length(v_rows),
    'limit',v_limit,
    'events',v_rows
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_source_baseline_refresh()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz:=now();
  v_bucket timestamptz:=date_trunc('hour',v_now);
  v_slot smallint:=(floor(extract(hour from v_now)::numeric/6)*6)::smallint;
  v_learning integer:=0;
  v_normal integer:=0;
  v_watch integer:=0;
  v_anomaly integer:=0;
begin
  -- Hourly-coverage telemetry baseline. Six-hour slots preserve time-of-day effects
  -- while allowing a useful cold start within roughly one day.
  with samples as (
    select h.source_id,
           (floor(extract(hour from h.bucket_hour)::numeric/6)*6)::smallint slot_utc,
           v.metric,
           v.val::numeric
    from public.source_coverage_hourly h
    cross join lateral (values
      ('fetched_last_run',h.fetched_last_run::numeric),
      ('recent_last_run',h.recent_last_run::numeric),
      ('worker_age_minutes',h.worker_age_minutes::numeric),
      ('upstream_age_minutes',h.upstream_age_minutes::numeric)
    ) v(metric,val)
    where h.bucket_hour>=v_now-interval '30 days'
      and v.val is not null
      and h.status='active'
  ), med as (
    select source_id,metric,slot_utc,count(*)::int sample_count,
           percentile_cont(0.5) within group(order by val)::numeric median_value,
           percentile_cont(0.1) within group(order by val)::numeric p10_value,
           percentile_cont(0.9) within group(order by val)::numeric p90_value,
           min(val)::numeric min_value,max(val)::numeric max_value
    from samples
    group by source_id,metric,slot_utc
  ), stats as (
    select m.*,
           percentile_cont(0.5) within group(order by abs(s.val-m.median_value))::numeric mad_value
    from med m
    join samples s using(source_id,metric,slot_utc)
    group by m.source_id,m.metric,m.slot_utc,m.sample_count,m.median_value,m.p10_value,m.p90_value,m.min_value,m.max_value
  )
  insert into public.source_coverage_baseline(
    source_id,metric,slot_utc,sample_count,median_value,mad_value,p10_value,p90_value,
    min_value,max_value,baseline_ready,window_days,updated_at
  )
  select source_id,metric,slot_utc,sample_count,median_value,mad_value,p10_value,p90_value,
         min_value,max_value,(sample_count>=6),30,v_now
  from stats
  on conflict(source_id,metric,slot_utc) do update set
    sample_count=excluded.sample_count,
    median_value=excluded.median_value,
    mad_value=excluded.mad_value,
    p10_value=excluded.p10_value,
    p90_value=excluded.p90_value,
    min_value=excluded.min_value,
    max_value=excluded.max_value,
    baseline_ready=excluded.baseline_ready,
    window_days=excluded.window_days,
    updated_at=excluded.updated_at;

  -- Immediate historical baseline for acquisition -> ingestion delay.
  with mapped as (
    select case
      when d.source like 'COPERNICUS_S3_%' then 'SENTINEL3_SLSTR'
      else d.source
    end source_id,
    (floor(extract(hour from d.acq_datetime)::numeric/6)*6)::smallint slot_utc,
    extract(epoch from(d.received_at-d.acq_datetime))/60.0 lag_min
    from public.detections d
    where d.acq_datetime>=v_now-interval '30 days'
      and d.received_at is not null
      and d.received_at>=d.acq_datetime
      and d.source in (
        'VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT','VIIRS_SNPP_NRT','MODIS_NRT',
        'EUMETSAT_MTG_MTFRPPIXEL',
        'COPERNICUS_S3_SLSTR_MWIR','COPERNICUS_S3_SLSTR_SWIR500M'
      )
  ), med as (
    select source_id,slot_utc,count(*)::int sample_count,
           percentile_cont(0.5) within group(order by lag_min)::numeric median_value,
           percentile_cont(0.1) within group(order by lag_min)::numeric p10_value,
           percentile_cont(0.9) within group(order by lag_min)::numeric p90_value,
           min(lag_min)::numeric min_value,max(lag_min)::numeric max_value
    from mapped
    where lag_min between 0 and 1440
    group by source_id,slot_utc
  ), stats as (
    select m.*,
           percentile_cont(0.5) within group(order by abs(x.lag_min-m.median_value))::numeric mad_value
    from med m
    join mapped x using(source_id,slot_utc)
    where x.lag_min between 0 and 1440
    group by m.source_id,m.slot_utc,m.sample_count,m.median_value,m.p10_value,m.p90_value,m.min_value,m.max_value
  )
  insert into public.source_coverage_baseline(
    source_id,metric,slot_utc,sample_count,median_value,mad_value,p10_value,p90_value,
    min_value,max_value,baseline_ready,window_days,updated_at
  )
  select source_id,'ingestion_delay_minutes',slot_utc,sample_count,median_value,mad_value,p10_value,p90_value,
         min_value,max_value,(sample_count>=12),30,v_now
  from stats
  on conflict(source_id,metric,slot_utc) do update set
    sample_count=excluded.sample_count,
    median_value=excluded.median_value,
    mad_value=excluded.mad_value,
    p10_value=excluded.p10_value,
    p90_value=excluded.p90_value,
    min_value=excluded.min_value,
    max_value=excluded.max_value,
    baseline_ready=excluded.baseline_ready,
    window_days=excluded.window_days,
    updated_at=excluded.updated_at;

  -- Evaluate current telemetry. Detections counts are deliberately not anomaly inputs.
  with current_lag as (
    select source_id,
           percentile_cont(0.5) within group(order by lag_min)::numeric ingestion_delay_minutes
    from (
      select case when d.source like 'COPERNICUS_S3_%' then 'SENTINEL3_SLSTR' else d.source end source_id,
             extract(epoch from(d.received_at-d.acq_datetime))/60.0 lag_min
      from public.detections d
      where d.received_at>=v_now-interval '6 hours'
        and d.received_at is not null
        and d.received_at>=d.acq_datetime
        and d.source in (
          'VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT','VIIRS_SNPP_NRT','MODIS_NRT',
          'EUMETSAT_MTG_MTFRPPIXEL',
          'COPERNICUS_S3_SLSTR_MWIR','COPERNICUS_S3_SLSTR_SWIR500M'
        )
    ) z
    where lag_min between 0 and 1440
    group by source_id
  ), base as (
    select c.source_id,c.source_label,c.source_family,c.status as coverage_status,
           c.fetched_last_run::numeric fetched_last_run,
           c.recent_last_run::numeric recent_last_run,
           c.worker_age_minutes::numeric worker_age_minutes,
           c.upstream_age_minutes::numeric upstream_age_minutes,
           l.ingestion_delay_minutes,
           jsonb_object_agg(b.metric,jsonb_build_object(
             'n',b.sample_count,'median',b.median_value,'mad',b.mad_value,
             'p10',b.p10_value,'p90',b.p90_value,'ready',b.baseline_ready
           )) filter(where b.metric is not null) baseline_metrics,
           bool_or(b.metric='fetched_last_run' and b.baseline_ready) fetched_ready,
           bool_or(b.metric='upstream_age_minutes' and b.baseline_ready) upstream_ready,
           bool_or(b.metric='ingestion_delay_minutes' and b.baseline_ready) lag_ready
    from public.source_coverage_current c
    left join current_lag l using(source_id)
    left join public.source_coverage_baseline b
      on b.source_id=c.source_id and b.slot_utc=v_slot
    group by c.source_id,c.source_label,c.source_family,c.status,c.fetched_last_run,c.recent_last_run,
             c.worker_age_minutes,c.upstream_age_minutes,l.ingestion_delay_minutes
  ), eval as (
    select b.*,
      case
        when b.coverage_status<>'active' then true
        else false
      end coverage_abnormal,
      case
        when b.fetched_last_run is null or coalesce((b.baseline_metrics->'fetched_last_run'->>'ready')::boolean,false)=false then false
        else b.fetched_last_run <
          least(
            coalesce((b.baseline_metrics->'fetched_last_run'->>'p10')::numeric,b.fetched_last_run)*0.70,
            coalesce((b.baseline_metrics->'fetched_last_run'->>'median')::numeric,b.fetched_last_run)
              - 4*greatest(coalesce((b.baseline_metrics->'fetched_last_run'->>'mad')::numeric,0),5)
          )
          and coalesce((b.baseline_metrics->'fetched_last_run'->>'median')::numeric,0)>=20
      end fetched_low,
      case
        when b.recent_last_run is null or coalesce((b.baseline_metrics->'recent_last_run'->>'ready')::boolean,false)=false then false
        else b.recent_last_run <
          least(
            coalesce((b.baseline_metrics->'recent_last_run'->>'p10')::numeric,b.recent_last_run)*0.60,
            coalesce((b.baseline_metrics->'recent_last_run'->>'median')::numeric,b.recent_last_run)
              - 4*greatest(coalesce((b.baseline_metrics->'recent_last_run'->>'mad')::numeric,0),5)
          )
          and coalesce((b.baseline_metrics->'recent_last_run'->>'median')::numeric,0)>=30
      end recent_low,
      case
        when b.worker_age_minutes is null or coalesce((b.baseline_metrics->'worker_age_minutes'->>'ready')::boolean,false)=false then false
        else b.worker_age_minutes >
          greatest(
            coalesce((b.baseline_metrics->'worker_age_minutes'->>'p90')::numeric,0)*1.5,
            coalesce((b.baseline_metrics->'worker_age_minutes'->>'median')::numeric,0)
              + 4*greatest(coalesce((b.baseline_metrics->'worker_age_minutes'->>'mad')::numeric,0),2)
          )
      end worker_high,
      case
        when b.upstream_age_minutes is null or coalesce((b.baseline_metrics->'upstream_age_minutes'->>'ready')::boolean,false)=false then false
        else b.upstream_age_minutes >
          greatest(
            coalesce((b.baseline_metrics->'upstream_age_minutes'->>'p90')::numeric,0)*1.5,
            coalesce((b.baseline_metrics->'upstream_age_minutes'->>'median')::numeric,0)
              + 4*greatest(coalesce((b.baseline_metrics->'upstream_age_minutes'->>'mad')::numeric,0),5)
          )
      end upstream_high,
      case
        when b.ingestion_delay_minutes is null or coalesce((b.baseline_metrics->'ingestion_delay_minutes'->>'ready')::boolean,false)=false then false
        else b.ingestion_delay_minutes >
          greatest(
            coalesce((b.baseline_metrics->'ingestion_delay_minutes'->>'p90')::numeric,0)*1.5,
            coalesce((b.baseline_metrics->'ingestion_delay_minutes'->>'median')::numeric,0)
              + 4*greatest(coalesce((b.baseline_metrics->'ingestion_delay_minutes'->>'mad')::numeric,0),5)
          )
      end ingestion_high,
      case
        when b.source_family='polar-firms' then coalesce(b.fetched_ready,false)
        else coalesce(b.upstream_ready,false)
      end primary_ready
    from base b
  ), assessed as (
    select e.*,
      (coverage_abnormal or fetched_low or recent_low or worker_high or upstream_high or ingestion_high) abnormal,
      (
        select coalesce(jsonb_agg(x.reason),'[]'::jsonb)
        from (values
          (case when coverage_abnormal then jsonb_build_object('metric','coverage_status','kind','source_health','current',coverage_status) end),
          (case when fetched_low then jsonb_build_object('metric','fetched_last_run','kind','low_feed','current',fetched_last_run) end),
          (case when recent_low then jsonb_build_object('metric','recent_last_run','kind','low_recent_feed','current',recent_last_run) end),
          (case when worker_high then jsonb_build_object('metric','worker_age_minutes','kind','high_worker_lag','current',worker_age_minutes) end),
          (case when upstream_high then jsonb_build_object('metric','upstream_age_minutes','kind','high_upstream_lag','current',upstream_age_minutes) end),
          (case when ingestion_high then jsonb_build_object('metric','ingestion_delay_minutes','kind','high_ingestion_delay','current',ingestion_delay_minutes) end)
        ) x(reason)
        where x.reason is not null
      ) reasons
    from eval e
  ), final as (
    select a.*,
      case
        when not primary_ready then 'learning'
        when not abnormal then 'normal'
        when coalesce(prev.consecutive_abnormal,0)>=1 then 'anomaly'
        else 'watch'
      end next_status,
      case
        when not primary_ready or not abnormal then 0
        else coalesce(prev.consecutive_abnormal,0)+1
      end next_streak
    from assessed a
    left join public.source_coverage_anomalies prev using(source_id)
  )
  insert into public.source_coverage_anomalies(
    source_id,source_label,status,baseline_ready,consecutive_abnormal,reasons,current_metrics,baseline_metrics,checked_at
  )
  select
    source_id,source_label,next_status,primary_ready,next_streak,reasons,
    jsonb_build_object(
      'fetched_last_run',fetched_last_run,
      'recent_last_run',recent_last_run,
      'worker_age_minutes',worker_age_minutes,
      'upstream_age_minutes',upstream_age_minutes,
      'ingestion_delay_minutes',ingestion_delay_minutes,
      'coverage_status',coverage_status
    ),
    coalesce(baseline_metrics,'{}'::jsonb),
    v_now
  from final
  on conflict(source_id) do update set
    source_label=excluded.source_label,
    status=excluded.status,
    baseline_ready=excluded.baseline_ready,
    consecutive_abnormal=excluded.consecutive_abnormal,
    reasons=excluded.reasons,
    current_metrics=excluded.current_metrics,
    baseline_metrics=excluded.baseline_metrics,
    checked_at=excluded.checked_at;

  insert into public.source_coverage_anomaly_hourly(
    bucket_hour,source_id,status,baseline_ready,consecutive_abnormal,reasons,current_metrics,captured_at
  )
  select v_bucket,source_id,status,baseline_ready,consecutive_abnormal,reasons,current_metrics,v_now
  from public.source_coverage_anomalies
  on conflict(bucket_hour,source_id) do update set
    status=excluded.status,
    baseline_ready=excluded.baseline_ready,
    consecutive_abnormal=excluded.consecutive_abnormal,
    reasons=excluded.reasons,
    current_metrics=excluded.current_metrics,
    captured_at=excluded.captured_at;

  select count(*) filter(where status='learning')::int,
         count(*) filter(where status='normal')::int,
         count(*) filter(where status='watch')::int,
         count(*) filter(where status='anomaly')::int
  into v_learning,v_normal,v_watch,v_anomaly
  from public.source_coverage_anomalies;

  insert into public.system_state(key,value,updated_at)
  values(
    'monitor_source_baseline',
    jsonb_build_object(
      'status',case when v_anomaly>0 then 'anomaly' when v_watch>0 then 'watch' when v_learning>0 then 'learning' else 'normal' end,
      'last_success_run',v_now,
      'baseline_version','stage30.4-robust-v1',
      'slot_hours',6,
      'window_days',30,
      'minimum_hourly_samples',6,
      'minimum_ingestion_samples',12,
      'sources_learning',v_learning,
      'sources_normal',v_normal,
      'sources_watch',v_watch,
      'sources_anomaly',v_anomaly,
      'anomaly_requires_consecutive_checks',2,
      'fire_count_policy','Detection counts are context only and never directly trigger a source anomaly.',
      'anomalies',coalesce((
        select jsonb_agg(jsonb_build_object(
          'source',source_id,'label',source_label,'status',status,
          'streak',consecutive_abnormal,'reasons',reasons
        ) order by source_id)
        from public.source_coverage_anomalies
        where status in ('watch','anomaly')
      ),'[]'::jsonb)
    ),
    v_now
  )
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  delete from public.source_coverage_anomaly_hourly
  where bucket_hour<v_bucket-interval '90 days';

  return (select value from public.system_state where key='monitor_source_baseline');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_source_baseline_summary()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'state',coalesce((select value from public.system_state where key='monitor_source_baseline'),'{}'::jsonb),
    'sources',coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_id',a.source_id,
        'label',a.source_label,
        'status',a.status,
        'baseline_ready',a.baseline_ready,
        'streak',a.consecutive_abnormal,
        'reasons',a.reasons,
        'current',a.current_metrics,
        'baseline',a.baseline_metrics
      ) order by a.source_id)
      from public.source_coverage_anomalies a
    ),'[]'::jsonb)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_source_coverage_refresh()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_now timestamptz:=now();
  v_bucket timestamptz:=date_trunc('hour',now());
  v_total integer:=0;
  v_active integer:=0;
  v_degraded integer:=0;
  v_quiet integer:=0;
  v_registry_status text;
begin
  select value->>'status' into v_registry_status
  from public.system_state where key='firms_source_registry';

  with cfg(source_id,source_label,source_family,state_key,detection_source,worker_stale_min,upstream_stale_min,uses_upstream) as (
    values
      ('VIIRS_NOAA20_NRT','NOAA-20 / VIIRS','polar-firms','monitor','VIIRS_NOAA20_NRT',45,null::integer,false),
      ('VIIRS_NOAA21_NRT','NOAA-21 / VIIRS','polar-firms','monitor','VIIRS_NOAA21_NRT',45,null::integer,false),
      ('VIIRS_SNPP_NRT','Suomi NPP / VIIRS','polar-firms','monitor_snpp','VIIRS_SNPP_NRT',45,null::integer,false),
      ('MODIS_NRT','Terra/Aqua / MODIS','polar-firms','monitor_modis','MODIS_NRT',45,null::integer,false),
      ('EUMETSAT_MTG_MTFRPPIXEL','MTG / FCI','geostationary','eumetsat_lsa_saf','EUMETSAT_MTG_MTFRPPIXEL',35,90,true),
      ('EUMETSAT_MSG_FRP_PIXEL','MSG / SEVIRI','geostationary','monitor_eumetsat',null,50,120,true),
      ('SENTINEL3_SLSTR','Sentinel-3 / SLSTR','polar-copernicus','monitor_sentinel3_slstr','SENTINEL3',120,720,true)
  ), states as (
    select c.*,s.value as st
    from cfg c
    left join public.system_state s on s.key=c.state_key
  ), polar_run as (
    select x->>'source' as source_id,
           nullif(x->>'fetched_rows','')::integer fetched_last_run,
           nullif(x->>'recent_rows','')::integer recent_last_run
    from public.system_state m
    cross join lateral jsonb_array_elements(coalesce(m.value->'source_runs','[]'::jsonb)) x
    where m.key='monitor'
  ), det as (
    select c.source_id,
      count(d.*) filter(where d.acq_datetime>=v_now-interval '1 hour')::int detections_1h,
      count(d.*) filter(where d.acq_datetime>=v_now-interval '6 hours')::int detections_6h,
      count(d.*) filter(where d.acq_datetime>=v_now-interval '24 hours')::int detections_24h,
      max(d.acq_datetime) latest_detection,
      max(d.received_at) latest_received
    from cfg c
    left join public.detections d on
      (c.detection_source='SENTINEL3' and d.source like 'COPERNICUS_S3_%')
      or (c.detection_source is not null and c.detection_source<>'SENTINEL3' and d.source=c.detection_source)
    group by c.source_id
  ), registry as (
    select c.source_id,
      case
        when c.source_family<>'polar-firms' then null::boolean
        when r.value is null then null::boolean
        else exists(
          select 1
          from jsonb_array_elements(coalesce(r.value->'structured_sources','[]'::jsonb)) x
          where x->>'id'=c.source_id
            and coalesce((x->>'enabled')::boolean,false)=true
            and nullif(x->>'max_date','')::date >= ((v_now at time zone 'UTC')::date - 1)
        )
      end registry_ok
    from cfg c
    left join public.system_state r on r.key='firms_source_registry'
  ), calc as (
    select
      s.source_id,s.source_label,s.source_family,
      nullif(s.st->>'last_success_run','')::timestamptz worker_last_success,
      case when nullif(s.st->>'last_success_run','') is null then null
           else round((extract(epoch from(v_now-(s.st->>'last_success_run')::timestamptz))/60)::numeric,1) end worker_age_minutes,
      s.worker_stale_min,
      case
        when s.source_id='EUMETSAT_MTG_MTFRPPIXEL' then nullif(s.st->>'latest_public_slot','')::timestamptz
        when s.source_id='EUMETSAT_MSG_FRP_PIXEL' then nullif(s.st->>'latest_public_slot','')::timestamptz
        when s.source_id='SENTINEL3_SLSTR' then nullif(s.st->>'latest_publication','')::timestamptz
        else null::timestamptz
      end upstream_time,
      s.upstream_stale_min,
      case
        when s.source_id in ('VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT') then pr.fetched_last_run
        else nullif(s.st->>'fetched_rows','')::integer
      end fetched_last_run,
      case
        when s.source_id in ('VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT') then pr.recent_last_run
        else nullif(s.st->>'recent_rows','')::integer
      end recent_last_run,
      coalesce(d.detections_1h,0) detections_1h,
      coalesce(d.detections_6h,0) detections_6h,
      coalesce(d.detections_24h,0) detections_24h,
      d.latest_detection,d.latest_received,
      rg.registry_ok,
      nullif(s.st->>'last_error','') last_error,
      s.st
    from states s
    left join polar_run pr on pr.source_id=s.source_id
    left join det d on d.source_id=s.source_id
    left join registry rg on rg.source_id=s.source_id
  ), final as (
    select *,
      case when upstream_time is null then null
           else round((extract(epoch from(v_now-upstream_time))/60)::numeric,1) end upstream_age_minutes,
      case
        when last_error is not null then 'error'
        when worker_last_success is null then 'unknown'
        when extract(epoch from(v_now-worker_last_success))/60 > worker_stale_min then 'stale'
        when uses_upstream and upstream_time is not null
             and extract(epoch from(v_now-upstream_time))/60 > upstream_stale_min then 'source_lag'
        when source_family='polar-firms' and fetched_last_run=0 then 'empty_fetch'
        when source_family='polar-firms' and registry_ok=false then 'source_lag'
        else 'active'
      end status,
      case
        when latest_detection is null then 'unknown'
        when detections_24h=0 then 'quiet'
        else 'observed'
      end activity
    from (
      select calc.*,
        case when source_id in ('EUMETSAT_MTG_MTFRPPIXEL','EUMETSAT_MSG_FRP_PIXEL','SENTINEL3_SLSTR') then true else false end uses_upstream
      from calc
    ) z
  )
  insert into public.source_coverage_current(
    source_id,source_label,source_family,status,activity,
    worker_last_success,worker_age_minutes,worker_stale_after_minutes,
    upstream_time,upstream_age_minutes,upstream_stale_after_minutes,
    fetched_last_run,recent_last_run,
    detections_1h,detections_6h,detections_24h,
    latest_detection,latest_received,registry_ok,last_error,details,refreshed_at
  )
  select
    source_id,source_label,source_family,status,activity,
    worker_last_success,worker_age_minutes,worker_stale_min,
    upstream_time,upstream_age_minutes,upstream_stale_min,
    fetched_last_run,recent_last_run,
    detections_1h,detections_6h,detections_24h,
    latest_detection,latest_received,registry_ok,last_error,
    jsonb_build_object(
      'registry_status',v_registry_status,
      'state_key',case
        when source_id in ('VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT') then 'monitor'
        when source_id='VIIRS_SNPP_NRT' then 'monitor_snpp'
        when source_id='MODIS_NRT' then 'monitor_modis'
        when source_id='EUMETSAT_MTG_MTFRPPIXEL' then 'eumetsat_lsa_saf'
        when source_id='EUMETSAT_MSG_FRP_PIXEL' then 'monitor_eumetsat'
        when source_id='SENTINEL3_SLSTR' then 'monitor_sentinel3_slstr'
      end,
      'zero_detection_policy','informational-only',
      'telemetry',case
        when source_id in ('VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT') and fetched_last_run is null
          then 'awaiting-per-source-main-run'
        else 'available'
      end
    ),
    v_now
  from final
  on conflict(source_id) do update set
    source_label=excluded.source_label,
    source_family=excluded.source_family,
    status=excluded.status,
    activity=excluded.activity,
    worker_last_success=excluded.worker_last_success,
    worker_age_minutes=excluded.worker_age_minutes,
    worker_stale_after_minutes=excluded.worker_stale_after_minutes,
    upstream_time=excluded.upstream_time,
    upstream_age_minutes=excluded.upstream_age_minutes,
    upstream_stale_after_minutes=excluded.upstream_stale_after_minutes,
    fetched_last_run=excluded.fetched_last_run,
    recent_last_run=excluded.recent_last_run,
    detections_1h=excluded.detections_1h,
    detections_6h=excluded.detections_6h,
    detections_24h=excluded.detections_24h,
    latest_detection=excluded.latest_detection,
    latest_received=excluded.latest_received,
    registry_ok=excluded.registry_ok,
    last_error=excluded.last_error,
    details=excluded.details,
    refreshed_at=excluded.refreshed_at;

  insert into public.source_coverage_hourly(
    bucket_hour,source_id,source_label,status,activity,
    worker_age_minutes,upstream_age_minutes,fetched_last_run,recent_last_run,
    detections_1h,detections_6h,detections_24h,
    latest_detection,latest_received,registry_ok,last_error,details,captured_at
  )
  select
    v_bucket,source_id,source_label,status,activity,
    worker_age_minutes,upstream_age_minutes,fetched_last_run,recent_last_run,
    detections_1h,detections_6h,detections_24h,
    latest_detection,latest_received,registry_ok,last_error,details,v_now
  from public.source_coverage_current
  on conflict(bucket_hour,source_id) do update set
    status=excluded.status,activity=excluded.activity,
    worker_age_minutes=excluded.worker_age_minutes,
    upstream_age_minutes=excluded.upstream_age_minutes,
    fetched_last_run=excluded.fetched_last_run,
    recent_last_run=excluded.recent_last_run,
    detections_1h=excluded.detections_1h,
    detections_6h=excluded.detections_6h,
    detections_24h=excluded.detections_24h,
    latest_detection=excluded.latest_detection,
    latest_received=excluded.latest_received,
    registry_ok=excluded.registry_ok,
    last_error=excluded.last_error,
    details=excluded.details,
    captured_at=excluded.captured_at;

  select count(*)::int,
         count(*) filter(where status='active')::int,
         count(*) filter(where status<>'active')::int,
         count(*) filter(where activity='quiet')::int
  into v_total,v_active,v_degraded,v_quiet
  from public.source_coverage_current;

  insert into public.system_state(key,value,updated_at)
  values(
    'monitor_source_coverage',
    jsonb_build_object(
      'status',case when v_degraded>0 then 'degraded' else 'active' end,
      'last_success_run',v_now,
      'sources_total',v_total,
      'sources_active',v_active,
      'sources_degraded',v_degraded,
      'sources_quiet',v_quiet,
      'registry_status',coalesce(v_registry_status,'unknown'),
      'zero_detection_policy','Zero local detections are informational and never alone classify a source as failed.',
      'degraded_sources',coalesce((
        select jsonb_agg(jsonb_build_object(
          'source',source_id,'label',source_label,'status',status,
          'worker_age_min',worker_age_minutes,'upstream_age_min',upstream_age_minutes,
          'fetched_last_run',fetched_last_run,'last_error',last_error
        ) order by source_id)
        from public.source_coverage_current where status<>'active'
      ),'[]'::jsonb)
    ),
    v_now
  )
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  delete from public.source_coverage_hourly
  where bucket_hour < v_bucket-interval '90 days';

  return (select value from public.system_state where key='monitor_source_coverage');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_source_coverage_summary()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'state',coalesce((select value from public.system_state where key='monitor_source_coverage'),'{}'::jsonb),
    'sources',coalesce((
      select jsonb_agg(jsonb_build_object(
        'source_id',source_id,
        'label',source_label,
        'family',source_family,
        'status',status,
        'activity',activity,
        'worker_age_minutes',worker_age_minutes,
        'upstream_age_minutes',upstream_age_minutes,
        'fetched_last_run',fetched_last_run,
        'recent_last_run',recent_last_run,
        'detections_1h',detections_1h,
        'detections_6h',detections_6h,
        'detections_24h',detections_24h,
        'latest_detection',latest_detection,
        'latest_received',latest_received,
        'registry_ok',registry_ok,
        'last_error',last_error,
        'details',details
      ) order by source_id)
      from public.source_coverage_current
    ),'[]'::jsonb)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_usage_increment(p_media_uploads integer DEFAULT 0, p_media_bytes bigint DEFAULT 0, p_caption_only_edits integer DEFAULT 0)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  insert into public.firewatch_usage_daily(day,media_uploads,media_bytes,media_caption_only_edits,updated_at)
  values(current_date,greatest(p_media_uploads,0),greatest(p_media_bytes,0),greatest(p_caption_only_edits,0),now())
  on conflict(day) do update set
    media_uploads=firewatch_usage_daily.media_uploads+excluded.media_uploads,
    media_bytes=firewatch_usage_daily.media_bytes+excluded.media_bytes,
    media_caption_only_edits=firewatch_usage_daily.media_caption_only_edits+excluded.media_caption_only_edits,
    updated_at=now();
$function$
;

CREATE OR REPLACE FUNCTION public.firewatch_watchdog_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_monitor jsonb; v_modis jsonb; v_snpp jsonb; v_hist jsonb; v_cams jsonb; v_s5p jsonb; v_intel jsonb;
  v_queue_count integer:=0; v_queue_new integer:=0; v_queue_update integer:=0; v_queue_close integer:=0;
  v_pending_new integer:=0; v_oldest_pending timestamptz; v_oldest_queue timestamptz; v_db_size bigint;
begin
  select value into v_monitor from public.system_state where key='monitor';
  select value into v_modis from public.system_state where key='monitor_modis';
  select value into v_snpp from public.system_state where key='monitor_snpp';
  select value into v_hist from public.system_state where key='history_backfill_365d';
  select value into v_cams from public.system_state where key='monitor_cams';
  select value into v_s5p from public.system_state where key='monitor_sentinel5p';
  select value into v_intel from public.system_state where key='monitor_intelligence';

  with q as (select * from public.fire_events_requiring_telegram_sync(500))
  select count(*)::int,
         count(*) filter(where sync_reason='new')::int,
         count(*) filter(where sync_reason='update')::int,
         count(*) filter(where sync_reason='close')::int
  into v_queue_count,v_queue_new,v_queue_update,v_queue_close
  from q;

  select count(*),min(created_at) into v_pending_new,v_oldest_pending
  from public.fire_events
  where notification_required=true and telegram_sent=false;

  with q as (
    select q.event_id,q.sync_reason,
           case
             when q.sync_reason='new' then e.created_at
             when q.sync_reason='close' then e.last_seen + interval '24 hours'
             else e.updated_at
           end as eligible_at
    from public.fire_events_requiring_telegram_sync(500) q
    join public.fire_events e on e.id=q.event_id
  )
  select min(eligible_at) into v_oldest_queue
  from q;

  select pg_database_size(current_database()) into v_db_size;

  return jsonb_build_object(
    'now',now(),
    'monitor',coalesce(v_monitor,'{}'::jsonb),
    'monitor_modis',coalesce(v_modis,'{}'::jsonb),
    'monitor_snpp',coalesce(v_snpp,'{}'::jsonb),
    'monitor_cams',coalesce(v_cams,'{}'::jsonb),
    'monitor_sentinel5p',coalesce(v_s5p,'{}'::jsonb),
    'monitor_intelligence',coalesce(v_intel,'{}'::jsonb),
    'history_backfill',coalesce(v_hist,'{}'::jsonb),
    'telegram_queue_count',v_queue_count,
    'telegram_queue_new_count',v_queue_new,
    'telegram_queue_update_count',v_queue_update,
    'telegram_queue_close_count',v_queue_close,
    'oldest_telegram_queue_item',v_oldest_queue,
    'pending_new_count',v_pending_new,
    'oldest_pending_new',v_oldest_pending,
    'database_size_bytes',v_db_size
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ingest_eumetsat_frp_batch(p_records jsonb, p_match_radius_m integer DEFAULT 5000, p_match_window_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  r jsonb;
  v_lat double precision;
  v_lon double precision;
  v_acq timestamptz;
  v_oblast bigint;
  v_hash text;
  v_event uuid;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_outside integer := 0;
  v_matched integer := 0;
  v_unmatched integer := 0;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a JSON array';
  end if;

  for r in select value from jsonb_array_elements(p_records)
  loop
    begin
      v_lat := (r->>'latitude')::double precision;
      v_lon := (r->>'longitude')::double precision;
      v_acq := (r->>'acq_datetime')::timestamptz;
    exception when others then
      continue;
    end;

    if v_lat is null or v_lon is null or v_acq is null
       or v_lat < -90 or v_lat > 90 or v_lon < -180 or v_lon > 180 then
      continue;
    end if;

    v_oblast := public.lookup_oblast_id(v_lat,v_lon);
    if v_oblast is null then
      v_outside := v_outside + 1;
      continue;
    end if;

    v_hash := encode(
      digest(
        concat_ws('|',
          'LSA_SAF_MSG_FRP_PIXEL',
          to_char(v_acq at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS'),
          round(v_lat::numeric,5)::text,
          round(v_lon::numeric,5)::text
        ),
        'sha256'
      ),
      'hex'
    );

    if exists(select 1 from public.eumetsat_frp_detections where detection_hash=v_hash) then
      v_duplicates := v_duplicates + 1;
      continue;
    end if;

    select e.id
      into v_event
    from public.fire_events e
    where e.oblast_id = v_oblast
      and e.last_seen >= v_acq - make_interval(hours => p_match_window_hours)
      and e.first_seen <= v_acq + make_interval(hours => p_match_window_hours)
      and st_dwithin(
        e.last_location,
        st_setsrid(st_makepoint(v_lon,v_lat),4326)::geography,
        p_match_radius_m
      )
    order by st_distance(
      e.last_location,
      st_setsrid(st_makepoint(v_lon,v_lat),4326)::geography
    )
    limit 1;

    insert into public.eumetsat_frp_detections(
      detection_hash,event_id,oblast_id,source,platform,instrument,
      acq_datetime,latitude,longitude,location,
      frp,frp_uncertainty,confidence,pixel_area_km2,raw
    ) values (
      v_hash,v_event,v_oblast,'LSA_SAF_MSG_FRP_PIXEL',
      coalesce(nullif(r->>'platform',''),'MSG'),
      coalesce(nullif(r->>'instrument',''),'SEVIRI'),
      v_acq,v_lat,v_lon,
      st_setsrid(st_makepoint(v_lon,v_lat),4326)::geography,
      nullif(r->>'frp','')::double precision,
      nullif(r->>'frp_uncertainty','')::double precision,
      nullif(r->>'confidence','')::double precision,
      nullif(r->>'pixel_area_km2','')::double precision,
      r
    );

    v_inserted := v_inserted + 1;
    if v_event is null then v_unmatched := v_unmatched + 1;
    else v_matched := v_matched + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted',v_inserted,
    'duplicates',v_duplicates,
    'outside_ukraine',v_outside,
    'matched_existing_events',v_matched,
    'unmatched_geostationary',v_unmatched
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ingest_firms_batch(p_records jsonb, p_match_radius_m integer DEFAULT 750, p_match_window_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  r jsonb;
  res jsonb;
  inserted_count integer:=0;
  duplicate_count integer:=0;
  outside_count integer:=0;
  new_event_count integer:=0;
  notify_count integer:=0;
  notifications jsonb:='[]'::jsonb;
  v_event uuid;
  v_oblast bigint;
  v_event_row record;
begin
  if jsonb_typeof(p_records) <> 'array' then raise exception 'p_records must be JSON array'; end if;
  for r in select value from jsonb_array_elements(p_records) loop
    res := public.ingest_firms_detection(
      r->>'source', r->>'satellite', coalesce(r->>'instrument','VIIRS'), (r->>'acq_datetime')::timestamptz,
      (r->>'latitude')::double precision,(r->>'longitude')::double precision,
      nullif(r->>'scan','')::double precision,nullif(r->>'track','')::double precision,
      nullif(r->>'confidence',''),nullif(r->>'frp','')::double precision,nullif(r->>'daynight',''),r,
      p_match_radius_m,p_match_window_hours);
    if coalesce((res->>'inserted')::boolean,false) then inserted_count:=inserted_count+1; end if;
    if coalesce((res->>'duplicate')::boolean,false) then duplicate_count:=duplicate_count+1; end if;
    if coalesce((res->>'outside_ukraine')::boolean,false) then outside_count:=outside_count+1; end if;
    if coalesce((res->>'is_new_event')::boolean,false) then new_event_count:=new_event_count+1; end if;
    if coalesce((res->>'should_notify')::boolean,false) then
      notify_count:=notify_count+1;
      v_event := (res->>'event_id')::uuid;
      select e.id,e.first_seen,e.first_latitude,e.first_longitude,o.name_uk,o.name_en into v_event_row
      from public.fire_events e join public.oblasts o on o.id=e.oblast_id where e.id=v_event;
      notifications := notifications || jsonb_build_array(jsonb_build_object('event_id',v_event_row.id,'acq_datetime',v_event_row.first_seen,'latitude',v_event_row.first_latitude,'longitude',v_event_row.first_longitude,'oblast_uk',v_event_row.name_uk,'oblast_en',v_event_row.name_en));
    end if;
  end loop;
  return jsonb_build_object('total',jsonb_array_length(p_records),'inserted',inserted_count,'duplicates',duplicate_count,'outside_ukraine',outside_count,'new_events',new_event_count,'notify_count',notify_count,'notifications',notifications);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ingest_firms_detection(p_source text, p_satellite text, p_instrument text, p_acq_datetime timestamp with time zone, p_latitude double precision, p_longitude double precision, p_scan double precision DEFAULT NULL::double precision, p_track double precision DEFAULT NULL::double precision, p_confidence text DEFAULT NULL::text, p_frp double precision DEFAULT NULL::double precision, p_daynight text DEFAULT NULL::text, p_raw jsonb DEFAULT '{}'::jsonb, p_match_radius_m integer DEFAULT 750, p_match_window_hours integer DEFAULT 24)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_point geography(Point,4326);
  v_oblast_id bigint;
  v_detection_hash text;
  v_detection_id uuid;
  v_event_id uuid;
  v_existing_event_id uuid;
  v_new_event boolean := false;
  v_bootstrap_done boolean := false;
begin
  if p_acq_datetime is null then raise exception 'p_acq_datetime is required'; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 then raise exception 'invalid latitude: %', p_latitude; end if;
  if p_longitude is null or p_longitude < -180 or p_longitude > 180 then raise exception 'invalid longitude: %', p_longitude; end if;
  if p_match_radius_m <= 0 then raise exception 'p_match_radius_m must be positive'; end if;
  if p_match_window_hours <= 0 then raise exception 'p_match_window_hours must be positive'; end if;
  if p_daynight is not null and p_daynight not in ('D','N') then raise exception 'p_daynight must be D, N or null'; end if;

  v_point := extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)::geography;
  v_oblast_id := public.lookup_oblast_id(p_latitude, p_longitude);

  if v_oblast_id is null then
    return jsonb_build_object('inserted',false,'duplicate',false,'outside_ukraine',true,'is_new_event',false,'should_notify',false);
  end if;

  v_detection_hash := encode(extensions.digest(concat_ws('|',coalesce(p_source,''),coalesce(p_satellite,''),coalesce(p_instrument,''),to_char(p_acq_datetime at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),to_char(round(p_latitude::numeric,6),'FM999990.000000'),to_char(round(p_longitude::numeric,6),'FM999990.000000')),'sha256'),'hex');

  insert into public.detections (detection_hash, oblast_id, source, satellite, instrument, acq_datetime, latitude, longitude, location, scan, track, confidence, frp, daynight, raw, received_at)
  values (v_detection_hash, v_oblast_id, p_source, p_satellite, p_instrument, p_acq_datetime, p_latitude, p_longitude, v_point, p_scan, p_track, p_confidence, p_frp, p_daynight, coalesce(p_raw,'{}'::jsonb), now())
  on conflict (detection_hash) do nothing returning id into v_detection_id;

  if v_detection_id is null then
    select d.id,d.event_id into v_detection_id,v_existing_event_id from public.detections d where d.detection_hash=v_detection_hash;
    return jsonb_build_object('inserted',false,'duplicate',true,'outside_ukraine',false,'detection_id',v_detection_id,'event_id',v_existing_event_id,'oblast_id',v_oblast_id,'is_new_event',false,'should_notify',false);
  end if;

  select e.id into v_event_id
  from public.fire_events e
  where e.status in ('active','inactive') and e.oblast_id=v_oblast_id
    and p_acq_datetime >= e.first_seen - make_interval(hours=>p_match_window_hours)
    and p_acq_datetime <= e.last_seen + make_interval(hours=>p_match_window_hours)
    and extensions.ST_DWithin(e.last_location,v_point,p_match_radius_m)
  order by extensions.ST_Distance(e.last_location,v_point),e.last_seen desc
  limit 1 for update;

  if v_event_id is null then
    insert into public.fire_events (oblast_id,status,first_seen,last_seen,first_latitude,first_longitude,last_latitude,last_longitude,first_location,last_location,observation_count,match_radius_m,telegram_sent)
    values (v_oblast_id,'active',p_acq_datetime,p_acq_datetime,p_latitude,p_longitude,p_latitude,p_longitude,v_point,v_point,1,p_match_radius_m,false)
    returning id into v_event_id;
    v_new_event := true;
  else
    update public.fire_events e set oblast_id=v_oblast_id,status='active',first_seen=least(e.first_seen,p_acq_datetime),last_seen=greatest(e.last_seen,p_acq_datetime),first_latitude=case when p_acq_datetime<e.first_seen then p_latitude else e.first_latitude end,first_longitude=case when p_acq_datetime<e.first_seen then p_longitude else e.first_longitude end,first_location=case when p_acq_datetime<e.first_seen then v_point else e.first_location end,last_latitude=case when p_acq_datetime>=e.last_seen then p_latitude else e.last_latitude end,last_longitude=case when p_acq_datetime>=e.last_seen then p_longitude else e.last_longitude end,last_location=case when p_acq_datetime>=e.last_seen then v_point else e.last_location end,observation_count=e.observation_count+1,match_radius_m=p_match_radius_m,updated_at=now() where e.id=v_event_id;
  end if;

  update public.detections set event_id=v_event_id where id=v_detection_id;
  select coalesce((s.value->>'done')::boolean,false) into v_bootstrap_done from public.system_state s where s.key='bootstrap';

  return jsonb_build_object('inserted',true,'duplicate',false,'outside_ukraine',false,'detection_id',v_detection_id,'event_id',v_event_id,'oblast_id',v_oblast_id,'is_new_event',v_new_event,'should_notify',(v_new_event and coalesce(v_bootstrap_done,false)));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lookup_oblast_id(p_latitude double precision, p_longitude double precision)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select o.id
  from public.oblasts o
  where p_latitude between -90 and 90
    and p_longitude between -180 and 180
    and extensions.ST_Covers(
      o.geom,
      extensions.ST_SetSRID(extensions.ST_MakePoint(p_longitude, p_latitude), 4326)
    )
  order by o.id
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.promote_eumetsat_confirmed_events()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_count integer;
begin
  with candidates as (
    select e.id
    from public.fire_events e
    where e.telegram_sent=false
      and e.notification_required=false
      and e.first_seen >= now()-interval '3 hours'
      and exists (
        select 1 from public.detections d
        where d.event_id=e.id and d.source='EUMETSAT_MTG_MTFRPPIXEL'
      )
      and (
        exists (
          select 1 from public.detections d
          where d.event_id=e.id
            and d.source in ('MODIS_NRT','VIIRS_SNPP_NRT','VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT')
        )
        or (
          select case when count(*)>=2
                      then extract(epoch from (max(d.acq_datetime)-min(d.acq_datetime))) >= 480
                      else false end
          from public.detections d
          where d.event_id=e.id and d.source='EUMETSAT_MTG_MTFRPPIXEL'
        )
      )
  ), upd as (
    update public.fire_events e
    set notification_required=true,updated_at=now()
    from candidates c
    where e.id=c.id
    returning e.id
  )
  select count(*) into v_count from upd;
  return coalesce(v_count,0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.promote_event_on_fresh_polar_detection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_bootstrap_done boolean := false;
begin
  if new.event_id is null
     or new.source not in ('VIIRS_NOAA20_NRT','VIIRS_NOAA21_NRT','VIIRS_SNPP_NRT','MODIS_NRT')
     or new.acq_datetime < now()-interval '24 hours'
  then
    return new;
  end if;

  select coalesce((value->>'done')::boolean,false)
    into v_bootstrap_done
  from public.system_state
  where key='bootstrap';

  if v_bootstrap_done then
    update public.fire_events
    set notification_required=true
    where id=new.event_id
      and telegram_sent=false
      and notification_required=false
      and status<>'closed';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_all_fire_event_history()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  r record;
  n integer := 0;
begin
  for r in select id from public.fire_events loop
    perform public.refresh_fire_event_history(r.id);
    n := n + 1;
  end loop;
  return jsonb_build_object('refreshed_events',n,'completed_at',now());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_atmosphere_signal(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ai double precision;
  v_aod double precision;
  v_level text;
begin
  select greatest(coalesce(s5p_aer_ai_340_380,-999),coalesce(s5p_aer_ai_354_388,-999)),
         cams_aerosol_optical_depth
    into v_ai,v_aod
  from public.fire_events
  where id=p_event_id;

  v_level := case
    when v_ai > 2 and coalesce(v_aod,0) >= 0.3 then 'strong'
    when v_ai > 1 or coalesce(v_aod,0) >= 0.25 then 'elevated'
    when v_ai > -900 or v_aod is not null then 'background'
    else 'insufficient'
  end;

  update public.fire_events
  set atmosphere_signal_level=v_level,
      atmosphere_updated_at=now()
  where id=p_event_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_fire_event_history(p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  e public.fire_events%rowtype;
  c30 integer := 0;
  c90 integer := 0;
  c365 integer := 0;
  d30 integer := 0;
  d90 integer := 0;
  d365 integer := 0;
  archive_cells integer := 0;
  maxfrp double precision;
  score integer := 0;
  klass text := 'new';
begin
  select * into e from public.fire_events where id = p_event_id;
  if not found then return null; end if;

  with live_daily as (
    select
      (d.acq_datetime at time zone 'UTC')::date as day,
      count(distinct d.event_id)::integer as samples,
      max(d.frp) as max_frp,
      0::integer as archive_cells
    from public.detections d
    where d.event_id <> p_event_id
      and d.acq_datetime < e.first_seen
      and d.acq_datetime >= e.first_seen - interval '365 days'
      and st_dwithin(
        d.location,
        st_setsrid(st_makepoint(e.first_longitude,e.first_latitude),4326)::geography,
        e.history_radius_m
      )
    group by 1
  ), archive_daily as (
    select
      h.day,
      count(*)::integer as samples,
      max(h.max_frp) as max_frp,
      count(*)::integer as archive_cells
    from public.hotspot_history_daily h
    where h.day < (e.first_seen at time zone 'UTC')::date
      and h.day >= ((e.first_seen at time zone 'UTC')::date - 365)
      and st_dwithin(
        h.location,
        st_setsrid(st_makepoint(e.first_longitude,e.first_latitude),4326)::geography,
        e.history_radius_m + 200
      )
    group by h.day
  ), unified as (
    select day, max(samples)::integer as samples, max(max_frp) as max_frp, max(archive_cells)::integer as archive_cells
    from (
      select * from live_daily
      union all
      select * from archive_daily
    ) z
    group by day
  )
  select
    coalesce(sum(samples) filter (where day >= (e.first_seen at time zone 'UTC')::date - 30),0)::integer,
    coalesce(sum(samples) filter (where day >= (e.first_seen at time zone 'UTC')::date - 90),0)::integer,
    coalesce(sum(samples),0)::integer,
    count(*) filter (where day >= (e.first_seen at time zone 'UTC')::date - 30)::integer,
    count(*) filter (where day >= (e.first_seen at time zone 'UTC')::date - 90)::integer,
    count(*)::integer,
    coalesce(sum(archive_cells),0)::integer,
    max(max_frp)
  into c30,c90,c365,d30,d90,d365,archive_cells,maxfrp
  from unified;

  score := least(100,
    least(d30,10) * 5 +
    least(greatest(d90-d30,0),15) * 2 +
    least(greatest(d365-d90,0),25) +
    least(c365,20)
  );

  klass := case
    when d365 >= 10 or c365 >= 15 then 'persistent'
    when d365 >= 3 or c365 >= 5 then 'recurrent'
    when c365 >= 1 then 'occasional'
    else 'new'
  end;

  update public.fire_events
  set history_events_30d=c30,
      history_events_90d=c90,
      history_events_365d=c365,
      history_days_30d=d30,
      history_days_90d=d90,
      history_days_365d=d365,
      history_archive_cells_365d=archive_cells,
      history_archive_loaded=exists(select 1 from public.hotspot_history_daily limit 1),
      history_max_frp_365d=maxfrp,
      hotspot_score=score,
      hotspot_class=klass,
      history_updated_at=now()
  where id=p_event_id;

  return jsonb_build_object(
    'event_id',p_event_id,'radius_m',e.history_radius_m,
    'events_30d',c30,'events_90d',c90,'events_365d',c365,
    'days_30d',d30,'days_90d',d90,'days_365d',d365,
    'archive_cells_365d',archive_cells,
    'max_frp_365d',maxfrp,'score',score,'class',klass
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_fire_event_intelligence(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_latest double precision;
  v_prev double precision;
  v_pct double precision;
  v_trend text;
  v_diameter double precision := 0;
  v_motion double precision := 0;
  v_bearing double precision;
  v_summary text;
  v_platforms integer;
  v_atm text;
  v_plume_dir double precision;
  v_place text;
begin
  with ranked as (
    select frp,row_number() over(order by acq_datetime desc) rn
    from public.detections
    where event_id=p_event_id and frp is not null and frp>=0
    order by acq_datetime desc limit 6
  )
  select avg(frp) filter(where rn<=3),
         avg(frp) filter(where rn between 4 and 6)
  into v_latest,v_prev
  from ranked;

  if v_latest is not null and v_prev is not null and v_prev>0 then
    v_pct := ((v_latest-v_prev)/v_prev)*100.0;
    v_trend := case when v_pct>=30 then 'rising'
                    when v_pct<=-30 then 'falling'
                    else 'stable' end;
  elsif v_latest is not null then v_trend := 'insufficient';
  else v_trend := 'unknown';
  end if;

  select coalesce(max(ST_Distance(a.location,b.location)),0)
  into v_diameter
  from public.detections a
  join public.detections b on a.event_id=b.event_id and a.id<b.id
  where a.event_id=p_event_id;

  with r as (
    select latitude,longitude,row_number() over(order by acq_datetime desc) rn
    from public.detections where event_id=p_event_id
    order by acq_datetime desc limit 6
  ), a as (
    select avg(latitude) lat,avg(longitude) lon from r where rn<=3
  ), b as (
    select avg(latitude) lat,avg(longitude) lon from r where rn between 4 and 6
  )
  select ST_Distance(
           ST_SetSRID(ST_MakePoint(b.lon,b.lat),4326)::geography,
           ST_SetSRID(ST_MakePoint(a.lon,a.lat),4326)::geography),
         degrees(ST_Azimuth(
           ST_SetSRID(ST_MakePoint(b.lon,b.lat),4326)::geography,
           ST_SetSRID(ST_MakePoint(a.lon,a.lat),4326)::geography))
  into v_motion,v_bearing
  from a,b where a.lat is not null and b.lat is not null;

  select multisource_count,atmosphere_signal_level,plume_direction_deg,plume_reference_place
  into v_platforms,v_atm,v_plume_dir,v_place
  from public.fire_events where id=p_event_id;

  v_summary := concat_ws(' • ',
    case when coalesce(v_platforms,0)>0 then coalesce(v_platforms,0)::text || ' платформ' end,
    case v_trend when 'rising' then 'FRP растёт'
                 when 'falling' then 'FRP снижается'
                 when 'stable' then 'FRP стабильно' end,
    case when v_atm in ('elevated','strong') then 'атмосферный сигнал '||v_atm end,
    case when v_plume_dir is not null then 'перенос ~'||round(v_plume_dir)::int||'°' end,
    case when v_place is not null then 'ориентир '||v_place end
  );

  update public.fire_events
  set frp_trend=v_trend,frp_latest_avg=v_latest,frp_previous_avg=v_prev,
      frp_change_pct=v_pct,cluster_diameter_m=v_diameter,
      cluster_motion_m=v_motion,cluster_motion_bearing_deg=v_bearing,
      event_summary=nullif(v_summary,''),intelligence_updated_at=now()
  where id=p_event_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_fire_event_multisource(p_event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_count integer := 0;
  v_sources jsonb := '[]'::jsonb;
  v_level text;
  v_label text;
  v_lat double precision;
  v_lon double precision;
  v_source text;
  v_res integer;
begin
  with classified as (
    select
      d.*,
      case
        when d.source='VIIRS_NOAA20_NRT' then 'NOAA20_VIIRS'
        when d.source='VIIRS_NOAA21_NRT' then 'NOAA21_VIIRS'
        when d.source='VIIRS_SNPP_NRT' then 'SNPP_VIIRS'
        when d.source in ('COPERNICUS_S3_SL_2_FRP_SWIR500M','COPERNICUS_S3_SL_2_FRP_MWIR1KM','COPERNICUS_S3_SL_2_FRP')
          then coalesce(nullif(upper(d.satellite),''),'SENTINEL3') || '_SLSTR'
        when d.source='EUMETSAT_MTG_MTFRPPIXEL' then 'MTG_FCI'
        when d.source='LSA_SAF_MSG_FRP_PIXEL' then 'MSG_SEVIRI'
        when upper(coalesce(d.instrument,''))='MODIS' then coalesce(nullif(upper(d.satellite),''),'MODIS')
        when upper(coalesce(d.instrument,''))='VIIRS' and upper(coalesce(d.satellite,'')) like '%20%' then 'NOAA20_VIIRS'
        when upper(coalesce(d.instrument,''))='VIIRS' and upper(coalesce(d.satellite,'')) like '%21%' then 'NOAA21_VIIRS'
        when upper(coalesce(d.instrument,''))='VIIRS' and upper(coalesce(d.satellite,'')) like '%NPP%' then 'SNPP_VIIRS'
        else coalesce(nullif(upper(d.satellite),''),nullif(upper(d.instrument),''),upper(d.source),'UNKNOWN')
      end as platform_key,
      case
        when d.source='VIIRS_NOAA20_NRT' then 'NOAA-20 / VIIRS'
        when d.source='VIIRS_NOAA21_NRT' then 'NOAA-21 / VIIRS'
        when d.source='VIIRS_SNPP_NRT' then 'Suomi NPP / VIIRS'
        when d.source='COPERNICUS_S3_SL_2_FRP_SWIR500M' then coalesce(nullif(d.satellite,''),'Sentinel-3') || ' / SLSTR SWIR 500 м'
        when d.source in ('COPERNICUS_S3_SL_2_FRP_MWIR1KM','COPERNICUS_S3_SL_2_FRP') then coalesce(nullif(d.satellite,''),'Sentinel-3') || ' / SLSTR MWIR 1 км'
        when d.source='EUMETSAT_MTG_MTFRPPIXEL' then 'MTG / FCI'
        when d.source='LSA_SAF_MSG_FRP_PIXEL' then 'MSG / SEVIRI'
        when upper(coalesce(d.instrument,''))='MODIS' then coalesce(nullif(d.satellite,''),'MODIS') || ' / MODIS'
        else coalesce(nullif(d.satellite,''),nullif(d.instrument,''),d.source)
      end as display_label
    from public.detections d
    where d.event_id=p_event_id
  ),
  counts as (
    select count(distinct platform_key)::int as n
    from classified
  ),
  labels as (
    select distinct display_label from classified where display_label is not null
  )
  select c.n,
         coalesce((select jsonb_agg(display_label order by display_label) from labels),'[]'::jsonb)
  into v_count,v_sources
  from counts c;

  v_level := case when v_count >= 3 then 'high'
                  when v_count = 2 then 'confirmed'
                  when v_count = 1 then 'single'
                  else 'unknown' end;
  v_label := case when v_count >= 3 then 'Высокая уверенность: 3+ независимых спутниковых платформы'
                  when v_count = 2 then 'Подтверждено двумя независимыми спутниковыми платформами'
                  when v_count = 1 then 'Одиночная спутниковая платформа'
                  else 'Нет классифицированных источников' end;

  with ranked as (
    select d.latitude,d.longitude,d.source,d.acq_datetime,
      case
        when upper(coalesce(d.instrument,''))='VIIRS' then 375
        when d.source='COPERNICUS_S3_SL_2_FRP_SWIR500M' then 500
        when d.source in ('COPERNICUS_S3_SL_2_FRP_MWIR1KM','COPERNICUS_S3_SL_2_FRP') then 1000
        when d.source='EUMETSAT_MTG_MTFRPPIXEL' then 1000
        when upper(coalesce(d.instrument,''))='MODIS' then 1000
        when d.source='LSA_SAF_MSG_FRP_PIXEL' then 3000
        else 9999
      end as resolution_m,
      case
        when upper(coalesce(d.instrument,''))='VIIRS' then 1
        when d.source='COPERNICUS_S3_SL_2_FRP_SWIR500M' then 2
        when d.source in ('COPERNICUS_S3_SL_2_FRP_MWIR1KM','COPERNICUS_S3_SL_2_FRP') then 3
        when d.source='EUMETSAT_MTG_MTFRPPIXEL' then 3
        when upper(coalesce(d.instrument,''))='MODIS' then 3
        when d.source='LSA_SAF_MSG_FRP_PIXEL' then 4
        else 9
      end as quality_rank
    from public.detections d
    where d.event_id=p_event_id and d.latitude is not null and d.longitude is not null
  )
  select latitude,longitude,source,resolution_m
  into v_lat,v_lon,v_source,v_res
  from ranked
  order by quality_rank asc,acq_datetime desc
  limit 1;

  update public.fire_events
  set multisource_count=coalesce(v_count,0),
      multisource_sources=coalesce(v_sources,'[]'::jsonb),
      event_confidence_level=v_level,
      event_confidence_label=v_label,
      best_latitude=v_lat,
      best_longitude=v_lon,
      best_location=case when v_lat is null or v_lon is null then null else ST_SetSRID(ST_MakePoint(v_lon,v_lat),4326)::geography end,
      best_location_source=v_source,
      best_location_resolution_m=v_res,
      multisource_updated_at=now()
  where id=p_event_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_history_after_detection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if new.event_id is not null then
    perform public.refresh_fire_event_history(new.event_id);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_multisource_after_detection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
begin
  if new.event_id is not null and (old.event_id is distinct from new.event_id) then
    perform public.refresh_fire_event_multisource(new.event_id);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_fire_event_lifecycle(p_event_id uuid, p_lifecycle_status text, p_status text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update public.fire_events
  set lifecycle_status = p_lifecycle_status,
      status = coalesce(p_status, status),
      updated_at = now()
  where id = p_event_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_fire_event_notification_required()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_bootstrap_done boolean := false;
begin
  select coalesce((value->>'done')::boolean,false)
    into v_bootstrap_done
  from public.system_state
  where key='bootstrap';
  new.notification_required := coalesce(v_bootstrap_done,false);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
    new.updated_at = now();
    return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_ground_sensor_latest(p_source text, p_station_id text, p_station_name text, p_provider text, p_parameter text, p_value double precision, p_unit text, p_observed_at timestamp with time zone, p_lat double precision, p_lon double precision, p_source_url text DEFAULT NULL::text, p_is_old boolean DEFAULT NULL::boolean, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_point geography(Point,4326);
begin
  if nullif(trim(p_source),'') is null or nullif(trim(p_station_id),'') is null
     or nullif(trim(p_parameter),'') is null then
    raise exception 'source, station_id and parameter are required';
  end if;
  if p_value is null or p_observed_at is null or p_lat is null or p_lon is null
     or p_lat < -90 or p_lat > 90 or p_lon < -180 or p_lon > 180 then
    raise exception 'invalid ground sensor value/location/time';
  end if;
  v_point := st_setsrid(st_makepoint(p_lon,p_lat),4326)::geography;

  insert into public.ground_sensor_latest(
    source,station_id,station_name,provider,parameter,value,unit,observed_at,
    latitude,longitude,location,source_url,is_old,payload,updated_at
  ) values (
    trim(p_source),trim(p_station_id),left(p_station_name,300),left(p_provider,200),
    lower(trim(p_parameter)),p_value,left(p_unit,80),p_observed_at,
    p_lat,p_lon,v_point,left(p_source_url,1200),p_is_old,coalesce(p_payload,'{}'::jsonb),now()
  )
  on conflict(source,station_id,parameter) do update set
    station_name=excluded.station_name,
    provider=excluded.provider,
    value=excluded.value,
    unit=excluded.unit,
    observed_at=excluded.observed_at,
    latitude=excluded.latitude,
    longitude=excluded.longitude,
    location=excluded.location,
    source_url=excluded.source_url,
    is_old=excluded.is_old,
    payload=excluded.payload,
    updated_at=now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_hotspot_history_batch(p_sensor_family text, p_source_used text, p_rows jsonb, p_grid_deg double precision DEFAULT 0.0025)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_rows integer := 0;
  v_cells integer := 0;
begin
  if p_sensor_family is null or btrim(p_sensor_family) = '' then
    raise exception 'p_sensor_family is required';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;
  if p_grid_deg <= 0 or p_grid_deg > 0.02 then
    raise exception 'invalid grid size';
  end if;

  with parsed as (
    select
      (x->>'latitude')::double precision as lat,
      (x->>'longitude')::double precision as lon,
      (x->>'day')::date as day,
      nullif(x->>'frp','')::double precision as frp,
      lower(coalesce(x->>'confidence','')) as confidence
    from jsonb_array_elements(p_rows) x
    where nullif(x->>'latitude','') is not null
      and nullif(x->>'longitude','') is not null
      and nullif(x->>'day','') is not null
  ), valid as (
    select p.*,
      floor(p.lat / p_grid_deg)::integer as cell_lat,
      floor(p.lon / p_grid_deg)::integer as cell_lon
    from parsed p
    where p.lat between -90 and 90
      and p.lon between -180 and 180
      and exists (
        select 1
        from public.oblasts o
        where st_covers(o.geom, st_setsrid(st_makepoint(p.lon,p.lat),4326))
      )
  ), grouped as (
    select
      day, cell_lat, cell_lon,
      avg(lat) as latitude,
      avg(lon) as longitude,
      count(*)::integer as detection_count,
      max(frp) as max_frp,
      count(*) filter (where confidence in ('h','high') or (confidence ~ '^[0-9]+$' and confidence::integer >= 80))::integer as high_confidence_count
    from valid
    group by day, cell_lat, cell_lon
  ), ins as (
    insert into public.hotspot_history_daily(
      sensor_family,source_used,day,cell_lat,cell_lon,latitude,longitude,location,
      detection_count,max_frp,high_confidence_count,updated_at
    )
    select
      p_sensor_family,p_source_used,g.day,g.cell_lat,g.cell_lon,g.latitude,g.longitude,
      st_setsrid(st_makepoint(g.longitude,g.latitude),4326)::geography,
      g.detection_count,g.max_frp,g.high_confidence_count,now()
    from grouped g
    on conflict (sensor_family,day,cell_lat,cell_lon) do update set
      source_used=excluded.source_used,
      latitude=excluded.latitude,
      longitude=excluded.longitude,
      location=excluded.location,
      detection_count=excluded.detection_count,
      max_frp=excluded.max_frp,
      high_confidence_count=excluded.high_confidence_count,
      updated_at=now()
    returning 1
  )
  select (select count(*) from valid), (select count(*) from ins)
  into v_rows, v_cells;

  return jsonb_build_object('accepted_rows',coalesce(v_rows,0),'upserted_cells',coalesce(v_cells,0));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_osint_evidence(p_source text, p_source_event_id text, p_observed_at timestamp with time zone, p_lat double precision, p_lon double precision, p_title text, p_category text DEFAULT NULL::text, p_source_url text DEFAULT NULL::text, p_country_hint text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_point geography(Point,4326);
  v_oblast bigint;
  v_fire uuid;
  v_dist double precision;
  v_delta double precision;
  v_class text := 'unmatched';
  v_inside boolean := false;
  v_id uuid;
  v_inserted boolean := false;
begin
  if nullif(trim(p_source),'') is null or nullif(trim(p_source_event_id),'') is null then
    raise exception 'source and source_event_id are required';
  end if;
  if p_observed_at is null or p_lat is null or p_lon is null or
     p_lat < -90 or p_lat > 90 or p_lon < -180 or p_lon > 180 then
    raise exception 'invalid OSINT coordinates/time';
  end if;

  v_point := st_setsrid(st_makepoint(p_lon,p_lat),4326)::geography;

  select o.id into v_oblast
  from public.oblasts o
  where st_covers(o.geom, v_point::geometry)
  order by o.id
  limit 1;

  v_inside := v_oblast is not null
    or lower(coalesce(p_country_hint,'')) like '%ukraine%'
    or lower(coalesce(p_country_hint,'')) like '%україн%';

  if not v_inside then
    return jsonb_build_object('stored',false,'outside_ukraine',true);
  end if;

  select e.id,
         st_distance(coalesce(e.best_location,e.last_location),v_point),
         abs(extract(epoch from (e.last_seen-p_observed_at)))/60.0
    into v_fire,v_dist,v_delta
  from public.fire_events e
  where e.last_seen between p_observed_at - interval '72 hours'
                        and p_observed_at + interval '72 hours'
    and coalesce(e.best_location,e.last_location) is not null
    and st_dwithin(coalesce(e.best_location,e.last_location),v_point,100000)
  order by st_distance(coalesce(e.best_location,e.last_location),v_point),
           abs(extract(epoch from (e.last_seen-p_observed_at)))
  limit 1;

  if v_fire is not null then
    v_class := case
      when v_dist <= 10000 and v_delta <= 720 then 'strong_spatiotemporal'
      when v_dist <= 25000 and v_delta <= 1440 then 'close'
      else 'nearby'
    end;
  end if;

  select id into v_id
  from public.osint_evidence
  where source=p_source and source_event_id=p_source_event_id;

  v_inserted := v_id is null;

  insert into public.osint_evidence(
    source,source_event_id,observed_at,title,category,source_url,country_hint,
    latitude,longitude,location,oblast_id,fire_event_id,distance_m,time_delta_minutes,
    correlation_class,payload,last_seen_at,updated_at
  )
  values(
    trim(p_source),trim(p_source_event_id),p_observed_at,left(coalesce(nullif(trim(p_title),''),'Untitled'),500),
    left(p_category,160),left(p_source_url,1200),left(p_country_hint,300),
    p_lat,p_lon,v_point,v_oblast,v_fire,v_dist,v_delta,v_class,coalesce(p_payload,'{}'::jsonb),now(),now()
  )
  on conflict(source,source_event_id) do update set
    observed_at=excluded.observed_at,
    title=excluded.title,
    category=excluded.category,
    source_url=excluded.source_url,
    country_hint=excluded.country_hint,
    latitude=excluded.latitude,
    longitude=excluded.longitude,
    location=excluded.location,
    oblast_id=excluded.oblast_id,
    fire_event_id=excluded.fire_event_id,
    distance_m=excluded.distance_m,
    time_delta_minutes=excluded.time_delta_minutes,
    correlation_class=excluded.correlation_class,
    payload=excluded.payload,
    last_seen_at=now(),
    updated_at=now()
  returning id into v_id;

  return jsonb_build_object(
    'stored',true,
    'inserted',v_inserted,
    'id',v_id,
    'oblast_id',v_oblast,
    'fire_event_id',v_fire,
    'distance_m',v_dist,
    'time_delta_minutes',v_delta,
    'correlation_class',v_class
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_firewatch_cron_secret(p_secret text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
  select exists (
    select 1
    from vault.decrypted_secrets
    where name='firewatch_cron_secret'
      and decrypted_secret = p_secret
  );
$function$
;


-- Function ACLs
revoke all on function public.complete_bootstrap() from public, anon, authenticated, service_role;
revoke all on function public.find_hotspot_history_nearby(p_lat double precision, p_lon double precision, p_radius_m integer, p_days integer, p_limit integer) from public, anon, authenticated, service_role;
revoke all on function public.fire_event_atmosphere(p_event_id uuid) from public, anon, authenticated, service_role;
revoke all on function public.fire_event_intelligence(p_event_id uuid) from public, anon, authenticated, service_role;
revoke all on function public.fire_event_multisource(p_event_id uuid) from public, anon, authenticated, service_role;
revoke all on function public.fire_event_rollup(p_event_id uuid) from public, anon, authenticated, service_role;
revoke all on function public.fire_events_osm_circuit_breaker() from public, anon, authenticated, service_role;
revoke all on function public.fire_events_requiring_telegram_sync(p_limit integer) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_acquire_telegram_lease(p_holder text, p_ttl_seconds integer) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_admin_snapshot() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_analytics_summary(p_hours integer) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_build_event_dossier(p_event uuid) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_build_event_dossier_stage28(p_event uuid) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_build_event_dossier_stage37(p_event uuid) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_build_event_dossier_stage371(p_event uuid) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_build_event_dossier_stage373(p_event uuid) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_client_access(p_telegram_user_id bigint) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_client_create_invite(p_code text, p_role text, p_max_uses integer, p_expires_at timestamp with time zone, p_label text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_client_increment_request(p_telegram_user_id bigint) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_client_redeem_invite(p_telegram_user_id bigint, p_code text, p_username text, p_first_name text, p_last_name text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_client_touch_user(p_telegram_user_id bigint, p_username text, p_first_name text, p_last_name text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_cron_health_summary() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_dossier(p_query text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_event_detail(p_query text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_event_timeline(p_query text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_geo_context(p_query text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_geo_integrity_refresh(p_records jsonb) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_geo_integrity_summary() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_ground_context(p_query text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_maintenance() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_notification_integrity_refresh() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_notification_integrity_summary() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_optional_vault_secret(p_name text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_osint_event_detail(p_query text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_public_post_context(p_event uuid) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_quota_snapshot() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_refresh_dossiers(p_limit integer) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_refresh_event_dossier(p_event uuid) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_release_telegram_lease(p_holder text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_report_status(p_query text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_satellite_evidence(p_query text) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_search_events(p_filters jsonb) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_source_baseline_refresh() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_source_baseline_summary() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_source_coverage_refresh() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_source_coverage_summary() from public, anon, authenticated, service_role;
revoke all on function public.firewatch_usage_increment(p_media_uploads integer, p_media_bytes bigint, p_caption_only_edits integer) from public, anon, authenticated, service_role;
revoke all on function public.firewatch_watchdog_snapshot() from public, anon, authenticated, service_role;
revoke all on function public.ingest_eumetsat_frp_batch(p_records jsonb, p_match_radius_m integer, p_match_window_hours integer) from public, anon, authenticated, service_role;
revoke all on function public.ingest_firms_batch(p_records jsonb, p_match_radius_m integer, p_match_window_hours integer) from public, anon, authenticated, service_role;
revoke all on function public.ingest_firms_detection(p_source text, p_satellite text, p_instrument text, p_acq_datetime timestamp with time zone, p_latitude double precision, p_longitude double precision, p_scan double precision, p_track double precision, p_confidence text, p_frp double precision, p_daynight text, p_raw jsonb, p_match_radius_m integer, p_match_window_hours integer) from public, anon, authenticated, service_role;
revoke all on function public.lookup_oblast_id(p_latitude double precision, p_longitude double precision) from public, anon, authenticated, service_role;
revoke all on function public.promote_eumetsat_confirmed_events() from public, anon, authenticated, service_role;
revoke all on function public.promote_event_on_fresh_polar_detection() from public, anon, authenticated, service_role;
revoke all on function public.refresh_all_fire_event_history() from public, anon, authenticated, service_role;
revoke all on function public.refresh_atmosphere_signal(p_event_id uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_fire_event_history(p_event_id uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_fire_event_intelligence(p_event_id uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_fire_event_multisource(p_event_id uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_history_after_detection() from public, anon, authenticated, service_role;
revoke all on function public.refresh_multisource_after_detection() from public, anon, authenticated, service_role;
revoke all on function public.rls_auto_enable() from public, anon, authenticated, service_role;
revoke all on function public.set_fire_event_lifecycle(p_event_id uuid, p_lifecycle_status text, p_status text) from public, anon, authenticated, service_role;
revoke all on function public.set_fire_event_notification_required() from public, anon, authenticated, service_role;
revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.upsert_ground_sensor_latest(p_source text, p_station_id text, p_station_name text, p_provider text, p_parameter text, p_value double precision, p_unit text, p_observed_at timestamp with time zone, p_lat double precision, p_lon double precision, p_source_url text, p_is_old boolean, p_payload jsonb) from public, anon, authenticated, service_role;
revoke all on function public.upsert_hotspot_history_batch(p_sensor_family text, p_source_used text, p_rows jsonb, p_grid_deg double precision) from public, anon, authenticated, service_role;
revoke all on function public.upsert_osint_evidence(p_source text, p_source_event_id text, p_observed_at timestamp with time zone, p_lat double precision, p_lon double precision, p_title text, p_category text, p_source_url text, p_country_hint text, p_payload jsonb) from public, anon, authenticated, service_role;
revoke all on function public.verify_firewatch_cron_secret(p_secret text) from public, anon, authenticated, service_role;
grant execute on function public.complete_bootstrap() to service_role;
grant execute on function public.find_hotspot_history_nearby(p_lat double precision, p_lon double precision, p_radius_m integer, p_days integer, p_limit integer) to service_role;
grant execute on function public.fire_event_atmosphere(p_event_id uuid) to service_role;
grant execute on function public.fire_event_intelligence(p_event_id uuid) to service_role;
grant execute on function public.fire_event_multisource(p_event_id uuid) to service_role;
grant execute on function public.fire_event_rollup(p_event_id uuid) to service_role;
grant execute on function public.fire_events_osm_circuit_breaker() to anon;
grant execute on function public.fire_events_osm_circuit_breaker() to authenticated;
grant execute on function public.fire_events_osm_circuit_breaker() to public;
grant execute on function public.fire_events_osm_circuit_breaker() to service_role;
grant execute on function public.fire_events_requiring_telegram_sync(p_limit integer) to service_role;
grant execute on function public.firewatch_acquire_telegram_lease(p_holder text, p_ttl_seconds integer) to service_role;
grant execute on function public.firewatch_admin_snapshot() to service_role;
grant execute on function public.firewatch_analytics_summary(p_hours integer) to service_role;
grant execute on function public.firewatch_build_event_dossier(p_event uuid) to service_role;
grant execute on function public.firewatch_build_event_dossier_stage28(p_event uuid) to service_role;
grant execute on function public.firewatch_build_event_dossier_stage37(p_event uuid) to service_role;
grant execute on function public.firewatch_build_event_dossier_stage371(p_event uuid) to service_role;
grant execute on function public.firewatch_build_event_dossier_stage373(p_event uuid) to service_role;
grant execute on function public.firewatch_client_access(p_telegram_user_id bigint) to service_role;
grant execute on function public.firewatch_client_create_invite(p_code text, p_role text, p_max_uses integer, p_expires_at timestamp with time zone, p_label text) to service_role;
grant execute on function public.firewatch_client_increment_request(p_telegram_user_id bigint) to service_role;
grant execute on function public.firewatch_client_redeem_invite(p_telegram_user_id bigint, p_code text, p_username text, p_first_name text, p_last_name text) to service_role;
grant execute on function public.firewatch_client_touch_user(p_telegram_user_id bigint, p_username text, p_first_name text, p_last_name text) to service_role;
grant execute on function public.firewatch_cron_health_summary() to service_role;
grant execute on function public.firewatch_dossier(p_query text) to service_role;
grant execute on function public.firewatch_event_detail(p_query text) to service_role;
grant execute on function public.firewatch_event_timeline(p_query text) to service_role;
grant execute on function public.firewatch_geo_context(p_query text) to service_role;
grant execute on function public.firewatch_geo_integrity_refresh(p_records jsonb) to service_role;
grant execute on function public.firewatch_geo_integrity_summary() to service_role;
grant execute on function public.firewatch_ground_context(p_query text) to service_role;
grant execute on function public.firewatch_maintenance() to service_role;
grant execute on function public.firewatch_notification_integrity_refresh() to service_role;
grant execute on function public.firewatch_notification_integrity_summary() to service_role;
grant execute on function public.firewatch_optional_vault_secret(p_name text) to service_role;
grant execute on function public.firewatch_osint_event_detail(p_query text) to service_role;
grant execute on function public.firewatch_public_post_context(p_event uuid) to service_role;
grant execute on function public.firewatch_quota_snapshot() to service_role;
grant execute on function public.firewatch_refresh_dossiers(p_limit integer) to service_role;
grant execute on function public.firewatch_refresh_event_dossier(p_event uuid) to service_role;
grant execute on function public.firewatch_release_telegram_lease(p_holder text) to service_role;
grant execute on function public.firewatch_report_status(p_query text) to service_role;
grant execute on function public.firewatch_satellite_evidence(p_query text) to service_role;
grant execute on function public.firewatch_search_events(p_filters jsonb) to service_role;
grant execute on function public.firewatch_source_baseline_refresh() to service_role;
grant execute on function public.firewatch_source_baseline_summary() to service_role;
grant execute on function public.firewatch_source_coverage_refresh() to service_role;
grant execute on function public.firewatch_source_coverage_summary() to service_role;
grant execute on function public.firewatch_usage_increment(p_media_uploads integer, p_media_bytes bigint, p_caption_only_edits integer) to service_role;
grant execute on function public.firewatch_watchdog_snapshot() to service_role;
grant execute on function public.ingest_eumetsat_frp_batch(p_records jsonb, p_match_radius_m integer, p_match_window_hours integer) to service_role;
grant execute on function public.ingest_firms_batch(p_records jsonb, p_match_radius_m integer, p_match_window_hours integer) to service_role;
grant execute on function public.ingest_firms_detection(p_source text, p_satellite text, p_instrument text, p_acq_datetime timestamp with time zone, p_latitude double precision, p_longitude double precision, p_scan double precision, p_track double precision, p_confidence text, p_frp double precision, p_daynight text, p_raw jsonb, p_match_radius_m integer, p_match_window_hours integer) to service_role;
grant execute on function public.lookup_oblast_id(p_latitude double precision, p_longitude double precision) to service_role;
grant execute on function public.promote_eumetsat_confirmed_events() to service_role;
grant execute on function public.promote_event_on_fresh_polar_detection() to service_role;
grant execute on function public.refresh_all_fire_event_history() to service_role;
grant execute on function public.refresh_atmosphere_signal(p_event_id uuid) to service_role;
grant execute on function public.refresh_fire_event_history(p_event_id uuid) to service_role;
grant execute on function public.refresh_fire_event_intelligence(p_event_id uuid) to service_role;
grant execute on function public.refresh_fire_event_multisource(p_event_id uuid) to service_role;
grant execute on function public.refresh_history_after_detection() to service_role;
grant execute on function public.refresh_multisource_after_detection() to service_role;
grant execute on function public.rls_auto_enable() to service_role;
grant execute on function public.set_fire_event_lifecycle(p_event_id uuid, p_lifecycle_status text, p_status text) to service_role;
grant execute on function public.set_fire_event_notification_required() to service_role;
grant execute on function public.set_updated_at() to service_role;
grant execute on function public.upsert_ground_sensor_latest(p_source text, p_station_id text, p_station_name text, p_provider text, p_parameter text, p_value double precision, p_unit text, p_observed_at timestamp with time zone, p_lat double precision, p_lon double precision, p_source_url text, p_is_old boolean, p_payload jsonb) to service_role;
grant execute on function public.upsert_hotspot_history_batch(p_sensor_family text, p_source_used text, p_rows jsonb, p_grid_deg double precision) to service_role;
grant execute on function public.upsert_osint_evidence(p_source text, p_source_event_id text, p_observed_at timestamp with time zone, p_lat double precision, p_lon double precision, p_title text, p_category text, p_source_url text, p_country_hint text, p_payload jsonb) to service_role;
grant execute on function public.verify_firewatch_cron_secret(p_secret text) to service_role;

-- Table triggers
drop trigger if exists detections_promote_suppressed_event on public.detections; CREATE TRIGGER detections_promote_suppressed_event AFTER UPDATE OF event_id ON detections FOR EACH ROW WHEN (old.event_id IS DISTINCT FROM new.event_id AND new.event_id IS NOT NULL) EXECUTE FUNCTION promote_event_on_fresh_polar_detection();
drop trigger if exists trg_refresh_history_after_detection on public.detections; CREATE TRIGGER trg_refresh_history_after_detection AFTER INSERT ON detections FOR EACH ROW EXECUTE FUNCTION refresh_history_after_detection();
drop trigger if exists trg_refresh_multisource_after_detection on public.detections; CREATE TRIGGER trg_refresh_multisource_after_detection AFTER UPDATE OF event_id ON detections FOR EACH ROW EXECUTE FUNCTION refresh_multisource_after_detection();
drop trigger if exists fire_events_osm_circuit_breaker on public.fire_events; CREATE TRIGGER fire_events_osm_circuit_breaker BEFORE INSERT ON fire_events FOR EACH ROW EXECUTE FUNCTION fire_events_osm_circuit_breaker();
drop trigger if exists fire_events_set_notification_required on public.fire_events; CREATE TRIGGER fire_events_set_notification_required BEFORE INSERT ON fire_events FOR EACH ROW EXECUTE FUNCTION set_fire_event_notification_required();
drop trigger if exists fire_events_set_updated_at on public.fire_events; CREATE TRIGGER fire_events_set_updated_at BEFORE UPDATE ON fire_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists oblasts_set_updated_at on public.oblasts; CREATE TRIGGER oblasts_set_updated_at BEFORE UPDATE ON oblasts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
drop trigger if exists system_state_set_updated_at on public.system_state; CREATE TRIGGER system_state_set_updated_at BEFORE UPDATE ON system_state FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Event triggers
drop event trigger if exists ensure_rls; create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') execute function rls_auto_enable();
