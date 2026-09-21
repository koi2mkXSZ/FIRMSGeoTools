-- FIRMSGeoTools v1.0.0 Stable
-- Final release metadata after successful Stage 8 fresh-project acceptance.

update public.release_metadata
set version='1.0.0',
    schema_version=9,
    channel='stable',
    updated_at=now()
where id=true;

insert into public.system_state(key,value,updated_at)
values(
  'clean_install_stage',
  jsonb_build_object(
    'stage',8,
    'version','1.0.0',
    'status','stable',
    'acceptance','passed'
  ),
  now()
)
on conflict(key) do update
set value=excluded.value,
    updated_at=excluded.updated_at;

insert into public.system_state(key,value,updated_at)
values(
  'release_acceptance',
  jsonb_build_object(
    'version','1.0.0',
    'schema_version',9,
    'channel','stable',
    'stage8_passed',true,
    'core_diagnostics','pass',
    'source_coverage','pass',
    'notification_integrity','pass',
    'geo_integrity_missing_in_db',0,
    'telegram_test','pass',
    'admin_webhook','pass',
    'dashboard','pass',
    'recovery_export','pass'
  ),
  now()
)
on conflict(key) do update
set value=excluded.value,
    updated_at=excluded.updated_at;
