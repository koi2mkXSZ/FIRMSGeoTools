# Upgrade

Use the upgrade scripts for an existing FIRMSGeoTools installation.

## Before upgrading

Create a backup:

Linux/macOS:

```bash
bash scripts/backup.sh .env.local
```

Windows:

```powershell
.\scripts\backup.ps1 -EnvFile .env.local
```

Then update the repository checkout to the desired release/tag.

## Upgrade

Linux/macOS:

```bash
bash scripts/upgrade.sh .env.local
```

Windows:

```powershell
.\scripts\upgrade.ps1 -EnvFile .env.local
```

The workflow:

1. links the configured Supabase project;
2. applies pending migrations;
3. redeploys all Core Edge Functions;
4. calls protected setup in `upgrade` mode;
5. recreates runtime cron configuration;
6. refreshes Telegram admin webhook if configured;
7. runs validation.

Upgrade mode does **not** replace AOI/regions.

## Migration policy

Released migrations are append-only.

Do not edit a migration already included in a tagged release.

New schema changes receive a new numbered migration.

## Rollback

Application-code rollback:

1. checkout the previous Git tag;
2. redeploy the Edge Functions from that tag.

Database rollback is not automatically destructive.

If a migration introduces an incompatible schema change, use the release-specific rollback notes or restore from a database backup.

Never automatically drop operational data as part of a generic rollback script.
