# Installation

This guide describes a clean install into a new Supabase project.

> Current packaging status: installer scaffolding. Production code is being parameterized before the first stable release.

## 1. Requirements

You need:

- GitHub account;
- Supabase account;
- Telegram account;
- NASA FIRMS MAP_KEY;
- Git;
- Supabase CLI for CLI-based installation.

Optional Full-profile integrations require additional credentials.

## 2. Create Supabase project

Create a new Supabase project and save:

- project reference;
- database password;
- personal access token for Supabase CLI.

Do not publish these values.

Required PostgreSQL extensions will be enabled by migrations:

- PostGIS;
- pg_cron;
- pg_net;
- http;
- Vault;
- pgcrypto;
- uuid-ossp.

## 3. NASA FIRMS MAP_KEY

Obtain a MAP_KEY from NASA FIRMS.

Add it as a Supabase Edge Function secret:

```bash
supabase secrets set FIRMS_MAP_KEY="..."
```

See [KEYS_AND_SECRETS.md](KEYS_AND_SECRETS.md).

## 4. Telegram

Create a bot using BotFather.

Add the bot to your channel/group with permission to publish messages.

Set:

```bash
supabase secrets set TELEGRAM_BOT_TOKEN="..."
supabase secrets set TELEGRAM_CHAT_ID="..."
```

The admin chat is configured separately so the public channel ID does not need to equal the administrator ID.

## 5. Configure geography

Copy:

```text
config/monitoring.example.json -> config/monitoring.json
config/aoi.example.geojson    -> config/aoi.geojson
```

Edit the geometry to your monitoring area.

See [GEO_SETUP.md](GEO_SETUP.md).

## 6. Link Supabase CLI

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

## 7. Install secrets

Copy `.env.example` to a private local file and fill only the modules you use.

Never commit that file.

Core profile requires:

- FIRMS_MAP_KEY
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID
- FIREWATCH_CRON_SECRET
- TELEGRAM_ADMIN_WEBHOOK_SECRET

## 8. Apply database migrations

Stable release command will be:

```bash
supabase db push
```

The clean-install migration set will create all required tables, RPCs, RLS rules, Storage buckets and cron jobs.

## 9. Deploy Edge Functions

Stable release will provide:

```bash
./scripts/deploy.sh core
```

and PowerShell equivalent:

```powershell
./scripts/deploy.ps1 -Profile core
```

## 10. Bootstrap admin bot

The installer will register the Telegram webhook and pair the administrator.

## 11. Validate

Run the supplied validation script and verify:

- FIRMS fetch succeeds;
- AOI classification succeeds;
- at least one cron run is recorded;
- Telegram bot can send a test message;
- source coverage is healthy;
- geographic integrity has no missing records.

See [VALIDATION.md](VALIDATION.md).

## 12. Upgrade to Full profile

Optional sources can be enabled later without reinstalling Core.

The Full profile will document each extra credential separately.
