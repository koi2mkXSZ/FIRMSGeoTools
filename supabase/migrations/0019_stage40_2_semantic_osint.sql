-- Stage 40.2 — Semantic / Entity OSINT Engine
-- 2026-09-24
-- Deterministic extraction, near-duplicate clustering, geo-review flags, claim divergence and evidence graph.

create table if not exists public.osint_semantic_items(
  id uuid primary key default gen_random_uuid(),
  item_key text not null unique,
  origin_kind text not null check(origin_kind in ('fusion','public_osint')),
  origin_id uuid not null,
  fire_event_id uuid references public.fire_events(id) on delete cascade,
  source_name text not null,
  source_class text,
  provider text,
  published_at timestamptz,
  title text not null,
  body text,
  normalized_text text not null,
  fingerprint text not null,
  language text,
  semantic_version text not null default 'stage40.2-v1',
  processed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.osint_semantic_items enable row level security;
revoke all on table public.osint_semantic_items from anon,authenticated;
create index if not exists osint_semantic_items_event_idx on public.osint_semantic_items(fire_event_id,published_at desc);
create index if not exists osint_semantic_items_fingerprint_idx on public.osint_semantic_items(fingerprint);
create index if not exists osint_semantic_items_text_trgm on public.osint_semantic_items using gin(normalized_text extensions.gin_trgm_ops);

create table if not exists public.osint_entities(
  id bigserial primary key,
  semantic_item_id uuid not null references public.osint_semantic_items(id) on delete cascade,
  entity_type text not null,
  canonical text not null,
  surface text not null,
  confidence smallint not null check(confidence between 0 and 100),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(semantic_item_id,entity_type,canonical,surface)
);
alter table public.osint_entities enable row level security;
revoke all on table public.osint_entities from anon,authenticated;
create index if not exists osint_entities_item_idx on public.osint_entities(semantic_item_id);
create index if not exists osint_entities_canonical_idx on public.osint_entities(entity_type,canonical);

create table if not exists public.osint_claims(
  id bigserial primary key,
  semantic_item_id uuid not null references public.osint_semantic_items(id) on delete cascade,
  claim_type text not null,
  subject text,
  object_text text,
  numeric_value double precision,
  unit text,
  confidence smallint not null check(confidence between 0 and 100),
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(semantic_item_id,claim_type,subject,object_text,numeric_value,unit)
);
alter table public.osint_claims enable row level security;
revoke all on table public.osint_claims from anon,authenticated;
create index if not exists osint_claims_item_idx on public.osint_claims(semantic_item_id);
create index if not exists osint_claims_type_idx on public.osint_claims(claim_type,numeric_value);

create table if not exists public.osint_document_clusters(
  id uuid primary key default gen_random_uuid(),
  representative_item_id uuid references public.osint_semantic_items(id) on delete set null,
  canonical_fingerprint text,
  first_published_at timestamptz,
  last_published_at timestamptz,
  item_count integer not null default 0,
  provider_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.osint_document_clusters enable row level security;
revoke all on table public.osint_document_clusters from anon,authenticated;

create table if not exists public.osint_cluster_members(
  cluster_id uuid not null references public.osint_document_clusters(id) on delete cascade,
  semantic_item_id uuid not null references public.osint_semantic_items(id) on delete cascade,
  similarity_score real not null check(similarity_score between 0 and 1),
  joined_at timestamptz not null default now(),
  primary key(cluster_id,semantic_item_id),
  unique(semantic_item_id)
);
alter table public.osint_cluster_members enable row level security;
revoke all on table public.osint_cluster_members from anon,authenticated;
create index if not exists osint_cluster_members_item_idx on public.osint_cluster_members(semantic_item_id);

create table if not exists public.osint_claim_divergences(
  id uuid primary key default gen_random_uuid(),
  fire_event_id uuid not null references public.fire_events(id) on delete cascade,
  claim_type text not null,
  item_a uuid not null references public.osint_semantic_items(id) on delete cascade,
  item_b uuid not null references public.osint_semantic_items(id) on delete cascade,
  value_a double precision,
  value_b double precision,
  delta double precision,
  status text not null default 'unresolved' check(status in ('unresolved','temporal_update','resolved','not_comparable')),
  explanation text not null,
  detected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(fire_event_id,claim_type,item_a,item_b)
);
alter table public.osint_claim_divergences enable row level security;
revoke all on table public.osint_claim_divergences from anon,authenticated;

do $$
begin
  if to_regprocedure('public.firewatch_deep_osint_stage401(text)') is null
     and to_regprocedure('public.firewatch_deep_osint(text)') is not null then
    alter function public.firewatch_deep_osint(text) rename to firewatch_deep_osint_stage401;
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.firewatch_deep_osint(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d jsonb; s jsonb; g jsonb;
begin
  d:=public.firewatch_deep_osint_stage401(p_query);
  if d is null then return null; end if;
  s:=public.firewatch_semantic_osint(p_query);
  g:=public.firewatch_osint_evidence_graph(p_query);
  return d
    || jsonb_build_object('semantic',coalesce(s,jsonb_build_object('summary',jsonb_build_object('items',0))))
    || jsonb_build_object('evidence_graph',coalesce(g,jsonb_build_object('nodes','[]'::jsonb,'edges','[]'::jsonb)));
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_osint_evidence_graph(p_query text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_event uuid; nodes jsonb; edges jsonb;
begin
  if nullif(trim(p_query),'') is null then
    select id into v_event from public.fire_events order by last_seen desc limit 1;
  else
    select id into v_event from public.fire_events
    where lower(id::text) like lower(trim(p_query))||'%'
    order by last_seen desc limit 1;
  end if;
  if v_event is null then return null; end if;

  with itemset as (
    select s.*,cm.cluster_id
    from public.osint_semantic_items s
    left join public.osint_cluster_members cm on cm.semantic_item_id=s.id
    where s.fire_event_id=v_event
    order by s.published_at desc nulls last
    limit 60
  ),
  entityset as (
    select en.entity_type,en.canonical,count(*) mentions,count(distinct i.provider) providers
    from public.osint_entities en join itemset i on i.id=en.semantic_item_id
    group by en.entity_type,en.canonical
    order by providers desc,mentions desc
    limit 60
  ),
  claimset as (
    select c.claim_type,c.object_text,c.numeric_value,c.unit,count(*) mentions,count(distinct i.provider) providers
    from public.osint_claims c join itemset i on i.id=c.semantic_item_id
    where c.claim_type<>'semantic_geo_status'
    group by c.claim_type,c.object_text,c.numeric_value,c.unit
    order by providers desc,mentions desc
    limit 60
  ),
  clusters as (
    select distinct dc.id,dc.item_count,dc.provider_count,dc.first_published_at,dc.last_published_at
    from public.osint_document_clusters dc
    join itemset i on i.cluster_id=dc.id
  ),
  allnodes as (
    select jsonb_build_object('id','event:'||v_event::text,'type','event','label',left(v_event::text,8)) node
    union all
    select jsonb_build_object('id','item:'||id::text,'type','document','label',left(title,180),'source',source_name,'provider',provider,'published_at',published_at) from itemset
    union all
    select jsonb_build_object('id','cluster:'||id::text,'type','cluster','label','cluster ('||item_count||')','item_count',item_count,'provider_count',provider_count) from clusters
    union all
    select jsonb_build_object('id','entity:'||md5(entity_type||'|'||canonical),'type','entity','entity_type',entity_type,'label',canonical,'mentions',mentions,'providers',providers) from entityset
    union all
    select jsonb_build_object('id','claim:'||md5(claim_type||'|'||coalesce(object_text,'')||'|'||coalesce(numeric_value::text,'')),'type','claim','claim_type',claim_type,'label',coalesce(object_text,numeric_value::text),'value',numeric_value,'unit',unit,'mentions',mentions,'providers',providers) from claimset
  ),
  alledges as (
    select jsonb_build_object('from','item:'||i.id::text,'to','event:'||v_event::text,'relation','linked_to') edge from itemset i
    union all
    select jsonb_build_object('from','item:'||i.id::text,'to','cluster:'||i.cluster_id::text,'relation','member_of') from itemset i where i.cluster_id is not null
    union all
    select jsonb_build_object('from','item:'||i.id::text,'to','entity:'||md5(en.entity_type||'|'||en.canonical),'relation','mentions')
    from itemset i join public.osint_entities en on en.semantic_item_id=i.id
    union all
    select jsonb_build_object('from','item:'||i.id::text,'to','claim:'||md5(c.claim_type||'|'||coalesce(c.object_text,'')||'|'||coalesce(c.numeric_value::text,'')),'relation','asserts')
    from itemset i join public.osint_claims c on c.semantic_item_id=i.id where c.claim_type<>'semantic_geo_status'
  )
  select coalesce(jsonb_agg(node),'[]'::jsonb) into nodes from allnodes;

  with itemset as (
    select s.*,cm.cluster_id
    from public.osint_semantic_items s
    left join public.osint_cluster_members cm on cm.semantic_item_id=s.id
    where s.fire_event_id=v_event
    order by s.published_at desc nulls last
    limit 60
  ),
  alledges as (
    select jsonb_build_object('from','item:'||i.id::text,'to','event:'||v_event::text,'relation','linked_to') edge from itemset i
    union all
    select jsonb_build_object('from','item:'||i.id::text,'to','cluster:'||i.cluster_id::text,'relation','member_of') from itemset i where i.cluster_id is not null
    union all
    select jsonb_build_object('from','item:'||i.id::text,'to','entity:'||md5(en.entity_type||'|'||en.canonical),'relation','mentions')
    from itemset i join public.osint_entities en on en.semantic_item_id=i.id
    union all
    select jsonb_build_object('from','item:'||i.id::text,'to','claim:'||md5(c.claim_type||'|'||coalesce(c.object_text,'')||'|'||coalesce(c.numeric_value::text,'')),'relation','asserts')
    from itemset i join public.osint_claims c on c.semantic_item_id=i.id where c.claim_type<>'semantic_geo_status'
  )
  select coalesce(jsonb_agg(edge),'[]'::jsonb) into edges from alledges;

  return jsonb_build_object(
    'event_id',v_event,
    'nodes',nodes,
    'edges',edges,
    'stats',jsonb_build_object('nodes',jsonb_array_length(nodes),'edges',jsonb_array_length(edges)),
    'policy','Graph edges represent extracted/document relationships, not causal relationships.'
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


CREATE OR REPLACE FUNCTION public.osint_refresh_divergences(p_event uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n integer:=0;
begin
  delete from public.osint_claim_divergences where fire_event_id=p_event and status='unresolved';

  insert into public.osint_claim_divergences(fire_event_id,claim_type,item_a,item_b,value_a,value_b,delta,status,explanation)
  select p_event,a.claim_type,a.semantic_item_id,b.semantic_item_id,a.numeric_value,b.numeric_value,
         abs(a.numeric_value-b.numeric_value),'unresolved',
         'Different numeric values reported by separate semantic items. This may be a temporal update rather than a factual contradiction.'
  from public.osint_claims a
  join public.osint_semantic_items ia on ia.id=a.semantic_item_id and ia.fire_event_id=p_event
  join public.osint_claims b on b.claim_type=a.claim_type and b.semantic_item_id>a.semantic_item_id
  join public.osint_semantic_items ib on ib.id=b.semantic_item_id and ib.fire_event_id=p_event
  where a.claim_type in ('casualties_killed','casualties_injured')
    and a.numeric_value is not null and b.numeric_value is not null
    and a.numeric_value<>b.numeric_value
    and coalesce(ia.provider,ia.source_name)<>coalesce(ib.provider,ib.source_name)
    and abs(extract(epoch from (coalesce(ia.published_at,ia.processed_at)-coalesce(ib.published_at,ib.processed_at))))<=48*3600
  on conflict do nothing;

  get diagnostics n=row_count;
  return jsonb_build_object('ok',true,'event',p_event,'divergences',n);
end;
$function$
;


CREATE OR REPLACE FUNCTION public.osint_semantic_assign_cluster(p_item uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare i public.osint_semantic_items%rowtype; c uuid; sim real;
begin
  select * into i from public.osint_semantic_items where id=p_item;
  if not found then return null; end if;

  select m.cluster_id, similarity(i.normalized_text,r.normalized_text)
  into c,sim
  from public.osint_cluster_members m
  join public.osint_semantic_items r on r.id=(
    select dc.representative_item_id from public.osint_document_clusters dc where dc.id=m.cluster_id
  )
  where r.id is not null
    and abs(extract(epoch from (coalesce(i.published_at,i.processed_at)-coalesce(r.published_at,r.processed_at))))<=72*3600
    and similarity(i.normalized_text,r.normalized_text)>=0.72
  order by similarity(i.normalized_text,r.normalized_text) desc
  limit 1;

  if c is null then
    insert into public.osint_document_clusters(representative_item_id,canonical_fingerprint,first_published_at,last_published_at,item_count,provider_count)
    values(p_item,i.fingerprint,i.published_at,i.published_at,1,1)
    returning id into c;
    sim:=1;
  end if;

  insert into public.osint_cluster_members(cluster_id,semantic_item_id,similarity_score)
  values(c,p_item,coalesce(sim,1))
  on conflict(semantic_item_id) do update set cluster_id=excluded.cluster_id,similarity_score=excluded.similarity_score,joined_at=now();

  update public.osint_document_clusters dc
  set first_published_at=x.min_at,last_published_at=x.max_at,item_count=x.item_count,provider_count=x.provider_count,updated_at=now()
  from (
    select m.cluster_id,min(s.published_at) min_at,max(s.published_at) max_at,count(*) item_count,count(distinct s.provider) provider_count
    from public.osint_cluster_members m join public.osint_semantic_items s on s.id=m.semantic_item_id
    where m.cluster_id=c group by m.cluster_id
  ) x
  where dc.id=x.cluster_id;

  return c;
end;
$function$
;



revoke all on function public.osint_semantic_assign_cluster(uuid) from public,anon,authenticated;
grant execute on function public.osint_semantic_assign_cluster(uuid) to service_role;
revoke all on function public.osint_refresh_divergences(uuid) from public,anon,authenticated;
grant execute on function public.osint_refresh_divergences(uuid) to service_role;
revoke all on function public.firewatch_semantic_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_semantic_osint(text) to service_role;
revoke all on function public.firewatch_osint_evidence_graph(text) from public,anon,authenticated;
grant execute on function public.firewatch_osint_evidence_graph(text) to service_role;
revoke all on function public.firewatch_deep_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint(text) to service_role;
revoke all on function public.firewatch_deep_osint_stage401(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint_stage401(text) to service_role;

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='firewatch-osint-semantic';
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule(
    'firewatch-osint-semantic','18,48 * * * *',
    $cron$
      select net.http_post(
        url := 'https://swvpqroxbsrmxdmedojd.supabase.co/functions/v1/firewatch-osint-semantic',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='firewatch_cron_secret' limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 90000
      );
    $cron$
  );
end $$;
