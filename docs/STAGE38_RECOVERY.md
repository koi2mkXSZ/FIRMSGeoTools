# Stage 38 — Production Recovery Baseline

Дата снимка: 2026-09-24  
Production project: `swvpqroxbsrmxdmedojd`

## Цель

Этот слой устраняет drift между старым Community baseline в GitHub и фактической production-схемой GeoWatch.

Production на момент снимка содержит 118+ исторических миграций. GitHub ранее содержал только агрегированные `0001–0010`, поэтому Stage 38 добавляет канонический reconciliation layer поверх них.

## Recovery migrations

1. `0011_stage38_production_schema_reconcile.sql`
   - extensions;
   - 37 production tables;
   - columns/defaults/identity;
   - PK/UK/FK/CHECK constraints;
   - indexes;
   - RLS;
   - comments;
   - удаление legacy Community объектов, отсутствующих в production.

2. `0012_stage38_functions_triggers_acl.sql`
   - production definitions всех public functions;
   - ACL/EXECUTE grants;
   - table triggers;
   - event triggers.

3. `0013_stage38_runtime_static_recovery.sql`
   - Telegram OSINT source registry;
   - Storage buckets;
   - Vault secret inventory без значений;
   - metadata inventory областей;
   - переносимый `firewatch_install_production_cron(project_url)` для установки 28 production cron jobs на новом Supabase project URL.

4. `0014_stage38_recovery_audit.sql`
   - `firewatch_recovery_audit()`;
   - контроль counts/security/runtime invariants.

## Required Edge Function environment variables

Values are NOT stored in Git.

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FIRMS_MAP_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `CLIENT_TELEGRAM_BOT_TOKEN`
- `CLIENT_TELEGRAM_WEBHOOK_SECRET`
- `OPENAQ_API_KEY`
- `CDSE_USERNAME`
- `CDSE_PASSWORD`
- `LSA_SAF_USERNAME`
- `LSA_SAF_PASSWORD`
- `LSASAF_USERNAME`
- `LSASAF_PASSWORD`

Production Vault names:

- `firewatch_cron_secret`
- `telegram_admin_webhook_secret`

Secret values must be restored manually from the secure secret store.

## Recovery sequence

1. Create/link a fresh Supabase project.
2. Apply migrations `0001` through `0014` in order.
3. Restore exact oblast boundary geometry before enabling ingestion.
4. Restore Edge Function secrets/environment variables.
5. Deploy all functions under `supabase/functions/`.
6. Restore Vault secrets listed above.
7. Run:
   `select public.firewatch_install_production_cron('https://<PROJECT_REF>.supabase.co');`
8. Bootstrap Telegram webhooks using the normal admin/client bootstrap path.
9. Run:
   `select public.firewatch_recovery_audit();`
10. Do not enable production traffic unless `ok=true` and oblast geometry is complete.

## Current production acceptance

Stage 38 audit on 2026-09-24:

- tables: 37
- functions: 70
- triggers: 8
- cron jobs: 28
- Storage buckets: 2
- oblasts: 27
- active second-level cron jobs: 0
- SECURITY DEFINER executable by anon/authenticated: 0
- audit result: `ok=true`

## Known external recovery asset

Exact oblast geometry is not embedded in Git by Stage 38 because the connector transport cannot export the production geometry payload without truncation/HTTP2 failure. Do not replace it with simplified geometry.

For a true zero-external-dependency disaster-recovery package, export `public.oblasts.geom` separately as an exact GeoJSON/PostGIS backup and store it as a protected release/recovery asset. The metadata and expected count are already recorded by migration `0013`.

## pg_net warning

Supabase advisor reports `pg_net` installed in `public`. It is intentionally left unchanged in Stage 38 because current cron jobs use `net.http_post()`. Moving the extension should be handled as a separate tested migration, not during disaster-recovery reconciliation.
