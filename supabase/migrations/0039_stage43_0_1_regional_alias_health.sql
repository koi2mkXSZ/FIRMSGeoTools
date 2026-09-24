-- Stage 43.0.1 — Regional alias runtime health guard
-- FIRMSGeoTools VERSION 1.0.0
-- schema_version 39

create or replace function public.firewatch_configure_regional_alias_health_cron(p_base_url text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','cron','pg_temp'
as $function$
declare
  v_url text:=rtrim(p_base_url,'/');
  v_jobid bigint;
  r record;
begin
  if v_url !~ '^https://[a-z0-9-]+[.]supabase[.]co$' then
    raise exception 'Invalid Supabase base URL';
  end if;

  for r in select jobid from cron.job where jobname='firewatch-regional-alias-health' loop
    perform cron.unschedule(r.jobid);
  end loop;

  v_jobid:=cron.schedule(
    'firewatch-regional-alias-health',
    '19 */6 * * *',
    format($cmd$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='firewatch_cron_secret' limit 1)
        ),
        body := '{"self_test":"oblast_aliases"}'::jsonb,
        timeout_milliseconds := 30000
      );
    $cmd$,v_url||'/functions/v1/firewatch-regional-search')
  );

  insert into public.system_state(key,value,updated_at)
  values('regional_alias_cron',jsonb_build_object(
    'configured',true,
    'configured_at',now(),
    'base_url',v_url,
    'schedule','19 */6 * * *',
    'job_id',v_jobid
  ),now())
  on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at;

  return (select value from public.system_state where key='regional_alias_cron');
end;
$function$;

revoke all on function public.firewatch_configure_regional_alias_health_cron(text) from public,anon,authenticated;
grant execute on function public.firewatch_configure_regional_alias_health_cron(text) to service_role;
