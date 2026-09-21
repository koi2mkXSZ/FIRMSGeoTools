-- FIRMSGeoTools Community Edition
-- Clean Core schema v0.3: diagnostics and acceptance checks.

create or replace function public.firewatch_core_diagnostics()
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_catalog,cron,vault,pg_temp
as $$
declare
  v_checks jsonb:='[]'::jsonb;
  v_fail integer:=0;
  v_warn integer:=0;
  v_pass integer:=0;
  v_aoi integer:=0;
  v_regions integer:=0;
  v_invalid_aoi integer:=0;
  v_invalid_regions integer:=0;
  v_sources integer:=0;
  v_cron integer:=0;
  v_cron_active integer:=0;
  v_rls_missing integer:=0;
  v_outside integer:=0;
  v_orphans integer:=0;
  v_pending integer:=0;
  v_bootstrap boolean:=false;
  v_monitor jsonb:='{}'::jsonb;
  v_telegram jsonb:='{}'::jsonb;
  v_runtime jsonb:='{}'::jsonb;
  v_cron_secret boolean:=false;
begin
  select count(*) into v_aoi from public.monitoring_areas where enabled;
  select count(*) into v_regions from public.regions where enabled;
  select count(*) into v_invalid_aoi from public.monitoring_areas where enabled and not extensions.st_isvalid(geom);
  select count(*) into v_invalid_regions from public.regions where enabled and not extensions.st_isvalid(geom);
  select count(*) into v_sources from public.firms_sources where enabled;
  select count(*) into v_cron from cron.job where jobname in('firmsgeotools-firms','firmsgeotools-telegram','firmsgeotools-lifecycle');
  select count(*) into v_cron_active from cron.job where jobname in('firmsgeotools-firms','firmsgeotools-telegram','firmsgeotools-lifecycle') and active;
  select exists(select 1 from vault.secrets where name='firewatch_cron_secret') into v_cron_secret;

  select count(*) into v_rls_missing
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname in('project_config','monitoring_areas','regions','fire_events','detections','system_state','firms_sources','telegram_delivery_lease')
    and not c.relrowsecurity;

  select count(*) into v_outside
  from public.detections d
  where not public.firewatch_point_in_aoi(d.latitude,d.longitude);

  select count(*) into v_orphans
  from public.detections d
  where d.event_id is null;

  select count(*) into v_pending
  from public.fire_events
  where notification_required=true and telegram_sent=false;

  select coalesce((value->>'done')::boolean,false)
  into v_bootstrap
  from public.system_state where key='bootstrap';

  select coalesce(value,'{}'::jsonb) into v_monitor
  from public.system_state where key='monitor_firms';

  select coalesce(value,'{}'::jsonb) into v_telegram
  from public.system_state where key='monitor_telegram';

  v_runtime:=public.firewatch_runtime_config();

  -- helper pattern repeated explicitly for portability.
  if v_aoi>0 and v_invalid_aoi=0 and v_runtime->'bbox' is not null then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','geography','status','pass','message',format('%s enabled AOI feature(s), valid bbox',v_aoi)));
    v_pass:=v_pass+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','geography','status','fail','message','AOI missing, invalid, or bbox unavailable','fix','Run setup with a valid EPSG:4326 Polygon/MultiPolygon GeoJSON.'));
    v_fail:=v_fail+1;
  end if;

  if v_invalid_regions=0 then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','regions','status','pass','message',format('%s enabled region feature(s); all valid',v_regions)));
    v_pass:=v_pass+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','regions','status','fail','message',format('%s invalid region geometries',v_invalid_regions),'fix','Repair regions GeoJSON and rerun setup.'));
    v_fail:=v_fail+1;
  end if;

  if v_sources>0 then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','sources','status','pass','message',format('%s FIRMS source(s) enabled',v_sources)));
    v_pass:=v_pass+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','sources','status','fail','message','No FIRMS sources enabled','fix','Enable at least one source in monitoring.json and rerun setup.'));
    v_fail:=v_fail+1;
  end if;

  if v_cron=3 and v_cron_active=3 and v_cron_secret then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','cron','status','pass','message','3/3 Core cron jobs active; cron secret present'));
    v_pass:=v_pass+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','cron','status','fail','message',format('Core cron jobs: %s total / %s active; secret=%s',v_cron,v_cron_active,v_cron_secret),'fix','Rerun firewatch-setup after migrations are applied.'));
    v_fail:=v_fail+1;
  end if;

  if v_rls_missing=0 then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','rls','status','pass','message','RLS enabled on all Core tables'));
    v_pass:=v_pass+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','rls','status','fail','message',format('RLS missing on %s Core table(s)',v_rls_missing),'fix','Reapply Core migrations.'));
    v_fail:=v_fail+1;
  end if;

  if v_outside=0 then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','aoi_integrity','status','pass','message','No stored detections outside configured AOI'));
    v_pass:=v_pass+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','aoi_integrity','status','fail','message',format('%s stored detection(s) are outside current AOI',v_outside),'fix','Check whether AOI was changed after ingestion. Do not delete data automatically.'));
    v_fail:=v_fail+1;
  end if;

  if v_orphans=0 then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','event_integrity','status','pass','message','All detections are linked to events'));
    v_pass:=v_pass+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','event_integrity','status','fail','message',format('%s detection(s) have no event',v_orphans),'fix','Inspect ingestion errors before continuing.'));
    v_fail:=v_fail+1;
  end if;

  if v_bootstrap then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','bootstrap','status','pass','message','Initial FIRMS bootstrap completed'));
    v_pass:=v_pass+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','bootstrap','status','warn','message','Bootstrap has not completed yet','fix','Wait for the first successful FIRMS cron run or invoke the FIRMS worker once.'));
    v_warn:=v_warn+1;
  end if;

  if nullif(v_monitor->>'last_success_run','') is not null then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','firms_worker','status','pass','message','FIRMS worker has completed successfully','last_success_run',v_monitor->>'last_success_run'));
    v_pass:=v_pass+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','firms_worker','status','warn','message','No successful FIRMS worker run recorded yet','fix','Wait for cron or invoke firewatch-firms after setup.'));
    v_warn:=v_warn+1;
  end if;

  if nullif(v_telegram->>'last_success_run','') is not null then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','telegram_worker','status','pass','message','Telegram worker has completed successfully','last_success_run',v_telegram->>'last_success_run'));
    v_pass:=v_pass+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','telegram_worker','status','warn','message','No successful Telegram worker run recorded yet','fix','External doctor checks the bot credentials; worker state appears after cron executes.'));
    v_warn:=v_warn+1;
  end if;

  if v_pending>100 then
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','telegram_backlog','status','warn','message',format('%s events are pending Telegram delivery',v_pending),'fix','Check Telegram credentials and worker state.'));
    v_warn:=v_warn+1;
  else
    v_checks:=v_checks||jsonb_build_array(jsonb_build_object('id','telegram_backlog','status','pass','message',format('%s event(s) pending Telegram delivery',v_pending)));
    v_pass:=v_pass+1;
  end if;

  return jsonb_build_object(
    'status',case when v_fail>0 then 'fail' when v_warn>0 then 'warn' else 'pass' end,
    'summary',jsonb_build_object('pass',v_pass,'warn',v_warn,'fail',v_fail),
    'generated_at',now(),
    'runtime',v_runtime,
    'counts',jsonb_build_object(
      'aoi_features',v_aoi,'regions',v_regions,'enabled_sources',v_sources,
      'pending_telegram',v_pending,'outside_aoi_detections',v_outside,'orphan_detections',v_orphans
    ),
    'checks',v_checks
  );
end;
$$;

revoke execute on function public.firewatch_core_diagnostics() from public,anon,authenticated;
grant execute on function public.firewatch_core_diagnostics() to service_role;

insert into public.system_state(key,value,updated_at)
values('clean_install_stage',jsonb_build_object('stage',3,'version','core-v0.3','status','pre-release'),now())
on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;
