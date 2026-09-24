-- Stage 40.7 — Graph + Map Dashboard
-- 2026-09-24

CREATE OR REPLACE FUNCTION public.firewatch_dashboard_event_intel(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d jsonb; g jsonb; r jsonb; l jsonb;
begin
  d:=public.firewatch_deep_osint(p_query);
  if d is null then return null; end if;
  g:=public.firewatch_dashboard_evidence_graph(p_query);
  r:=public.firewatch_review_queue(20,p_query);
  l:=public.firewatch_event_latency(p_query);
  return jsonb_build_object(
    'deep',d,
    'graph',coalesce(g,jsonb_build_object('nodes','[]'::jsonb,'edges','[]'::jsonb)),
    'reviews',coalesce(r,jsonb_build_object('pending',0,'items','[]'::jsonb)),
    'latency',coalesce(l,'{}'::jsonb)
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_dashboard_evidence_graph(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare g jsonb; v_event uuid; filtered_edges jsonb; filtered_nodes jsonb; rejected int:=0;
begin
  g:=public.firewatch_osint_evidence_graph(p_query);
  if g is null then return null; end if;
  v_event:=(g->>'event_id')::uuid;

  with rejected_items as (
    select 'item:'||s.id::text id
    from public.osint_semantic_items s
    left join public.event_public_osint p
      on s.origin_kind='public_osint' and p.id=s.origin_id
    where s.fire_event_id=v_event
      and (
        coalesce(p.category,'')='geo_rejected'
        or exists (
          select 1 from public.osint_claims c
          where c.semantic_item_id=s.id
            and c.claim_type='semantic_geo_status'
            and c.object_text in ('foreign_location_signal','other_known_place')
        )
      )
  ),
  edges as (
    select e
    from jsonb_array_elements(coalesce(g->'edges','[]'::jsonb)) e
    where not exists (
      select 1 from rejected_items r
      where r.id=e->>'from' or r.id=e->>'to'
    )
  )
  select coalesce(jsonb_agg(e),'[]'::jsonb) into filtered_edges from edges;

  with used as (
    select filtered_edges->i->>'from' id
    from generate_series(0,greatest(jsonb_array_length(filtered_edges)-1,0)) i
    where jsonb_array_length(filtered_edges)>0
    union
    select filtered_edges->i->>'to'
    from generate_series(0,greatest(jsonb_array_length(filtered_edges)-1,0)) i
    where jsonb_array_length(filtered_edges)>0
    union
    select 'event:'||v_event::text
  ),
  nodes as (
    select n
    from jsonb_array_elements(coalesce(g->'nodes','[]'::jsonb)) n
    where n->>'id' in (select id from used)
  )
  select coalesce(jsonb_agg(n),'[]'::jsonb) into filtered_nodes from nodes;

  select count(*) into rejected
  from public.osint_semantic_items s
  left join public.event_public_osint p
    on s.origin_kind='public_osint' and p.id=s.origin_id
  where s.fire_event_id=v_event
    and (
      coalesce(p.category,'')='geo_rejected'
      or exists (
        select 1 from public.osint_claims c
        where c.semantic_item_id=s.id
          and c.claim_type='semantic_geo_status'
          and c.object_text in ('foreign_location_signal','other_known_place')
      )
    );

  return jsonb_build_object(
    'event_id',v_event,
    'nodes',filtered_nodes,
    'edges',filtered_edges,
    'stats',jsonb_build_object(
      'nodes',jsonb_array_length(filtered_nodes),
      'edges',jsonb_array_length(filtered_edges),
      'rejected_documents',rejected
    ),
    'policy','Active graph excludes hard geographic rejects. Edges describe extracted/document relationships and do not establish causation.'
  );
end;
$function$
;



revoke all on function public.firewatch_dashboard_evidence_graph(text) from public,anon,authenticated;
grant execute on function public.firewatch_dashboard_evidence_graph(text) to service_role;
revoke all on function public.firewatch_dashboard_event_intel(text) from public,anon,authenticated;
grant execute on function public.firewatch_dashboard_event_intel(text) to service_role;
