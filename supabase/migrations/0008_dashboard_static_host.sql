-- FIRMSGeoTools Community Edition
-- Stage 8 hotfix: static Dashboard host + signed Edge API.

alter table public.project_config
  add column if not exists dashboard_public_url text;

alter table public.project_config
  drop constraint if exists project_config_dashboard_public_url_check;

alter table public.project_config
  add constraint project_config_dashboard_public_url_check
  check (
    dashboard_public_url is null
    or dashboard_public_url ~ '^https://'
  );

update public.release_metadata
set version='0.8.0-pre',schema_version=8,channel='pre-release',updated_at=now()
where id=true;

insert into public.system_state(key,value,updated_at)
values('dashboard_policy',jsonb_build_object(
  'status','active',
  'version','core-dashboard-v2-static',
  'default_ttl_hours',4,
  'maximum_ttl_hours',12,
  'read_only',true,
  'hosting','static-frontend-plus-supabase-api',
  'auth','HMAC signed URL'
),now())
on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

insert into public.system_state(key,value,updated_at)
values('clean_install_stage',jsonb_build_object('stage',8,'version','core-v0.8','status','acceptance-in-progress'),now())
on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
