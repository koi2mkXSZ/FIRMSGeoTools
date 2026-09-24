-- Stability Audit 2.0 hardening
-- 2026-09-24

create or replace function public.firewatch_pgnet_health_summary()
returns jsonb
language sql
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'queue_depth',(select count(*) from net.http_request_queue),
    'responses_1h',(select count(*) from net._http_response where created>now()-interval '1 hour'),
    'errors_1h',(select count(*) from net._http_response where created>now()-interval '1 hour' and error_msg is not null),
    'timeouts_1h',(select count(*) from net._http_response where created>now()-interval '1 hour' and timed_out),
    'http_5xx_1h',(select count(*) from net._http_response where created>now()-interval '1 hour' and status_code>=500),
    'last_error_at',(select max(created) from net._http_response where created>now()-interval '6 hours' and (error_msg is not null or timed_out or status_code>=500))
  );
$$;

revoke all on function public.firewatch_pgnet_health_summary() from public,anon,authenticated;
grant execute on function public.firewatch_pgnet_health_summary() to service_role;

-- If production cron has already been installed, ensure all legacy HTTP jobs have an explicit timeout.
do $$
declare r record;
begin
  for r in
    select jobid,command
    from cron.job
    where jobname in ('firewatch-modis-hourly','firewatch-snpp-hourly','firewatch-watchdog','firewatch-source-audit')
      and position('timeout_milliseconds' in command)=0
  loop
    perform cron.alter_job(
      r.jobid,
      command := regexp_replace(
        r.command,
        'body := ''\{\}''::jsonb([[:space:]]*)\);',
        'body := ''{}''::jsonb,\1  timeout_milliseconds := 90000\1);'
      )
    );
  end loop;
end $$;
