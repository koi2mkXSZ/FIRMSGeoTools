-- FIRMSGeoTools Community Edition
-- Clean Core schema v0.6: self-hosted read-only dashboard access and geography.

do $$
declare v_secret text;
begin
  if not exists(select 1 from vault.secrets where name='firewatch_dashboard_secret') then
    v_secret:=encode(extensions.gen_random_bytes(32),'hex');
    perform vault.create_secret(v_secret,'firewatch_dashboard_secret','FIRMSGeoTools dashboard HMAC secret',null);
  end if;
end $$;

create or replace function public.firewatch_dashboard_secret()
returns text
language sql stable security definer
set search_path=public,vault,pg_temp
as $$
select decrypted_secret
from vault.decrypted_secrets
where name='firewatch_dashboard_secret'
limit 1;
$$;

create or replace function public.firewatch_dashboard_geography()
returns jsonb
language sql stable security definer
set search_path=public,extensions,pg_temp
as $$
select jsonb_build_object(
  'aoi',jsonb_build_object(
    'type','FeatureCollection',
    'features',coalesce((
      select jsonb_agg(jsonb_build_object(
        'type','Feature',
        'properties',jsonb_build_object('id',a.id,'code',a.code,'name',a.name),
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
        'properties',jsonb_build_object('id',r.id,'code',r.code,'name',r.name),
        'geometry',extensions.st_asgeojson(r.geom)::jsonb
      ) order by r.name)
      from public.regions r where r.enabled
    ),'[]'::jsonb)
  )
);
$$;

revoke execute on function public.firewatch_dashboard_secret() from public,anon,authenticated;
revoke execute on function public.firewatch_dashboard_geography() from public,anon,authenticated;
grant execute on function public.firewatch_dashboard_secret() to service_role;
grant execute on function public.firewatch_dashboard_geography() to service_role;

insert into public.system_state(key,value,updated_at)
values('dashboard_policy',jsonb_build_object(
  'status','active',
  'version','core-dashboard-v1',
  'default_ttl_hours',4,
  'maximum_ttl_hours',12,
  'read_only',true,
  'hosting','supabase-edge-function',
  'auth','HMAC signed URL'
),now())
on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

insert into public.system_state(key,value,updated_at)
values('clean_install_stage',jsonb_build_object('stage',6,'version','core-v0.6','status','pre-release'),now())
on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
