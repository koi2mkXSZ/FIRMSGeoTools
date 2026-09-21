# Validation

FIRMSGeoTools includes an automated validation system.

## Standard command

Linux/macOS:

```bash
bash scripts/validate.sh .env.local
```

Windows PowerShell:

```powershell
.\scripts\validate.ps1 -EnvFile .env.local
```

The installer runs this automatically as its final step.

## Local checks

Before contacting Supabase, validation checks:

- `SUPABASE_PROJECT_REF`;
- `FIRMS_MAP_KEY`;
- `TELEGRAM_BOT_TOKEN`;
- `TELEGRAM_CHAT_ID`;
- `INSTALL_TOKEN`;
- AOI GeoJSON syntax and geometry types;
- monitoring config syntax;
- polling interval bounds.

## Remote Doctor checks

The protected `firewatch-doctor` endpoint checks:

- AOI and region geometry;
- runtime bbox;
- enabled FIRMS sources;
- RLS state;
- cron jobs;
- Vault cron secret;
- bootstrap state;
- FIRMS worker state;
- Telegram worker state;
- Telegram backlog;
- detections outside AOI;
- orphan detections;
- NASA FIRMS Area API response for every enabled source;
- Telegram bot identity and destination access;
- Notification Integrity gaps/backlog;
- Source Coverage health;
- source baseline state;
- independent FIRMS API → AOI → DB Geographic Integrity.

No secret values are returned.

## Telegram test message

Normal validation does not send any message.

To send one silent test message:

Linux/macOS:

```bash
bash scripts/validate.sh .env.local --telegram-test
```

Windows:

```powershell
.\scripts\validate.ps1 -EnvFile .env.local -TelegramTest
```

## Strict acceptance mode

Warnings are expected immediately after a fresh setup because the first cron cycle may not yet have run.

For release acceptance after at least one normal cron cycle:

Linux/macOS:

```bash
bash scripts/validate.sh .env.local --strict
```

Windows:

```powershell
.\scripts\validate.ps1 -EnvFile .env.local -Strict
```

## Exit codes

- `0` — PASS, or WARN in normal mode;
- `1` — WARN in strict mode;
- `2` — FAIL.

## Release acceptance rule

A clean-install release is considered ready only when it can be installed into a new Supabase project using this public repository alone and reaches **PASS** in strict mode after the first normal monitoring cycle.
