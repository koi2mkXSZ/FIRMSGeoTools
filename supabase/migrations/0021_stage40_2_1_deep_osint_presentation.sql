-- Stage 40.2.1 — Deep OSINT presentation/metric correction
-- 2026-09-24

CREATE OR REPLACE FUNCTION public.firewatch_semantic_osint(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event uuid; e public.fire_events%rowtype; result jsonb;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event from public.fire_events order by last_seen desc limit 1;
  else
    select id into v_event from public.fire_events
    where lower(id::text) like lower(trim(p_query))||'%'
    order by last_seen desc limit 1;
  end if;
  if v_event is null then return null; end if;
  select * into e from public.fire_events where id=v_event;

  with items as (
    select s.*,
           cm.cluster_id,cm.similarity_score,
           coalesce((select (c.attributes->>'geo_score')::int from public.osint_claims c
                     where c.semantic_item_id=s.id and c.claim_type='semantic_geo_status' limit 1),0) geo_score,
           (select c.object_text from public.osint_claims c
            where c.semantic_item_id=s.id and c.claim_type='semantic_geo_status' limit 1) geo_status
    from public.osint_semantic_items s
    left join public.osint_cluster_members cm on cm.semantic_item_id=s.id
    where s.fire_event_id=v_event
  ),
  cluster_stats as (
    select cluster_id,count(*) item_count,count(distinct provider) provider_count,
           min(published_at) first_at,max(published_at) last_at,
           max(similarity_score) max_similarity
    from items where cluster_id is not null group by cluster_id
  ),
  entities as (
    select en.entity_type,en.canonical,
           count(*) mentions,count(distinct i.provider) providers,
           max(en.confidence) confidence
    from public.osint_entities en
    join items i on i.id=en.semantic_item_id
    group by en.entity_type,en.canonical
  ),
  claims as (
    select c.claim_type,c.object_text,c.numeric_value,c.unit,
           count(*) mentions,count(distinct i.provider) providers,
           max(c.confidence) confidence,
           min(i.published_at) first_at,max(i.published_at) last_at
    from public.osint_claims c
    join items i on i.id=c.semantic_item_id
    where c.claim_type<>'semantic_geo_status'
    group by c.claim_type,c.object_text,c.numeric_value,c.unit
  )
  select jsonb_build_object(
    'event',jsonb_build_object(
      'id',e.id,'priority_score',e.priority_score,'priority_level',e.priority_level,
      'confidence_level',e.event_confidence_level,'nearest_place',e.nearest_place_name
    ),
    'summary',jsonb_build_object(
      'items',(select count(*) from items),
      'providers',(select count(distinct provider) from items),
      'source_classes',(select count(distinct source_class) from items where source_class is not null),
      'clusters',(select count(*) from cluster_stats),
      'duplicate_items',(select coalesce(sum(greatest(item_count-1,0)),0) from cluster_stats),
      'geo_supported',(select count(*) from items where geo_score>=90),
      'country_only',(select count(*) from items where geo_status='country_only'),
      'other_known_place',(select count(*) from items where geo_status='other_known_place'),
      'geo_unsupported',(select count(*) from items where geo_status in ('none','foreign_location_signal','other_known_place')),
      'foreign_location_signals',(select count(*) from items where geo_status='foreign_location_signal'),
      'divergences',(select count(*) from public.osint_claim_divergences where fire_event_id=v_event and status='unresolved')
    ),
    'entities',coalesce((select jsonb_agg(to_jsonb(x) order by providers desc,mentions desc,entity_type,canonical)
                         from (select * from entities order by providers desc,mentions desc limit 40) x),'[]'::jsonb),
    'claims',coalesce((select jsonb_agg(to_jsonb(x) order by providers desc,mentions desc,claim_type)
                       from (select * from claims order by providers desc,mentions desc limit 40) x),'[]'::jsonb),
    'clusters',coalesce((select jsonb_agg(to_jsonb(x) order by item_count desc,last_at desc)
                         from (select * from cluster_stats order by item_count desc,last_at desc limit 20) x),'[]'::jsonb),
    'geo_flags',coalesce((select jsonb_agg(jsonb_build_object(
                         'item_id',id,'source',source_name,'provider',provider,'published_at',published_at,
                         'title',left(title,220),'geo_status',geo_status,'geo_score',geo_score,
                         'review_action',case
                           when geo_status='foreign_location_signal' then 'reject_candidate'
                           when geo_status='other_known_place' then 'review_location'
                           else 'weak_location_support' end
                       ) order by published_at desc nulls last)
                       from items where geo_status in ('none','foreign_location_signal','other_known_place')),'[]'::jsonb),
    'divergences',coalesce((select jsonb_agg(jsonb_build_object(
                         'claim_type',d.claim_type,'value_a',d.value_a,'value_b',d.value_b,'delta',d.delta,
                         'status',d.status,'explanation',d.explanation,
                         'source_a',a.source_name,'source_b',b.source_name,
                         'published_a',a.published_at,'published_b',b.published_at
                       ) order by d.detected_at desc)
                       from public.osint_claim_divergences d
                       join public.osint_semantic_items a on a.id=d.item_a
                       join public.osint_semantic_items b on b.id=d.item_b
                       where d.fire_event_id=v_event),'[]'::jsonb),
    'policy','Semantic extraction is deterministic contextual analysis. Geographic mismatch and numeric divergence are review flags, not automatic findings of falsehood or causation.'
  ) into result;

  return result;
end;
$function$
;

revoke all on function public.firewatch_semantic_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_semantic_osint(text) to service_role;
