-- Stage 42.2 — Entity Intelligence Profiles
-- 2026-09-24

create table if not exists public.area_entity_profiles(
  entity_id uuid primary key references public.area_entities(id) on delete cascade,
  refreshed_at timestamptz not null default now(),
  status text not null default 'active',
  profile jsonb not null default '{}'::jsonb,
  field_provenance jsonb not null default '{}'::jsonb,
  source_status jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.area_entity_profiles enable row level security;
revoke all on table public.area_entity_profiles from anon,authenticated;
create index if not exists area_entity_profiles_refreshed_idx on public.area_entity_profiles(refreshed_at desc);

CREATE OR REPLACE FUNCTION public.firewatch_entity_profile_cached(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare e jsonb; p public.area_entity_profiles%rowtype;
begin
  e:=public.firewatch_resolve_area_entity(p_query);
  if e is null then return null; end if;
  select * into p from public.area_entity_profiles where entity_id=(e->>'id')::uuid;
  if not found then
    return jsonb_build_object('entity',e,'profile_status','not_cached');
  end if;
  return jsonb_build_object(
    'entity',e,'profile_status',p.status,'refreshed_at',p.refreshed_at,
    'profile',p.profile,'field_provenance',p.field_provenance,
    'source_status',p.source_status,'errors',p.errors
  );
end;
$function$
;


CREATE OR REPLACE FUNCTION public.firewatch_resolve_area_entity(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare e record;
begin
  select id,query_key,canonical_name,category,subcategory,latitude,longitude,wikidata_qid,
         source_count,resolution_status,resolution_confidence,aliases,provenance
  into e
  from public.area_entities
  where lower(id::text) like lower(trim(p_query))||'%'
     or lower(coalesce(wikidata_qid,''))=lower(trim(p_query))
  order by
    case when lower(coalesce(wikidata_qid,''))=lower(trim(p_query)) then 0 else 1 end,
    source_count desc,resolution_confidence desc nulls last,updated_at desc
  limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'id',e.id,'query_key',e.query_key,'canonical_name',e.canonical_name,
    'category',e.category,'subcategory',e.subcategory,
    'latitude',e.latitude,'longitude',e.longitude,'wikidata_qid',e.wikidata_qid,
    'source_count',e.source_count,'resolution_status',e.resolution_status,
    'resolution_confidence',e.resolution_confidence,'aliases',e.aliases,
    'sources',coalesce((
      select jsonb_agg(jsonb_build_object(
        'source',s.source,'source_id',s.source_id,'source_name',s.source_name,
        'category',s.category,'subcategory',s.subcategory,
        'latitude',s.latitude,'longitude',s.longitude,'wikidata_qid',s.wikidata_qid,
        'match_method',s.match_method,'match_confidence',s.match_confidence,
        'provenance',s.provenance
      ) order by s.source,s.source_id)
      from public.area_entity_sources s where s.entity_id=e.id
    ),'[]'::jsonb)
  );
end;
$function$
;



revoke all on function public.firewatch_resolve_area_entity(text) from public,anon,authenticated;
grant execute on function public.firewatch_resolve_area_entity(text) to service_role;
revoke all on function public.firewatch_entity_profile_cached(text) from public,anon,authenticated;
grant execute on function public.firewatch_entity_profile_cached(text) to service_role;

update public.osint_source_catalog
set content_scope='named entities, descriptions, aliases, public organization/operator metadata, official websites and coordinate-linked knowledge graph context',
    notes='Stage 42.1/42.2. Used for entity identity and field-level public-source enrichment. Production coordinate discovery uses Wikimedia geosearch; on-demand entity profiles use Wikidata wbgetentities. Descriptive context only; not event corroboration.',
    updated_at=now()
where source_key='WIKIDATA_AREA_INTEL';
