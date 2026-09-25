-- FIRMSGeoTools VERSION 1.0.0
-- schema_version 41
-- Stage 43.2.2 — Neptun historical FIRMS-time correlation fix
-- 2026-09-25

create index if not exists neptun_track_history_source_time_idx
on public.neptun_track_history(source_time desc);

create or replace function public.firewatch_rebuild_neptun_context(p_hours integer default 24)
returns jsonb
language plpgsql
security invoker
set search_path to 'public','extensions','pg_temp'
as $$
declare
  v_hours integer := greatest(1,least(coalesce(p_hours,24),168));
  v_events integer := 0;
  v_rows integer := 0;
  v_before integer := 0;
  v_after integer := 0;
  v_events_with_pre integer := 0;
begin
  create temporary table if not exists pg_temp.neptun_context_rebuild(
    fire_event_id uuid,
    track_id text,
    threat_type text,
    label text,
    nearest_distance_m double precision,
    nearest_at timestamptz,
    event_time_reference timestamptz,
    time_offset_seconds integer,
    heading_deg double precision,
    group_count integer,
    confidence_0_100 double precision,
    place text,
    description text,
    rn integer
  ) on commit drop;
  truncate pg_temp.neptun_context_rebuild;

  insert into pg_temp.neptun_context_rebuild
  with events as (
    select id,first_seen,
           coalesce(best_latitude,last_latitude) lat,
           coalesce(best_longitude,last_longitude) lon
    from public.fire_events
    where first_seen >= now() - make_interval(hours=>v_hours)
      and coalesce(best_latitude,last_latitude) is not null
      and coalesce(best_longitude,last_longitude) is not null
  ),
  candidates as (
    select
      e.id fire_event_id,
      h.track_id,h.threat_type,h.label,
      st_distance(
        st_setsrid(st_makepoint(h.longitude,h.latitude),4326)::geography,
        st_setsrid(st_makepoint(e.lon,e.lat),4326)::geography
      ) distance_m,
      h.source_time nearest_at,e.first_seen event_time_reference,
      round(extract(epoch from (h.source_time-e.first_seen)))::integer offset_s,
      h.heading_deg,h.group_count,h.confidence_0_100,h.place,h.description
    from events e
    join public.neptun_track_history h
      on h.source_time between e.first_seen - interval '6 hours'
                           and e.first_seen + interval '30 minutes'
    where st_dwithin(
      st_setsrid(st_makepoint(h.longitude,h.latitude),4326)::geography,
      st_setsrid(st_makepoint(e.lon,e.lat),4326)::geography,
      50000
    )
  ),
  ranked as (
    select c.*,
      row_number() over(
        partition by c.fire_event_id,c.track_id
        order by
          case when c.offset_s<=0 then 0 else 1 end,
          (
            0.55*(c.distance_m/50000.0)
            +0.35*(abs(c.offset_s)/21600.0)
            +0.10*((100.0-coalesce(c.confidence_0_100,50.0))/100.0)
          ) asc,
          abs(c.offset_s) asc,
          c.distance_m asc
      ) rn
    from candidates c
  )
  select fire_event_id,track_id,threat_type,label,distance_m,nearest_at,event_time_reference,
         offset_s,heading_deg,group_count,confidence_0_100,place,description,rn
  from ranked;

  select count(distinct fire_event_id) into v_events
  from pg_temp.neptun_context_rebuild where rn=1;

  select count(distinct fire_event_id) into v_events_with_pre
  from pg_temp.neptun_context_rebuild where rn=1 and time_offset_seconds<=0;

  delete from public.event_air_threat_context c
  using public.fire_events e
  where c.fire_event_id=e.id
    and e.first_seen >= now() - make_interval(hours=>v_hours);

  insert into public.event_air_threat_context(
    fire_event_id,track_id,threat_type,label,nearest_distance_m,nearest_at,event_time_reference,
    time_offset_seconds,heading_deg,group_count,confidence_0_100,place,description,
    source_name,source_url,first_matched_at,last_matched_at,updated_at
  )
  select r.fire_event_id,r.track_id,r.threat_type,r.label,round(r.nearest_distance_m),r.nearest_at,r.event_time_reference,
         r.time_offset_seconds,r.heading_deg,r.group_count,r.confidence_0_100,r.place,r.description,
         'Neptun','https://neptun.in.ua/',now(),now(),now()
  from pg_temp.neptun_context_rebuild r
  where r.rn=1
    and (
      r.time_offset_seconds<=0
      or not exists (
        select 1 from pg_temp.neptun_context_rebuild p
        where p.fire_event_id=r.fire_event_id
          and p.rn=1
          and p.time_offset_seconds<=0
      )
    );

  get diagnostics v_rows = row_count;

  select count(*) filter(where c.time_offset_seconds<=0),
         count(*) filter(where c.time_offset_seconds>0)
  into v_before,v_after
  from public.event_air_threat_context c
  join public.fire_events e on e.id=c.fire_event_id
  where e.first_seen >= now() - make_interval(hours=>v_hours);

  return jsonb_build_object(
    'ok',true,
    'window_hours',v_hours,
    'event_count',v_events,
    'events_with_pre_context',v_events_with_pre,
    'context_rows',v_rows,
    'before_or_at_firms',v_before,
    'after_firms_fallback',v_after,
    'history_window_before_hours',6,
    'history_window_after_minutes',30,
    'match_radius_km',50,
    'policy','Historical Neptun snapshots are matched around FIRMS acquisition time. If any pre-FIRMS context exists for an event, post-FIRMS candidates are excluded from publication context. Post-FIRMS is a <=30 minute fallback only.'
  );
end;
$$;

revoke all on function public.firewatch_rebuild_neptun_context(integer) from public,anon,authenticated;
grant execute on function public.firewatch_rebuild_neptun_context(integer) to service_role;

-- Backfill recent publication context on deployment / clean restore.
select public.firewatch_rebuild_neptun_context(24);
