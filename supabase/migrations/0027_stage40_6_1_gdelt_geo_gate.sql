-- Stage 40.6.1 — Hard geographic gate for event-scoped GDELT
-- 2026-09-24

update public.event_public_osint p
set relevance_score=0,
    category='geo_rejected',
    match_basis=coalesce(p.match_basis,'{}'::jsonb) || jsonb_build_object(
      'geo_gate','rejected_no_explicit_location_match'
    ),
    updated_at=now()
where p.source_kind='news'
  and p.match_basis->>'method'='event_scoped_gdelt'
  and coalesce((p.match_basis->'location'->>'matched')::boolean,false)=false
  and coalesce(p.category,'')<>'geo_rejected';

CREATE OR REPLACE FUNCTION public.firewatch_deep_osint_core(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_event uuid;
  e public.fire_events%rowtype;
  v_rows jsonb;
  v_sources jsonb;
  v_summary jsonb;
  v_provider_count integer:=0;
  v_class_count integer:=0;
  v_corroboration text:='none';
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

  with fusion as (
    select d.source_key source,s.label source_label,s.provider,s.source_class,d.external_id,
           d.published_at observed_at,d.title,d.summary,d.url,
           l.relevance_score,l.distance_m,l.time_delta_seconds,l.match_basis,'fusion'::text channel
    from public.osint_event_links l
    join public.osint_documents d on d.id=l.document_id
    join public.osint_source_catalog s on s.source_key=d.source_key
    where l.fire_event_id=v_event

    union all

    select p.source_name,p.source_name,p.source_name,p.source_kind,p.source_item_id,
           p.published_at,p.title,null::text,p.source_url,p.relevance_score,null::double precision,
           case when p.published_at is null then null
                else extract(epoch from (p.published_at-e.last_seen)) end,
           p.match_basis,'public_osint'
    from public.event_public_osint p
    where p.fire_event_id=v_event
      and coalesce(p.category,'')<>'geo_rejected'
      and not exists (
        select 1
        from public.osint_semantic_items si
        join public.osint_claims sc on sc.semantic_item_id=si.id
        where si.fire_event_id=v_event
          and si.origin_kind='public_osint'
          and si.origin_id=p.id
          and sc.claim_type='semantic_geo_status'
          and sc.object_text in ('foreign_location_signal','other_known_place')
      )

    union all

    select x.source,x.source,x.source,'legacy_external',x.source_event_id,
           x.observed_at,x.title,null::text,x.source_url,
           greatest(0,least(100,
             case
               when x.correlation_class in ('very_close','strong','high') then 80
               when x.correlation_class in ('close','moderate','medium') then 60
               when x.correlation_class is not null then 40
               else 30 end
           ))::int,
           x.distance_m,
           case when x.time_delta_minutes is null then null else x.time_delta_minutes*60 end,
           jsonb_build_object('correlation_class',x.correlation_class),
           'legacy_osint'
    from public.osint_evidence x
    where x.fire_event_id=v_event
  ), ranked as (
    select * from fusion order by relevance_score desc nulls last,observed_at desc nulls last
  )
  select coalesce(
    jsonb_agg(to_jsonb(r) order by relevance_score desc nulls last,observed_at desc nulls last),
    '[]'::jsonb
  )
  into v_rows
  from (select * from ranked limit 75) r;

  with strong as (
    select distinct s.provider,s.source_class
    from public.osint_event_links l
    join public.osint_documents d on d.id=l.document_id
    join public.osint_source_catalog s on s.source_key=d.source_key
    where l.fire_event_id=v_event and l.relevance_score>=50
  )
  select count(distinct provider),count(distinct source_class)
  into v_provider_count,v_class_count
  from strong;

  v_corroboration:=case
    when v_provider_count>=3 and v_class_count>=2 then 'multi-provider'
    when v_provider_count>=2 then 'two-provider'
    when v_provider_count=1 then 'single-provider'
    else 'none' end;

  with allsrc as (
    select d.source_key source,s.label,s.provider,s.source_class,
           max(l.relevance_score) max_relevance,count(*) evidence_count
    from public.osint_event_links l
    join public.osint_documents d on d.id=l.document_id
    join public.osint_source_catalog s on s.source_key=d.source_key
    where l.fire_event_id=v_event
    group by d.source_key,s.label,s.provider,s.source_class
  )
  select coalesce(
    jsonb_agg(to_jsonb(x) order by max_relevance desc,label),
    '[]'::jsonb
  )
  into v_sources
  from allsrc x;

  select jsonb_build_object(
    'fusion_documents',(select count(*) from public.osint_event_links where fire_event_id=v_event),
    'fusion_sources',(select count(distinct d.source_key)
                      from public.osint_event_links l
                      join public.osint_documents d on d.id=l.document_id
                      where l.fire_event_id=v_event),
    'strong_independent_providers',v_provider_count,
    'strong_source_classes',v_class_count,
    'corroboration_level',v_corroboration,
    'high_relevance',(select count(*) from public.osint_event_links where fire_event_id=v_event and relevance_score>=60),
    'public_osint',(select count(*) from public.event_public_osint p
                    where p.fire_event_id=v_event
                      and coalesce(p.category,'')<>'geo_rejected'
                      and not exists (
                        select 1 from public.osint_semantic_items si
                        join public.osint_claims sc on sc.semantic_item_id=si.id
                        where si.fire_event_id=v_event
                          and si.origin_kind='public_osint'
                          and si.origin_id=p.id
                          and sc.claim_type='semantic_geo_status'
                          and sc.object_text in ('foreign_location_signal','other_known_place')
                      )),
    'legacy_external',(select count(*) from public.osint_evidence where fire_event_id=v_event)
  ) into v_summary;

  return jsonb_build_object(
    'event',jsonb_build_object(
      'id',e.id,'first_seen',e.first_seen,'last_seen',e.last_seen,
      'latitude',coalesce(e.best_latitude,e.last_latitude,e.first_latitude),
      'longitude',coalesce(e.best_longitude,e.last_longitude,e.first_longitude),
      'priority_score',e.priority_score,'priority_level',e.priority_level,
      'confidence_level',e.event_confidence_level,'nearest_place',e.nearest_place_name
    ),
    'summary',v_summary,
    'sources',v_sources,
    'timeline',v_rows,
    'policy','OSINT correlation is contextual. Spatial, temporal or textual proximity does not establish causation or attribution.'
  );
end;
$function$
;


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

  with all_items as (
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
  items as (
    select a.*
    from all_items a
    where not (
      a.origin_kind='public_osint'
      and exists (
        select 1
        from public.event_public_osint p
        where p.id=a.origin_id
          and coalesce(p.category,'')='geo_rejected'
      )
    )
      and coalesce(a.geo_status,'') not in ('foreign_location_signal','other_known_place')
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
      'foreign_location_signals',(select count(*) from all_items where geo_status='foreign_location_signal'),
      'geo_rejected',(select count(*) from all_items where
        geo_status in ('foreign_location_signal','other_known_place')
        or (origin_kind='public_osint' and exists (
          select 1 from public.event_public_osint p where p.id=all_items.origin_id and coalesce(p.category,'')='geo_rejected'
        ))),
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
                       from all_items where geo_status in ('none','foreign_location_signal','other_known_place')),'[]'::jsonb),
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



revoke all on function public.firewatch_deep_osint_core(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint_core(text) to service_role;
revoke all on function public.firewatch_semantic_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_semantic_osint(text) to service_role;
