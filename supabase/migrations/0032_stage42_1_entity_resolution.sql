-- Stage 42.1 — Wikidata + entity resolution + cross-source dedup
-- 2026-09-24

insert into public.osint_source_catalog(
  source_key,label,provider,source_class,transport,homepage,geographic_scope,content_scope,
  enabled,requires_secret,independent_for_corroboration,notes
) values
 ('WIKIDATA_AREA_INTEL','Wikidata Area Intelligence','Wikimedia Foundation / Wikidata','knowledge_graph','Wikimedia geosearch + Wikidata QID','https://www.wikidata.org','global','named entities, descriptions and coordinate-linked knowledge graph context',true,false,false,'Stage 42.1. Production transport uses uk.wikipedia.org geosearch with pageprops.wikibase_item for stable coordinate lookup; WDQS is not on the critical path because of timeout variability. Descriptive context only; not event corroboration.')
on conflict(source_key) do update set
 label=excluded.label,provider=excluded.provider,source_class=excluded.source_class,
 transport=excluded.transport,homepage=excluded.homepage,geographic_scope=excluded.geographic_scope,
 content_scope=excluded.content_scope,enabled=excluded.enabled,requires_secret=excluded.requires_secret,
 independent_for_corroboration=excluded.independent_for_corroboration,notes=excluded.notes,updated_at=now();

alter table public.area_intel_cache
  add column if not exists entity_summary jsonb not null default '{}'::jsonb;

create table if not exists public.area_entities(
  id uuid primary key default gen_random_uuid(),
  query_key text not null references public.area_intel_cache(query_key) on delete cascade,
  resolution_key text not null,
  canonical_name text,
  category text,
  subcategory text,
  latitude double precision,
  longitude double precision,
  wikidata_qid text,
  source_count integer not null default 1,
  resolution_status text not null default 'single_source'
    check (resolution_status in ('single_source','auto_exact','auto_probable','review_needed')),
  resolution_confidence smallint
    check (resolution_confidence is null or resolution_confidence between 0 and 100),
  aliases jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(query_key,resolution_key)
);
alter table public.area_entities enable row level security;
revoke all on table public.area_entities from anon,authenticated;
create index if not exists area_entities_query_idx on public.area_entities(query_key,source_count desc);
create index if not exists area_entities_qid_idx on public.area_entities(wikidata_qid) where wikidata_qid is not null;
create index if not exists area_entities_category_idx on public.area_entities(query_key,category);

create table if not exists public.area_entity_sources(
  id bigserial primary key,
  entity_id uuid not null references public.area_entities(id) on delete cascade,
  query_key text not null references public.area_intel_cache(query_key) on delete cascade,
  source text not null,
  source_id text not null,
  source_name text,
  category text,
  subcategory text,
  latitude double precision,
  longitude double precision,
  wikidata_qid text,
  match_method text not null,
  match_confidence smallint check (match_confidence between 0 and 100),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(query_key,source,source_id)
);
alter table public.area_entity_sources enable row level security;
revoke all on table public.area_entity_sources from anon,authenticated;
create index if not exists area_entity_sources_entity_idx on public.area_entity_sources(entity_id);
create index if not exists area_entity_sources_query_idx on public.area_entity_sources(query_key,source);

create table if not exists public.area_entity_resolution_proposals(
  id bigserial primary key,
  query_key text not null references public.area_intel_cache(query_key) on delete cascade,
  source_a text not null,
  source_id_a text not null,
  source_b text not null,
  source_id_b text not null,
  proposed_relation text not null default 'same_as',
  confidence smallint not null check(confidence between 0 and 100),
  reason jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check(status in ('pending','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(query_key,source_a,source_id_a,source_b,source_id_b,proposed_relation)
);
alter table public.area_entity_resolution_proposals enable row level security;
revoke all on table public.area_entity_resolution_proposals from anon,authenticated;
create index if not exists area_entity_resolution_proposals_query_idx
  on public.area_entity_resolution_proposals(query_key,status,confidence desc);

CREATE OR REPLACE FUNCTION public.firewatch_area_entities(p_lat double precision, p_lon double precision, p_radius_m integer DEFAULT 2000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r integer:=greatest(250,least(coalesce(p_radius_m,2000),10000));
declare k text:=round(p_lat::numeric,5)::text||':'||round(p_lon::numeric,5)::text||':'||r::text;
begin
  return jsonb_build_object(
    'query_key',k,
    'summary',coalesce((select entity_summary from public.area_intel_cache where query_key=k),'{}'::jsonb),
    'entities',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.source_count desc,x.resolution_confidence desc nulls last,x.canonical_name)
      from (
        select e.id,e.canonical_name,e.category,e.subcategory,e.latitude,e.longitude,e.wikidata_qid,
               e.source_count,e.resolution_status,e.resolution_confidence,e.aliases,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'source',s.source,'source_id',s.source_id,'source_name',s.source_name,
                   'wikidata_qid',s.wikidata_qid,'match_method',s.match_method,'match_confidence',s.match_confidence
                 ) order by s.source)
                 from public.area_entity_sources s where s.entity_id=e.id
               ),'[]'::jsonb) sources
        from public.area_entities e
        where e.query_key=k
        order by e.source_count desc,e.resolution_confidence desc nulls last,e.canonical_name
        limit 80
      ) x
    ),'[]'::jsonb),
    'pending_proposals',coalesce((
      select jsonb_agg(to_jsonb(p) order by p.confidence desc,p.id)
      from (
        select id,source_a,source_id_a,source_b,source_id_b,confidence,reason,status
        from public.area_entity_resolution_proposals
        where query_key=k and status='pending'
        order by confidence desc,id
        limit 30
      ) p
    ),'[]'::jsonb),
    'policy','Entity resolution is non-destructive. Exact identifiers auto-merge; ambiguous probable same_as links stay as reviewable proposals.'
  );
end;
$function$
;



revoke all on function public.firewatch_area_entities(double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.firewatch_area_entities(double precision,double precision,integer) to service_role;
