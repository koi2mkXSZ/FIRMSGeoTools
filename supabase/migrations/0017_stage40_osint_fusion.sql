-- Stage 40 — Deep OSINT Fusion Core
-- 2026-09-24
-- Normalized source catalog, documents, explainable event links and deep-OSINT RPC.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.osint_source_catalog (
  source_key text primary key,
  label text not null,
  provider text not null,
  source_class text not null,
  transport text not null,
  homepage text,
  geographic_scope text,
  content_scope text,
  enabled boolean not null default true,
  requires_secret boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.osint_source_catalog enable row level security;
revoke all on table public.osint_source_catalog from anon,authenticated;

create table if not exists public.osint_documents (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.osint_source_catalog(source_key) on update cascade,
  external_id text not null,
  published_at timestamptz,
  source_updated_at timestamptz,
  title text not null,
  summary text,
  url text,
  language text,
  country_codes text[] not null default '{}'::text[],
  location extensions.geography(Point,4326),
  payload jsonb not null default '{}'::jsonb,
  content_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(source_key,external_id)
);
alter table public.osint_documents enable row level security;
revoke all on table public.osint_documents from anon,authenticated;

create table if not exists public.osint_event_links (
  document_id uuid not null references public.osint_documents(id) on delete cascade,
  fire_event_id uuid not null references public.fire_events(id) on delete cascade,
  distance_m double precision,
  time_delta_seconds double precision,
  text_score smallint not null default 0 check(text_score between 0 and 100),
  geo_score smallint not null default 0 check(geo_score between 0 and 100),
  time_score smallint not null default 0 check(time_score between 0 and 100),
  relevance_score smallint not null default 0 check(relevance_score between 0 and 100),
  match_basis jsonb not null default '{}'::jsonb,
  first_linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(document_id,fire_event_id)
);
alter table public.osint_event_links enable row level security;
revoke all on table public.osint_event_links from anon,authenticated;

create index if not exists osint_documents_published_idx on public.osint_documents(published_at desc);
create index if not exists osint_documents_source_idx on public.osint_documents(source_key,published_at desc);
create index if not exists osint_documents_location_gix on public.osint_documents using gist(location);
create index if not exists osint_documents_title_trgm on public.osint_documents using gin(title extensions.gin_trgm_ops);
create index if not exists osint_event_links_event_idx on public.osint_event_links(fire_event_id,relevance_score desc);
create index if not exists osint_event_links_doc_idx on public.osint_event_links(document_id);

insert into public.osint_source_catalog(source_key,label,provider,source_class,transport,homepage,geographic_scope,content_scope,enabled,requires_secret,notes)
values
 ('GDACS','GDACS','UN / European Commission','curated_multisource','JSON API','https://www.gdacs.org','global','disaster alerts and event metadata',true,false,'Existing GeoWatch source'),
 ('NASA_EONET','NASA EONET','NASA','curated_multisource','JSON API','https://eonet.gsfc.nasa.gov','global','natural events and source references',true,false,'Existing GeoWatch source'),
 ('COPERNICUS_EMS','Copernicus EMS Rapid Mapping','European Commission / Copernicus','official_mapping','JSON API','https://mapping.emergency.copernicus.eu','global','emergency mapping activations and products',true,false,'Existing GeoWatch source'),
 ('USGS_EQ','USGS Earthquake Catalog','US Geological Survey','official_sensor','FDSN/GeoJSON API','https://earthquake.usgs.gov','global','earthquake events with coordinates and magnitude',true,false,'Stage 40 new source'),
 ('RELIEFWEB','ReliefWeb','UN OCHA','curated_reports','JSON API','https://reliefweb.int','global','curated humanitarian reports and disaster metadata',true,true,'Requires pre-approved ReliefWeb appname'),
 ('UA_DSNS_OPEN_DATA','Ukraine DSNS/MIA Open Data','Ministry of Internal Affairs / DSNS Ukraine','official_open_data','CKAN API','https://data.gov.ua','Ukraine','operational emergency dataset metadata/resources',true,false,'Stage 40 official open-data source')
on conflict(source_key) do update set
 label=excluded.label,provider=excluded.provider,source_class=excluded.source_class,
 transport=excluded.transport,homepage=excluded.homepage,geographic_scope=excluded.geographic_scope,
 content_scope=excluded.content_scope,enabled=excluded.enabled,requires_secret=excluded.requires_secret,
 notes=excluded.notes,updated_at=now();

create or replace function public.upsert_osint_document(
  p_source_key text,p_external_id text,p_published_at timestamptz,p_source_updated_at timestamptz,
  p_title text,p_summary text,p_url text,p_language text,p_country_codes text[],
  p_lat double precision,p_lon double precision,p_payload jsonb
) returns uuid
language plpgsql security definer
set search_path='public','extensions','pg_temp'
as $$
declare v_id uuid; v_hash text;
begin
  if not exists(select 1 from public.osint_source_catalog where source_key=p_source_key and enabled) then
    raise exception 'unknown or disabled source %',p_source_key;
  end if;
  if nullif(trim(p_external_id),'') is null or nullif(trim(p_title),'') is null then
    raise exception 'external_id and title are required';
  end if;

  v_hash:=encode(extensions.digest(
    coalesce(p_source_key,'')||'|'||coalesce(p_external_id,'')||'|'||
    coalesce(p_title,'')||'|'||coalesce(p_summary,'')||'|'||coalesce(p_url,''),
    'sha256'
  ),'hex');

  insert into public.osint_documents(
    source_key,external_id,published_at,source_updated_at,title,summary,url,language,
    country_codes,location,payload,content_hash,last_seen_at
  ) values(
    p_source_key,trim(p_external_id),p_published_at,p_source_updated_at,trim(p_title),
    nullif(trim(coalesce(p_summary,'')),''),p_url,p_language,coalesce(p_country_codes,'{}'::text[]),
    case when p_lat is null or p_lon is null then null
         else extensions.st_setsrid(extensions.st_makepoint(p_lon,p_lat),4326)::extensions.geography end,
    coalesce(p_payload,'{}'::jsonb),v_hash,now()
  )
  on conflict(source_key,external_id) do update set
    published_at=coalesce(excluded.published_at,public.osint_documents.published_at),
    source_updated_at=coalesce(excluded.source_updated_at,public.osint_documents.source_updated_at),
    title=excluded.title,summary=excluded.summary,url=excluded.url,language=excluded.language,
    country_codes=excluded.country_codes,location=coalesce(excluded.location,public.osint_documents.location),
    payload=excluded.payload,content_hash=excluded.content_hash,last_seen_at=now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.upsert_osint_document(text,text,timestamptz,timestamptz,text,text,text,text,text[],double precision,double precision,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_osint_document(text,text,timestamptz,timestamptz,text,text,text,text,text[],double precision,double precision,jsonb) to service_role;

create or replace function public.firewatch_link_osint_document(p_document uuid)
returns jsonb
language plpgsql security definer
set search_path='public','extensions','pg_temp'
as $$
declare
  d public.osint_documents%rowtype; r record; v_links integer:=0;
  v_max_dist double precision; v_max_time double precision;
begin
  select * into d from public.osint_documents where id=p_document;
  if not found then return jsonb_build_object('ok',false,'error','document_not_found'); end if;

  if d.source_key='USGS_EQ' then
    v_max_dist:=25000; v_max_time:=12*3600;
  elsif d.source_key in ('GDACS','NASA_EONET','COPERNICUS_EMS') then
    v_max_dist:=100000; v_max_time:=72*3600;
  else
    v_max_dist:=75000; v_max_time:=72*3600;
  end if;

  delete from public.osint_event_links where document_id=p_document;

  for r in
    with candidates as (
      select e.id,e.last_seen,e.first_seen,e.nearest_place_name,o.name_uk oblast,
             coalesce(e.best_location,e.last_location,e.first_location) event_location,
             abs(extract(epoch from (coalesce(d.published_at,d.source_updated_at,d.first_seen_at)-e.last_seen))) td,
             case when d.location is not null and coalesce(e.best_location,e.last_location,e.first_location) is not null
               then extensions.st_distance(d.location,coalesce(e.best_location,e.last_location,e.first_location)) end dist,
             lower(coalesce(d.title,'')||' '||coalesce(d.summary,'')) body
      from public.fire_events e
      left join public.oblasts o on o.id=e.oblast_id
      where e.last_seen between coalesce(d.published_at,d.source_updated_at,d.first_seen_at)-make_interval(secs=>v_max_time)
                            and coalesce(d.published_at,d.source_updated_at,d.first_seen_at)+make_interval(secs=>v_max_time)
    ), scored as (
      select *,
        case
          when dist is null then 0
          when d.source_key='USGS_EQ' and dist<=5000 then 55
          when d.source_key='USGS_EQ' and dist<=15000 then 40
          when d.source_key='USGS_EQ' and dist<=25000 then 25
          when d.source_key<>'USGS_EQ' and dist<=5000 then 50
          when d.source_key<>'USGS_EQ' and dist<=25000 then 40
          when d.source_key<>'USGS_EQ' and dist<=50000 then 30
          when d.source_key<>'USGS_EQ' and dist<=v_max_dist then 15
          else 0 end geo,
        case
          when d.source_key='USGS_EQ' and td<=3600 then 35
          when d.source_key='USGS_EQ' and td<=3*3600 then 25
          when d.source_key='USGS_EQ' and td<=12*3600 then 10
          when d.source_key<>'USGS_EQ' and td<=3*3600 then 30
          when d.source_key<>'USGS_EQ' and td<=12*3600 then 24
          when d.source_key<>'USGS_EQ' and td<=24*3600 then 18
          when d.source_key<>'USGS_EQ' and td<=72*3600 then 10
          else 0 end tim,
        least(50,
          (case when nearest_place_name is not null and body like '%'||lower(nearest_place_name)||'%' then 35 else 0 end)+
          (case when oblast is not null and body like '%'||lower(replace(oblast,'ська',''))||'%' then 20 else 0 end)
        ) txt
      from candidates
    )
    select *,least(100,geo+tim+txt) rel
    from scored
    where
      (d.location is not null and dist<=v_max_dist and td<=v_max_time and
        ((d.source_key='USGS_EQ' and geo+tim>=50) or (d.source_key<>'USGS_EQ' and geo+tim>=30)))
      or
      (d.location is null and txt>=20 and tim>=10)
    order by rel desc,td asc
    limit case when d.source_key='USGS_EQ' then 5 else 25 end
  loop
    insert into public.osint_event_links(
      document_id,fire_event_id,distance_m,time_delta_seconds,text_score,geo_score,time_score,
      relevance_score,match_basis,updated_at
    ) values(
      p_document,r.id,r.dist,r.td,r.txt,r.geo,r.tim,r.rel,
      jsonb_build_object(
        'source_key',d.source_key,'max_distance_m',v_max_dist,'max_time_seconds',v_max_time,
        'has_document_location',d.location is not null,
        'nearest_place_match',case when r.nearest_place_name is null then false else r.body like '%'||lower(r.nearest_place_name)||'%' end,
        'oblast_match',case when r.oblast is null then false else r.body like '%'||lower(replace(r.oblast,'ська',''))||'%' end
      ),now()
    );
    v_links:=v_links+1;
  end loop;

  return jsonb_build_object('ok',true,'document_id',p_document,'source_key',d.source_key,'links',v_links);
end;
$$;
revoke all on function public.firewatch_link_osint_document(uuid) from public,anon,authenticated;
grant execute on function public.firewatch_link_osint_document(uuid) to service_role;

create or replace function public.firewatch_deep_osint(p_query text default null)
returns jsonb
language plpgsql security definer
set search_path='public','pg_temp'
as $$
declare
  v_event uuid; e public.fire_events%rowtype; v_rows jsonb; v_sources jsonb; v_summary jsonb;
  v_provider_count integer:=0; v_class_count integer:=0; v_corroboration text:='none';
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
           d.published_at observed_at,d.title,d.summary,d.url,l.relevance_score,l.distance_m,
           l.time_delta_seconds,l.match_basis,'fusion'::text channel
    from public.osint_event_links l
    join public.osint_documents d on d.id=l.document_id
    join public.osint_source_catalog s on s.source_key=d.source_key
    where l.fire_event_id=v_event
    union all
    select p.source_name,p.source_name,p.source_name,p.source_kind,p.source_item_id,
           p.published_at,p.title,null::text,p.source_url,p.relevance_score,null::double precision,
           case when p.published_at is null then null else extract(epoch from (p.published_at-e.last_seen)) end,
           p.match_basis,'public_osint'
    from public.event_public_osint p where p.fire_event_id=v_event
    union all
    select x.source,x.source,x.source,'legacy_external',x.source_event_id,x.observed_at,x.title,
           null::text,x.source_url,
           greatest(0,least(100,case when x.correlation_class in ('very_close','strong','high') then 80
             when x.correlation_class in ('close','moderate','medium') then 60
             when x.correlation_class is not null then 40 else 30 end))::int,
           x.distance_m,case when x.time_delta_minutes is null then null else x.time_delta_minutes*60 end,
           jsonb_build_object('correlation_class',x.correlation_class),'legacy_osint'
    from public.osint_evidence x where x.fire_event_id=v_event
  ), ranked as (
    select * from fusion order by relevance_score desc nulls last,observed_at desc nulls last
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by relevance_score desc nulls last,observed_at desc nulls last),'[]'::jsonb)
  into v_rows from (select * from ranked limit 75) r;

  with strong as (
    select distinct s.provider,s.source_class
    from public.osint_event_links l
    join public.osint_documents d on d.id=l.document_id
    join public.osint_source_catalog s on s.source_key=d.source_key
    where l.fire_event_id=v_event and l.relevance_score>=50
  )
  select count(distinct provider),count(distinct source_class)
  into v_provider_count,v_class_count from strong;

  v_corroboration:=case when v_provider_count>=3 and v_class_count>=2 then 'multi-provider'
    when v_provider_count>=2 then 'two-provider'
    when v_provider_count=1 then 'single-provider' else 'none' end;

  with allsrc as (
    select d.source_key source,s.label,s.provider,s.source_class,
           max(l.relevance_score) max_relevance,count(*) evidence_count
    from public.osint_event_links l
    join public.osint_documents d on d.id=l.document_id
    join public.osint_source_catalog s on s.source_key=d.source_key
    where l.fire_event_id=v_event
    group by d.source_key,s.label,s.provider,s.source_class
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by max_relevance desc,label),'[]'::jsonb)
  into v_sources from allsrc x;

  select jsonb_build_object(
    'fusion_documents',(select count(*) from public.osint_event_links where fire_event_id=v_event),
    'fusion_sources',(select count(distinct d.source_key) from public.osint_event_links l
                      join public.osint_documents d on d.id=l.document_id where l.fire_event_id=v_event),
    'strong_independent_providers',v_provider_count,'strong_source_classes',v_class_count,
    'corroboration_level',v_corroboration,
    'high_relevance',(select count(*) from public.osint_event_links where fire_event_id=v_event and relevance_score>=60),
    'public_osint',(select count(*) from public.event_public_osint where fire_event_id=v_event),
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
    'summary',v_summary,'sources',v_sources,'timeline',v_rows,
    'policy','OSINT correlation is contextual. Spatial, temporal or textual proximity does not establish causation or attribution.'
  );
end;
$$;
revoke all on function public.firewatch_deep_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint(text) to service_role;

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='firewatch-osint-fusion';
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule(
    'firewatch-osint-fusion',
    '10,40 * * * *',
    $cron$
      select net.http_post(
        url := 'https://swvpqroxbsrmxdmedojd.supabase.co/functions/v1/firewatch-osint-fusion',
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
