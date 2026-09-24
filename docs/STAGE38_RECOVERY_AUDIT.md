# Stage 38 Recovery Audit — 2026-09-24

Production was audited against GitHub `main`.

## Drift found

- Production migration history: **118 migrations**
- GitHub recovery baseline before Stage 38: **10 aggregated migrations**
- Production public tables: **37**
- Production RLS policies: **0**; tables are intentionally backend/service-role only
- Production active cron jobs: **27**
- Production Storage buckets: **2**
- Production Edge Functions: **33**
- Production schema uses `public.oblasts`, while the old Community baseline used legacy `regions/project_config/monitoring_areas/firms_sources`.

## Stage 38 recovery layers

1. `0011_stage38_schema_reconciliation.sql` — reconciles tables, columns, constraints, indexes, RLS and comments to the production catalog.
2. `0012_stage38_functions_triggers.sql` — restores production functions, ACLs, table triggers and event triggers.
3. `0013_stage38_runtime_recovery.sql` — restores non-geographic static registries, Storage buckets, Vault secret inventory and a portable production cron installer.
4. `RECOVERY_OBLASTS.md` — manual oblast-boundary restoration procedure; production geometries are deliberately not embedded.

## Recovery order

Apply `0001`–`0013` in order, deploy all Edge Functions, restore oblast boundaries, restore secrets/Vault entries, then call:

```sql
select public.firewatch_install_production_cron('https://<project-ref>.supabase.co');
```

Finally run advisors and production smoke tests before enabling Telegram notifications.

## Secrets

Secret values are never stored in GitHub. Stage 38 records only the required Vault secret names.
