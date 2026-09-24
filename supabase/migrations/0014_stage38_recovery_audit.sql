-- Stage 38 recovery audit
create or replace function public.firewatch_recovery_audit()
returns jsonb
language sql
security definer
set search_path=''
as $$
with s as (
  select
    (select count(*) from pg_tables where schemaname='public')::int as tables,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public')::int as functions,
    (select count(*) from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not tg.tgisinternal)::int as triggers,
    (select count(*) from cron.job)::int as cron_jobs,
    (select count(*) from storage.buckets)::int as buckets,
    (select count(*) from public.oblasts)::int as oblasts,
    (select count(*) from cron.job where active and lower(schedule) ~ '(^|[^a-z])(second|seconds)([^a-z]|$)')::int as second_level_cron,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prosecdef
      and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')))::int as exposed_security_definer
)
select jsonb_build_object(
  'ok', tables=37 and functions>=69 and triggers=8 and cron_jobs=28 and buckets=2 and oblasts=27
        and second_level_cron=0 and exposed_security_definer=0,
  'expected',jsonb_build_object('tables',37,'functions_min',69,'triggers',8,'cron_jobs',28,'buckets',2,'oblasts',27),
  'actual',to_jsonb(s),
  'notes',jsonb_build_array(
    'Oblast geometry must be restored from an exact external backup/GeoJSON asset before production use.',
    'Secret values are never included in Git recovery artifacts.'
  )
) from s;
$$;
revoke all on function public.firewatch_recovery_audit() from public,anon,authenticated;
grant execute on function public.firewatch_recovery_audit() to service_role;
