-- Stage 40.6 — Provenance & Review Queue
-- 2026-09-24

create table if not exists public.osint_statement_provenance(
  id bigserial primary key,
  fire_event_id uuid references public.fire_events(id) on delete cascade,
  semantic_item_id uuid references public.osint_semantic_items(id) on delete cascade,
  statement_kind text not null check (statement_kind in ('claim','entity','event_link')),
  statement_key text not null,
  statement_type text,
  statement_value text,
  source_name text,
  provider text,
  source_class text,
  extractor_version text,
  extraction_confidence smallint check (extraction_confidence between 0 and 100),
  link_relevance smallint check (link_relevance between 0 and 100),
  source_independent boolean,
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed','accepted','rejected','needs_more_evidence')),
  provenance jsonb not null default '{}'::jsonb,
  observed_at timestamptz,
  captured_at timestamptz not null default now(),
  unique(statement_kind,statement_key,extractor_version)
);
alter table public.osint_statement_provenance enable row level security;
revoke all on table public.osint_statement_provenance from anon,authenticated;
create index if not exists osint_statement_provenance_event_idx
  on public.osint_statement_provenance(fire_event_id,captured_at desc);
create index if not exists osint_statement_provenance_item_idx
  on public.osint_statement_provenance(semantic_item_id);
create index if not exists osint_statement_provenance_review_idx
  on public.osint_statement_provenance(review_status,statement_kind,captured_at desc);

create table if not exists public.osint_review_queue(
  id bigserial primary key,
  fire_event_id uuid references public.fire_events(id) on delete cascade,
  target_kind text not null check (target_kind in ('semantic_item','claim','entity','event_link','divergence')),
  target_key text not null,
  reason_code text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high')),
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','needs_more_evidence')),
  title text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer text,
  reviewer_note text,
  unique(target_kind,target_key,reason_code)
);
alter table public.osint_review_queue enable row level security;
revoke all on table public.osint_review_queue from anon,authenticated;
create index if not exists osint_review_queue_status_idx
  on public.osint_review_queue(status,severity,created_at desc);
create index if not exists osint_review_queue_event_idx
  on public.osint_review_queue(fire_event_id,status);

