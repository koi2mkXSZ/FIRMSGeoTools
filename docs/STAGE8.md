# Stage 8 — Fresh-project Acceptance Test

Status: **in progress**

Target: a brand-new Supabase project created specifically for acceptance.

## Passed

- migration 0001 from zero;
- migration 0002 after fresh-install delimiter fix;
- migration 0003;
- migration 0004;
- migration 0005 after fresh-install SQL repair;
- migration 0006;
- migration 0007;
- migration 0008 Dashboard static-host hotfix;
- all seven Core Edge Functions deploy and become ACTIVE;
- AOI imports from public example GeoJSON;
- four FIRMS sources configure from public example settings;
- all seven cron jobs configure and become active;
- RLS enabled on all Core/Integrity/Release tables;
- release metadata and schema version available;
- portable recovery export succeeds with `secrets_included=false`;
- signed Dashboard API authentication succeeds;
- Dashboard API returns JSON and correct CORS for configured static origin;
- repository CI passes after Stage 8 SQL guards.

## Defects found and fixed by Stage 8

### Migration 0002

A nested PostgreSQL dollar quote in lifecycle cron SQL prevented a zero-to-one install.

Fixed in the public migration.

### Migration 0005

Fresh PostgreSQL parsing exposed malformed dollar-quote delimiters and a corrupted duplicate SQL tail.

Fixed in the public migration.

A migration delimiter sanity check was added to repository CI.

### Dashboard hosting

Supabase Edge Runtime forces HTML responses to `text/plain` with a restrictive sandbox CSP.

The original self-hosted-HTML design was therefore not browser-safe.

Stage 8 changed the architecture to:

```text
GitHub Pages static frontend
        │ signed API parameters
        ▼
firewatch-dashboard Edge API
        │
        ▼
service-role-only RPCs
```

The API accepts CORS only from the configured `dashboard_public_url`.

## Remaining external acceptance

The following require user-owned external credentials and cannot be set by the current Supabase connector:

- FIRMS_MAP_KEY;
- TELEGRAM_BOT_TOKEN;
- TELEGRAM_CHAT_ID;
- INSTALL_TOKEN;
- optional TELEGRAM_ADMIN_CHAT_ID;
- optional TELEGRAM_ADMIN_WEBHOOK_SECRET.

The GitHub connector also cannot perform the initial repository-administration action that enables GitHub Pages.

## Final v1 gate

After secrets and Pages are configured:

1. first FIRMS run completes bootstrap;
2. second normal FIRMS cycle succeeds;
3. Telegram test message succeeds;
4. admin webhook succeeds when configured;
5. Source Coverage reaches healthy state;
6. Notification Integrity reports no gaps;
7. Geographic Integrity reports `missing_in_db=0`;
8. static Dashboard opens and reads the signed API;
9. strict validation exits 0;
10. recovery export succeeds.

Only then is `v1.0.0` published.
