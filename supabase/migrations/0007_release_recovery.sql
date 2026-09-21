-- FIRMSGeoTools Community Edition
-- Clean Core schema v0.7: release metadata and portable recovery export.

create table if not exists public.release_metadata(
  id boolean primary key default true check(id),
  version text not null,
  schema_version integer not null,
  channel text not null check(channel in('pre-release','stable')),
  updated_at timestamptz not null default now()
);

insert into public.release_metadata(id,version,schema_version,channel,updated_at)
values(true,'0.7.0-pre',7,'pre-release',now())
on conflict(id) do update set
  version=excluded.version,
  schema_version=excluded.schema_version,
  channel=excluded.channel,
  updated_at=excluded.updated_at;

alter table public.release_metadata enable row level security;
revoke all on public.release_metadata from public,anon,authenticated;
grant select,insert,update,delete on public.release_metadata to service_role;

create or replace function public.firewatch_release_info()
returns jsonb
language sql stable security definer
set search_path=public,pg_temp
as $$
select jsonb_build_object(
  'version',r.version,
  'schema_version',r.schema_version,
  'channel',r.channel,
  'updated_at',r.updated_at,
  'stage',coalesce((select value from public.system_state where key='clean_install_stage'),'{}'::jsonb)
)
from public.release_metadata r where r.id=true;
$$;

create or replace function public.firewatch_recovery_export()
returns jsonb
language sql stable security definer
set search_path=public,extensions,pg_temp
as $$
select jsonb_build_object(
  'format','FIRMSGeoTools-Recovery-v1',
  'exported_at',now(),
  'release',public.firewatch_release_info(),
  'project_config',(
    select to_jsonb(c)-'id'-'created_at'-'updated_at'
    from public.project_config c where c.id=true
  ),
  'sources',coalesce((
    select jsonb_agg(jsonb_build_object(
      'source_id',f.source_id,
      'enabled',f.enabled,
      'resolution_m',f.resolution_m,
      'match_radius_m',f.match_radius_m,
      'display_name',f.display_name,
      'sort_order',f.sort_order
    ) order by f.sort_order,f.source_id)
    from public.firms_sources f
  ),'[]'::jsonb),
  'aoi',jsonb_build_object(
    'type','FeatureCollection',
    'features',coalesce((
      select jsonb_agg(jsonb_build_object(
        'type','Feature',
        'properties',jsonb_build_object('code',a.code,'name',a.name),
        'geometry',extensions.st_asgeojson(a.geom)::jsonb
      ) order by a.id)
      from public.monitoring_areas a where a.enabled
    ),'[]'::jsonb)
  ),
  'regions',jsonb_build_object(
    'type','FeatureCollection',
    'features',coalesce((
      select jsonb_agg(jsonb_build_object(
        'type','Feature',
        'properties',jsonb_build_object(
          'code',r.code,'name',r.name,'source',r.source,'source_id',r.source_id
        ),
        'geometry',extensions.st_asgeojson(r.geom)::jsonb
      ) order by r.name)
      from public.regions r where r.enabled
    ),'[]'::jsonb)
  ),
  'operational_state',jsonb_build_object(
    'bootstrap',coalesce((select value from public.system_state where key='bootstrap'),'{}'::jsonb),
    'dashboard_policy',coalesce((select value from public.system_state where key='dashboard_policy'),'{}'::jsonb)
  ),
  'secret_inventory',jsonb_build_array(
    'FIRMS_MAP_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'INSTALL_TOKEN',
    'TELEGRAM_ADMIN_CHAT_ID',
    'TELEGRAM_ADMIN_WEBHOOK_SECRET',
    'firewatch_cron_secret (Vault, auto-generated)',
    'firewatch_dashboard_secret (Vault, auto-generated)'
  ),
  'secrets_included',false
);
$$;

revoke execute on function public.firewatch_release_info() from public,anon,authenticated;
revoke execute on function public.firewatch_recovery_export() from public,anon,authenticated;
grant execute on function public.firewatch_release_info() to service_role;
grant execute on function public.firewatch_recovery_export() to service_role;

insert into public.system_state(key,value,updated_at)
values('clean_install_stage',jsonb_build_object('stage',7,'version','core-v0.7','status','pre-release'),now())
on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
