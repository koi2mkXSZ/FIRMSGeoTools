-- Stage 42.3 — Registry & Official Sources Fusion
-- 2026-09-24

insert into public.osint_source_catalog(
  source_key,label,provider,source_class,transport,homepage,geographic_scope,content_scope,
  enabled,requires_secret,independent_for_corroboration,notes
) values
 ('DATA_GOV_UA_REGISTRY','Єдиний державний веб-портал відкритих даних','Міністерство цифрової трансформації України / data.gov.ua','official_registry','CKAN Action API','https://data.gov.ua','Ukraine','official datasets, publishers, resource metadata and registry-like open-data references',true,false,false,'Stage 42.3. Official open-data discovery. Search hits remain evidence references until entity match is independently confirmed.'),
 ('GOV_UA_OFFICIAL_WEB','Official Ukrainian government web domains','Ukrainian public authorities','official_web','HTTPS','https://gov.ua','Ukraine','official public authority websites referenced by resolved entities',true,false,false,'Stage 42.3. Confirmed only when an entity profile contains a public URL on the gov.ua domain tree; this confirms the official web reference, not event relevance.')
on conflict(source_key) do update set
 label=excluded.label,provider=excluded.provider,source_class=excluded.source_class,
 transport=excluded.transport,homepage=excluded.homepage,geographic_scope=excluded.geographic_scope,
 content_scope=excluded.content_scope,enabled=excluded.enabled,requires_secret=excluded.requires_secret,
 independent_for_corroboration=excluded.independent_for_corroboration,notes=excluded.notes,updated_at=now();

create table if not exists public.area_entity_registry_hits(
  id bigserial primary key,
  entity_id uuid not null references public.area_entities(id) on delete cascade,
  source_key text not null,
  external_id text not null,
  title text,
  publisher text,
  resource_url text,
  landing_url text,
  updated_external_at timestamptz,
  match_status text not null default 'candidate'
    check(match_status in ('candidate','probable','confirmed','rejected')),
  match_confidence smallint not null default 0 check(match_confidence between 0 and 100),
  match_basis jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(entity_id,source_key,external_id)
);
alter table public.area_entity_registry_hits enable row level security;
revoke all on table public.area_entity_registry_hits from anon,authenticated;
create index if not exists area_entity_registry_hits_entity_idx on public.area_entity_registry_hits(entity_id,match_confidence desc);
create index if not exists area_entity_registry_hits_source_idx on public.area_entity_registry_hits(source_key,last_seen_at desc);

CREATE OR REPLACE FUNCTION public.firewatch_entity_registry_cached(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare e jsonb;
begin
  e:=public.firewatch_resolve_area_entity(p_query);
  if e is null then return null; end if;
  return jsonb_build_object(
    'entity',e,
    'hits',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',h.id,'source_key',h.source_key,'external_id',h.external_id,'title',h.title,
        'publisher',h.publisher,'resource_url',h.resource_url,'landing_url',h.landing_url,
        'updated_external_at',h.updated_external_at,'match_status',h.match_status,
        'match_confidence',h.match_confidence,'match_basis',h.match_basis,'last_seen_at',h.last_seen_at
      ) order by h.match_confidence desc,h.last_seen_at desc)
      from public.area_entity_registry_hits h
      where h.entity_id=(e->>'id')::uuid
    ),'[]'::jsonb)
  );
end;
$function$
;



revoke all on function public.firewatch_entity_registry_cached(text) from public,anon,authenticated;
grant execute on function public.firewatch_entity_registry_cached(text) to service_role;
