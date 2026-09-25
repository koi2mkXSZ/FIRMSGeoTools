-- FIRMSGeoTools VERSION 1.0.0
-- schema_version 42
-- Stage 43.2.2.1 — idempotent Neptun correlation + Telegram deletion resync
-- 2026-09-25

alter table public.fire_events
  add column if not exists neptun_context_updated_at timestamptz;

comment on column public.fire_events.neptun_context_updated_at is
  'Last material change of selected Neptun/FIRMS temporal context, including context removal.';

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
  v_changed integer := 0;
  v_removed integer := 0;
  v_inserted integer := 0;
  v_changed_ids jsonb := '[]'::jsonb;
begin
  create temporary table if not exists pg_temp.neptun_scope_events(
    fire_event_id uuid primary key
  ) on commit drop;
  truncate pg_temp.neptun_scope_events;

  insert into pg_temp.neptun_scope_events(fire_event_id)
  select id
  from public.fire_events
  where first_seen >= now() - make_interval(hours=>v_hours)
    and coalesce(best_latitude,last_latitude) is not null
    and coalesce(best_longitude,last_longitude) is not null;

  create temporary table if not exists pg_temp.neptun_context_target(
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
    primary key(fire_event_id,track_id)
  ) on commit drop;
  truncate pg_temp.neptun_context_target;

  insert into pg_temp.neptun_context_target
  with events as (
    select e.id,e.first_seen,
           coalesce(e.best_latitude,e.last_latitude) lat,
           coalesce(e.best_longitude,e.last_longitude) lon
    from public.fire_events e
    join pg_temp.neptun_scope_events s on s.fire_event_id=e.id
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
  select r.fire_event_id,r.track_id,r.threat_type,r.label,round(r.distance_m),
         r.nearest_at,r.event_time_reference,r.offset_s,r.heading_deg,r.group_count,
         r.confidence_0_100,r.place,r.description
  from ranked r
  where r.rn=1
    and (
      r.offset_s<=0
      or not exists (
        select 1 from ranked p
        where p.fire_event_id=r.fire_event_id
          and p.rn=1
          and p.offset_s<=0
      )
    );

  create temporary table if not exists pg_temp.neptun_changed_events(
    fire_event_id uuid primary key,
    had_before boolean not null,
    has_after boolean not null
  ) on commit drop;
  truncate pg_temp.neptun_changed_events;

  insert into pg_temp.neptun_changed_events(fire_event_id,had_before,has_after)
  with existing_sig as (
    select c.fire_event_id,
      jsonb_agg(
        jsonb_build_array(
          c.track_id,c.threat_type,c.label,round(c.nearest_distance_m::numeric,0),
          c.nearest_at,c.event_time_reference,c.time_offset_seconds,
          case when c.heading_deg is null then null else round(c.heading_deg::numeric,6) end,
          c.group_count,
          case when c.confidence_0_100 is null then null else round(c.confidence_0_100::numeric,6) end,
          c.place,c.description
        ) order by c.track_id
      ) sig
    from public.event_air_threat_context c
    join pg_temp.neptun_scope_events s on s.fire_event_id=c.fire_event_id
    where c.source_name='Neptun'
    group by c.fire_event_id
  ),
  target_sig as (
    select t.fire_event_id,
      jsonb_agg(
        jsonb_build_array(
          t.track_id,t.threat_type,t.label,round(t.nearest_distance_m::numeric,0),
          t.nearest_at,t.event_time_reference,t.time_offset_seconds,
          case when t.heading_deg is null then null else round(t.heading_deg::numeric,6) end,
          t.group_count,
          case when t.confidence_0_100 is null then null else round(t.confidence_0_100::numeric,6) end,
          t.place,t.description
        ) order by t.track_id
      ) sig
    from pg_temp.neptun_context_target t
    group by t.fire_event_id
  )
  select s.fire_event_id, e.sig is not null, t.sig is not null
  from pg_temp.neptun_scope_events s
  left join existing_sig e on e.fire_event_id=s.fire_event_id
  left join target_sig t on t.fire_event_id=s.fire_event_id
  where coalesce(e.sig,'[]'::jsonb) is distinct from coalesce(t.sig,'[]'::jsonb);

  select count(*),count(*) filter(where had_before and not has_after)
  into v_changed,v_removed
  from pg_temp.neptun_changed_events;

  delete from public.event_air_threat_context c
  using pg_temp.neptun_changed_events x
  where c.fire_event_id=x.fire_event_id
    and c.source_name='Neptun';

  insert into public.event_air_threat_context(
    fire_event_id,track_id,threat_type,label,nearest_distance_m,nearest_at,event_time_reference,
    time_offset_seconds,heading_deg,group_count,confidence_0_100,place,description,
    source_name,source_url,first_matched_at,last_matched_at,updated_at
  )
  select t.fire_event_id,t.track_id,t.threat_type,t.label,t.nearest_distance_m,t.nearest_at,t.event_time_reference,
         t.time_offset_seconds,t.heading_deg,t.group_count,t.confidence_0_100,t.place,t.description,
         'Neptun','https://neptun.in.ua/',now(),now(),now()
  from pg_temp.neptun_context_target t
  join pg_temp.neptun_changed_events x on x.fire_event_id=t.fire_event_id;
  get diagnostics v_inserted = row_count;

  update public.fire_events e
  set neptun_context_updated_at=now()
  from pg_temp.neptun_changed_events x
  where e.id=x.fire_event_id;

  select count(distinct fire_event_id),
         count(*),
         count(*) filter(where time_offset_seconds<=0),
         count(*) filter(where time_offset_seconds>0)
  into v_events,v_rows,v_before,v_after
  from pg_temp.neptun_context_target;

  select count(distinct fire_event_id) into v_events_with_pre
  from pg_temp.neptun_context_target
  where time_offset_seconds<=0;

  select coalesce(jsonb_agg(fire_event_id order by fire_event_id::text),'[]'::jsonb)
  into v_changed_ids
  from pg_temp.neptun_changed_events;

  return jsonb_build_object(
    'ok',true,
    'window_hours',v_hours,
    'event_count',v_events,
    'events_with_pre_context',v_events_with_pre,
    'context_rows',v_rows,
    'before_or_at_firms',v_before,
    'after_firms_fallback',v_after,
    'changed_events',v_changed,
    'removed_context_events',v_removed,
    'inserted_or_replaced_rows',v_inserted,
    'changed_event_ids',v_changed_ids,
    'history_window_before_hours',6,
    'history_window_after_minutes',30,
    'match_radius_km',50,
    'idempotent',true,
    'policy','Historical Neptun source timestamps are matched around FIRMS acquisition time. Pre-FIRMS context is preferred. Post-FIRMS is a <=30 minute fallback only. Unchanged context keeps its prior updated_at; removals are explicitly timestamped on fire_events for Telegram resync.'
  );
end;
$$;

revoke all on function public.firewatch_rebuild_neptun_context(integer) from public,anon,authenticated;
grant execute on function public.firewatch_rebuild_neptun_context(integer) to service_role;

create or replace function public.fire_events_requiring_telegram_sync(p_limit integer default 100)
returns table(event_id uuid, sync_reason text)
language sql
stable security definer
set search_path to 'public','pg_temp'
as $function$
  with enrich as (
    select e.id,
      greatest(
        coalesce(g.updated_at,'epoch'::timestamptz),
        coalesce(h.updated_at,'epoch'::timestamptz),
        coalesce(l.updated_at,'epoch'::timestamptz),
        coalesce(e.atmosphere_updated_at,'epoch'::timestamptz),
        coalesce(e.intelligence_updated_at,'epoch'::timestamptz),
        coalesce(e.neptun_context_updated_at,'epoch'::timestamptz),
        coalesce((select max(x.first_seen_at) from public.event_public_osint x where x.fire_event_id=e.id),'epoch'::timestamptz),
        coalesce((select max(a.updated_at) from public.event_air_threat_context a where a.fire_event_id=e.id),'epoch'::timestamptz),
        coalesce(s.updated_at,'epoch'::timestamptz)
      ) enrichment_at
    from public.fire_events e
    left join public.geo_osint_event_cache g on g.fire_event_id=e.id
    left join public.ghsl_event_cache h on h.fire_event_id=e.id
    left join public.event_geolocation_context l on l.fire_event_id=e.id
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
          and (
            e.first_seen >= now()-interval '72 hours'
            or (
              e.first_seen >= now()-interval '168 hours'
              and coalesce(e.neptun_context_updated_at,'epoch'::timestamptz)
                  > coalesce(e.telegram_last_update_at,'epoch'::timestamptz)
            )
          )
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
       or (
          e.telegram_sent and e.telegram_message_id is not null
          and (
            e.first_seen >= now()-interval '72 hours'
            or (
              e.first_seen >= now()-interval '168 hours'
              and coalesce(e.neptun_context_updated_at,'epoch'::timestamptz)
                  > coalesce(e.telegram_last_update_at,'epoch'::timestamptz)
            )
          )
          and x.enrichment_at > coalesce(e.telegram_last_update_at,'epoch'::timestamptz)
       )
  )
  select id,reason from q where reason is not null
  order by case reason when 'new' then 0 when 'close' then 1 when 'update' then 2 else 3 end,first_seen asc
  limit greatest(1,least(coalesce(p_limit,100),500));
$function$;

revoke all on function public.fire_events_requiring_telegram_sync(integer) from public,anon,authenticated;
grant execute on function public.fire_events_requiring_telegram_sync(integer) to service_role;

-- Rebuild the available seven-day history once on upgrade.
select public.firewatch_rebuild_neptun_context(168);
