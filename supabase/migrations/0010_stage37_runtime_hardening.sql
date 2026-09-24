-- Stage 37 runtime hardening and security sync
-- 2026-09-24

-- Remove runaway second-level Ground OSINT cron jobs if present.
do $$
declare r record;
begin
  for r in
    select jobid
    from cron.job
    where active
      and lower(schedule) ~ '(^|[^a-z])(second|seconds)([^a-z]|$)'
      and command ilike '%firewatch-ground-osint%'
  loop
    perform cron.unschedule(r.jobid);
  end loop;
end $$;

create or replace function public.firewatch_cron_health_summary()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'active_jobs', count(*) filter (where active),
    'second_level_jobs', count(*) filter (
      where active and lower(schedule) ~ '(^|[^a-z])(second|seconds)([^a-z]|$)'
    ),
    'second_level_job_ids', coalesce(
      jsonb_agg(jobid order by jobid) filter (
        where active and lower(schedule) ~ '(^|[^a-z])(second|seconds)([^a-z]|$)'
      ),
      '[]'::jsonb
    )
  )
  from cron.job;
$$;

revoke all on function public.firewatch_cron_health_summary() from public, anon, authenticated;
grant execute on function public.firewatch_cron_health_summary() to service_role;

create index if not exists air_alert_current_oblast_idx
  on public.air_alert_current (oblast_id);

create index if not exists osint_evidence_oblast_idx
  on public.osint_evidence (oblast_id);

revoke all on function public.firewatch_build_event_dossier_stage37(uuid) from public, anon, authenticated;
revoke all on function public.firewatch_build_event_dossier_stage371(uuid) from public, anon, authenticated;
revoke all on function public.firewatch_build_event_dossier_stage373(uuid) from public, anon, authenticated;
revoke all on function public.firewatch_public_post_context(uuid) from public, anon, authenticated;
revoke all on function public.promote_event_on_fresh_polar_detection() from public, anon, authenticated;

grant execute on function public.firewatch_build_event_dossier_stage37(uuid) to service_role;
grant execute on function public.firewatch_build_event_dossier_stage371(uuid) to service_role;
grant execute on function public.firewatch_build_event_dossier_stage373(uuid) to service_role;
grant execute on function public.firewatch_public_post_context(uuid) to service_role;
