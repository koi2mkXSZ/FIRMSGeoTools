-- Hotfix: preserve late enrichment in Telegram publications
-- 2026-09-24

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
        coalesce(l.updated_at,'epoch'::timestamptz),
        coalesce(e.atmosphere_updated_at,'epoch'::timestamptz),
        coalesce(e.intelligence_updated_at,'epoch'::timestamptz),
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
    'geolocation', case when l.fire_event_id is null then null else jsonb_build_object(
      'status',l.status,
      'updated_at',l.updated_at,
      'nearest_place',case
        when jsonb_typeof(l.geonames_places)='array' and jsonb_array_length(l.geonames_places)>0
        then jsonb_build_object(
          'name',l.geonames_places->0->>'name',
          'toponym_name',l.geonames_places->0->>'toponym_name',
          'distance_km',l.geonames_places->0->'distance_km',
          'feature_code',l.geonames_places->0->>'feature_code',
          'source','GeoNames'
        )
        else null
      end
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
  left join public.event_geolocation_context l on l.fire_event_id=e.id
  where e.id=p_event;
$function$
;



revoke all on function public.firewatch_public_post_context(uuid) from public,anon,authenticated;
grant execute on function public.firewatch_public_post_context(uuid) to service_role;
revoke all on function public.fire_events_requiring_telegram_sync(integer) from public,anon,authenticated;
grant execute on function public.fire_events_requiring_telegram_sync(integer) to service_role;
