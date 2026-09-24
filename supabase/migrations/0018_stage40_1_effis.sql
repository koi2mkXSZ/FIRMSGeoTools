-- Stage 40.1 — Copernicus EFFIS cached enrichment
-- 2026-09-24

alter table public.osint_source_catalog
  add column if not exists independent_for_corroboration boolean not null default true;

insert into public.osint_source_catalog(
  source_key,label,provider,source_class,transport,homepage,geographic_scope,content_scope,
  enabled,requires_secret,independent_for_corroboration,notes
) values
 ('EFFIS_FWI','Copernicus EFFIS Fire Danger','European Commission / JRC','environment_model','OGC WMS','https://forest-fire.emergency.copernicus.eu','Europe/Mediterranean','fire danger / FWI context',true,false,true,'Stage 40.1; query companion mf010.query'),
 ('EFFIS_ACTIVE_FIRE','Copernicus EFFIS Active Fires','European Commission / JRC','derived_satellite','OGC WMS','https://forest-fire.emergency.copernicus.eu','Europe/Mediterranean','active-fire satellite aggregation',true,false,false,'Derived from satellite hotspots; not independent from FIRMS'),
 ('EFFIS_BURNT_AREA','Copernicus EFFIS NRT Burnt Area','European Commission / JRC','derived_satellite','OGC WMS','https://forest-fire.emergency.copernicus.eu','Europe/Mediterranean','NRT burnt-area polygons clustered from VIIRS',true,false,false,'Derived satellite product; contextual evidence')
on conflict(source_key) do update set
 label=excluded.label,provider=excluded.provider,source_class=excluded.source_class,
 transport=excluded.transport,homepage=excluded.homepage,geographic_scope=excluded.geographic_scope,
 content_scope=excluded.content_scope,enabled=excluded.enabled,requires_secret=excluded.requires_secret,
 independent_for_corroboration=excluded.independent_for_corroboration,notes=excluded.notes,updated_at=now();

create table if not exists public.effis_event_cache(
  fire_event_id uuid primary key references public.fire_events(id) on delete cascade,
  queried_at timestamptz not null default now(),
  status text not null default 'pending',
  fwi_value double precision,
  danger_risk text,
  fwi_query_status text,
  active_fire_match boolean not null default false,
  active_fire_count integer not null default 0,
  burnt_area_match boolean not null default false,
  burnt_area_count integer not null default 0,
  raw jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  failure_count integer not null default 0,
  next_retry_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.effis_event_cache enable row level security;
revoke all on table public.effis_event_cache from anon,authenticated;
create index if not exists effis_event_cache_retry_idx on public.effis_event_cache(next_retry_at);
create index if not exists effis_event_cache_status_idx on public.effis_event_cache(status,queried_at desc);

do $$
begin
  if to_regprocedure('public.firewatch_deep_osint_core(text)') is null
     and to_regprocedure('public.firewatch_deep_osint(text)') is not null then
    alter function public.firewatch_deep_osint(text) rename to firewatch_deep_osint_core;
  end if;
end $$;

revoke all on function public.firewatch_deep_osint_core(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint_core(text) to service_role;

create or replace function public.firewatch_deep_osint(p_query text default null)
returns jsonb language plpgsql security definer set search_path='public','pg_temp' as $$
declare d jsonb; v_event uuid; eff jsonb;
begin
  d:=public.firewatch_deep_osint_core(p_query);
  if d is null then return null; end if;
  v_event:=(d->'event'->>'id')::uuid;
  select jsonb_build_object(
    'status',c.status,'queried_at',c.queried_at,'fwi_value',c.fwi_value,'danger_risk',c.danger_risk,
    'fwi_query_status',c.fwi_query_status,'active_fire_match',c.active_fire_match,
    'active_fire_count',c.active_fire_count,'burnt_area_match',c.burnt_area_match,
    'burnt_area_count',c.burnt_area_count,'failure_count',c.failure_count,'next_retry_at',c.next_retry_at,
    'policy','EFFIS active-fire and burnt-area products are derived satellite context and do not count as independent corroboration.'
  ) into eff from public.effis_event_cache c where c.fire_event_id=v_event;
  return d || jsonb_build_object('effis',coalesce(eff,jsonb_build_object('status','not_cached')));
end;
$$;
revoke all on function public.firewatch_deep_osint(text) from public,anon,authenticated;
grant execute on function public.firewatch_deep_osint(text) to service_role;

do $$
declare j bigint;
begin
  select jobid into j from cron.job where jobname='firewatch-effis';
  if j is not null then perform cron.unschedule(j); end if;
  perform cron.schedule(
    'firewatch-effis','29 * * * *',
    $cron$
      select net.http_post(
        url := 'https://swvpqroxbsrmxdmedojd.supabase.co/functions/v1/firewatch-effis',
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