CREATE OR REPLACE FUNCTION public.firewatch_deep_osint(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d jsonb; s jsonb; g jsonb; a jsonb; loc jsonb; vis jsonb; prov jsonb;
begin
  d:=public.firewatch_deep_osint_stage401(p_query);
  if d is null then return null; end if;
  s:=public.firewatch_semantic_osint(p_query);
  g:=public.firewatch_osint_evidence_graph(p_query);
  a:=public.firewatch_air_context(p_query);
  loc:=public.firewatch_geolocation_context(p_query);
  vis:=public.firewatch_visual_context(p_query);
  prov:=public.firewatch_provenance_summary(p_query);

  return d
    || jsonb_build_object('semantic',coalesce(s,jsonb_build_object('summary',jsonb_build_object('items',0))))
    || jsonb_build_object('evidence_graph',coalesce(g,jsonb_build_object('nodes','[]'::jsonb,'edges','[]'::jsonb)))
    || jsonb_build_object('air_context',coalesce(a,jsonb_build_object('combined_context','unavailable')))
    || jsonb_build_object('geolocation',coalesce(loc,jsonb_build_object('status','not_cached')))
    || jsonb_build_object('visual_context',coalesce(vis,jsonb_build_object('status','not_cached')))
    || jsonb_build_object('provenance',coalesce(prov,jsonb_build_object('statements',0,'pending_reviews',0)));
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_provenance_summary(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event uuid;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event from public.fire_events order by last_seen desc limit 1;
  else
    select id into v_event from public.fire_events
    where lower(id::text) like lower(trim(p_query))||'%'
    order by last_seen desc limit 1;
  end if;
  if v_event is null then return null; end if;

  return jsonb_build_object(
    'event_id',v_event,
    'statements',(select count(*) from public.osint_statement_provenance p where p.fire_event_id=v_event),
    'claims',(select count(*) from public.osint_statement_provenance p where p.fire_event_id=v_event and p.statement_kind='claim'),
    'entities',(select count(*) from public.osint_statement_provenance p where p.fire_event_id=v_event and p.statement_kind='entity'),
    'event_links',(select count(*) from public.osint_statement_provenance p where p.fire_event_id=v_event and p.statement_kind='event_link'),
    'independent_statements',(select count(*) from public.osint_statement_provenance p where p.fire_event_id=v_event and p.source_independent=true),
    'reviewed',(select count(*) from public.osint_statement_provenance p where p.fire_event_id=v_event and p.review_status<>'unreviewed'),
    'pending_reviews',(select count(*) from public.osint_review_queue q where q.fire_event_id=v_event and q.status='pending'),
    'high_priority_reviews',(select count(*) from public.osint_review_queue q where q.fire_event_id=v_event and q.status='pending' and q.severity='high'),
    'extractor_versions',coalesce((
      select jsonb_agg(x order by x->>'version')
      from (
        select jsonb_build_object('version',extractor_version,'statements',count(*)) x
        from public.osint_statement_provenance p
        where p.fire_event_id=v_event
        group by extractor_version
      ) s
    ),'[]'::jsonb),
    'policy','Provenance records extraction/source lineage. Review status is an analyst workflow state, not a truth score.'
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_refresh_statement_provenance(p_event uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c_claim int:=0; c_entity int:=0; c_link int:=0; c_review int:=0;
begin
  insert into public.osint_statement_provenance(
    fire_event_id,semantic_item_id,statement_kind,statement_key,statement_type,statement_value,
    source_name,provider,source_class,extractor_version,extraction_confidence,
    source_independent,provenance,observed_at
  )
  select
    s.fire_event_id,s.id,'claim',
    'claim:'||c.id::text,
    c.claim_type,
    coalesce(c.object_text,c.numeric_value::text),
    s.source_name,s.provider,s.source_class,s.semantic_version,c.confidence,
    coalesce(sc.independent_for_corroboration,false),
    jsonb_build_object(
      'origin_kind',s.origin_kind,'origin_id',s.origin_id,'item_key',s.item_key,
      'claim_id',c.id,'subject',c.subject,'numeric_value',c.numeric_value,'unit',c.unit,
      'claim_attributes',c.attributes
    ),
    coalesce(s.published_at,s.processed_at)
  from public.osint_claims c
  join public.osint_semantic_items s on s.id=c.semantic_item_id
  left join public.osint_source_catalog sc
    on lower(sc.provider)=lower(coalesce(s.provider,s.source_name))
       or lower(sc.label)=lower(s.source_name)
  where (p_event is null or s.fire_event_id=p_event)
  on conflict(statement_kind,statement_key,extractor_version) do update set
    fire_event_id=excluded.fire_event_id,
    extraction_confidence=excluded.extraction_confidence,
    source_independent=excluded.source_independent,
    provenance=excluded.provenance,
    captured_at=now();
  get diagnostics c_claim=row_count;

  insert into public.osint_statement_provenance(
    fire_event_id,semantic_item_id,statement_kind,statement_key,statement_type,statement_value,
    source_name,provider,source_class,extractor_version,extraction_confidence,
    source_independent,provenance,observed_at
  )
  select
    s.fire_event_id,s.id,'entity',
    'entity:'||e.id::text,
    e.entity_type,e.canonical,
    s.source_name,s.provider,s.source_class,s.semantic_version,e.confidence,
    coalesce(sc.independent_for_corroboration,false),
    jsonb_build_object(
      'origin_kind',s.origin_kind,'origin_id',s.origin_id,'item_key',s.item_key,
      'entity_id',e.id,'surface',e.surface,'entity_attributes',e.attributes
    ),
    coalesce(s.published_at,s.processed_at)
  from public.osint_entities e
  join public.osint_semantic_items s on s.id=e.semantic_item_id
  left join public.osint_source_catalog sc
    on lower(sc.provider)=lower(coalesce(s.provider,s.source_name))
       or lower(sc.label)=lower(s.source_name)
  where (p_event is null or s.fire_event_id=p_event)
  on conflict(statement_kind,statement_key,extractor_version) do update set
    fire_event_id=excluded.fire_event_id,
    extraction_confidence=excluded.extraction_confidence,
    source_independent=excluded.source_independent,
    provenance=excluded.provenance,
    captured_at=now();
  get diagnostics c_entity=row_count;

  insert into public.osint_statement_provenance(
    fire_event_id,semantic_item_id,statement_kind,statement_key,statement_type,statement_value,
    source_name,provider,source_class,extractor_version,link_relevance,
    source_independent,provenance,observed_at
  )
  select
    l.fire_event_id,
    s.id,
    'event_link',
    'event_link:'||l.document_id::text||':'||l.fire_event_id::text,
    'document_event_link',
    d.title,
    sc.label,sc.provider,sc.source_class,'fusion-link-v1',l.relevance_score,
    coalesce(sc.independent_for_corroboration,false),
    jsonb_build_object(
      'document_id',l.document_id,'distance_m',l.distance_m,'time_delta_seconds',l.time_delta_seconds,
      'text_score',l.text_score,'geo_score',l.geo_score,'time_score',l.time_score,
      'match_basis',l.match_basis,'document_url',d.url
    ),
    coalesce(d.published_at,d.first_seen_at)
  from public.osint_event_links l
  join public.osint_documents d on d.id=l.document_id
  left join public.osint_source_catalog sc on sc.source_key=d.source_key
  left join lateral (
    select x.id
    from public.osint_semantic_items x
    where x.fire_event_id=l.fire_event_id
      and x.origin_kind='fusion_document'
      and x.origin_id=l.document_id
    order by x.processed_at desc limit 1
  ) s on true
  where (p_event is null or l.fire_event_id=p_event)
  on conflict(statement_kind,statement_key,extractor_version) do update set
    link_relevance=excluded.link_relevance,
    source_independent=excluded.source_independent,
    provenance=excluded.provenance,
    captured_at=now();
  get diagnostics c_link=row_count;

  insert into public.osint_review_queue(
    fire_event_id,target_kind,target_key,reason_code,severity,title,context
  )
  select distinct
    s.fire_event_id,'semantic_item',s.id::text,
    case c.object_text
      when 'foreign_location_signal' then 'foreign_location_signal'
      when 'other_known_place' then 'location_mismatch'
      else 'weak_location_support'
    end,
    case c.object_text
      when 'foreign_location_signal' then 'high'
      when 'other_known_place' then 'medium'
      else 'low'
    end,
    left(s.title,240),
    jsonb_build_object(
      'source',s.source_name,'provider',s.provider,'published_at',s.published_at,
      'geo_status',c.object_text,'geo_score',coalesce((c.attributes->>'geo_score')::int,0),
      'semantic_version',s.semantic_version
    )
  from public.osint_claims c
  join public.osint_semantic_items s on s.id=c.semantic_item_id
  where c.claim_type='semantic_geo_status'
    and c.object_text in ('foreign_location_signal','other_known_place','none')
    and (p_event is null or s.fire_event_id=p_event)
  on conflict(target_kind,target_key,reason_code) do update set
    context=excluded.context,updated_at=now()
  where public.osint_review_queue.status='pending';
  get diagnostics c_review=row_count;

  insert into public.osint_review_queue(
    fire_event_id,target_kind,target_key,reason_code,severity,title,context
  )
  select
    d.fire_event_id,'divergence',d.id::text,'numeric_claim_divergence','medium',
    'Numeric claim divergence: '||d.claim_type,
    jsonb_build_object(
      'claim_type',d.claim_type,'value_a',d.value_a,'value_b',d.value_b,
      'delta',d.delta,'explanation',d.explanation,'detected_at',d.detected_at
    )
  from public.osint_claim_divergences d
  where d.status='unresolved'
    and (p_event is null or d.fire_event_id=p_event)
  on conflict(target_kind,target_key,reason_code) do update set
    context=excluded.context,updated_at=now()
  where public.osint_review_queue.status='pending';

  return jsonb_build_object(
    'claims_upserted',c_claim,
    'entities_upserted',c_entity,
    'links_upserted',c_link,
    'review_geo_upserted',c_review,
    'pending_reviews',(select count(*) from public.osint_review_queue where status='pending')
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_review_action(p_review_id bigint, p_status text, p_reviewer text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare q public.osint_review_queue%rowtype;
begin
  if p_status not in ('accepted','rejected','needs_more_evidence') then
    raise exception 'invalid review status';
  end if;

  update public.osint_review_queue
  set status=p_status,reviewed_at=now(),reviewer=nullif(trim(p_reviewer),''),
      reviewer_note=nullif(trim(p_note),''),updated_at=now()
  where id=p_review_id
  returning * into q;
  if not found then return jsonb_build_object('ok',false,'error','review_not_found'); end if;

  update public.osint_statement_provenance
  set review_status=p_status
  where
    (q.target_kind='claim' and statement_key='claim:'||q.target_key)
    or (q.target_kind='entity' and statement_key='entity:'||q.target_key)
    or (q.target_kind='event_link' and statement_key=q.target_key)
    or (q.target_kind='semantic_item' and semantic_item_id::text=q.target_key);

  return jsonb_build_object(
    'ok',true,'review_id',q.id,'status',q.status,'target_kind',q.target_kind,'target_key',q.target_key
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_review_queue(p_limit integer DEFAULT 20, p_event text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event uuid;
begin
  if nullif(trim(p_event),'') is not null then
    select id into v_event from public.fire_events
    where lower(id::text) like lower(trim(p_event))||'%'
    order by last_seen desc limit 1;
  end if;
  return jsonb_build_object(
    'pending',(select count(*) from public.osint_review_queue q where q.status='pending' and (v_event is null or q.fire_event_id=v_event)),
    'items',coalesce((
      select jsonb_agg(to_jsonb(x) order by
        case x.severity when 'high' then 3 when 'medium' then 2 else 1 end desc,
        x.created_at asc)
      from (
        select id,fire_event_id,target_kind,target_key,reason_code,severity,status,title,context,created_at
        from public.osint_review_queue q
        where q.status='pending' and (v_event is null or q.fire_event_id=v_event)
        order by case q.severity when 'high' then 3 when 'medium' then 2 else 1 end desc,q.created_at asc
        limit greatest(1,least(coalesce(p_limit,20),100))
      ) x
    ),'[]'::jsonb)
  );
end;
$function$
;



revoke all on function public.firewatch_refresh_statement_provenance(uuid) from public,anon,authenticated;
grant execute on function public.firewatch_refresh_statement_provenance(uuid) to service_role;
revoke all on function public.firewatch_review_queue(integer,text) from public,anon,authenticated;
grant execute on function public.firewatch_review_queue(integer,text) to service_role;
revoke all on function public.firewatch_review_action(bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.firewatch_review_action(bigint,text,text,text) to service_role;
revoke all on function public.firewatch_provenance_summary(text) from public,anon,authenticated;
grant execute on function public.firewatch_provenance_summary(text) to service_role;
revoke all on function public.firewatch_deep_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint(text) to service_role;

select public.firewatch_refresh_statement_provenance(null);
