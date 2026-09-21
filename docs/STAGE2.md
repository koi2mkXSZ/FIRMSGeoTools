# Clean Install Stage 2

Stage 2 adds the unattended operational layer required by Core.

## Added

- bootstrap-safe Telegram notifications;
- persistent event notification state;
- serialized Telegram delivery lease;
- generic lifecycle refresh;
- pg_cron configuration without hard-coded project references;
- protected setup Edge Function;
- Linux/macOS installer;
- Windows PowerShell installer;
- selectable FIRMS sources;
- configurable VIIRS/MODIS event radii;
- configurable FIRMS polling interval.

## Bootstrap behavior

The first FIRMS response may contain a full recent window.

To avoid flooding a new channel:

1. installation leaves `bootstrap.done=false`;
2. the first successful FIRMS run ingests the window while notifications are suppressed;
3. only events newer than `bootstrap_fresh_hours` are marked for delivery;
4. bootstrap becomes complete;
5. later new events are notification-required immediately.

Default fresh window: **3 hours**.

## Cron

FIRMS cron is generated from `poll_interval_minutes`.

With the default value of 15 minutes it runs every 15 minutes.

Telegram drain:

```text
1,11,16,26,31,41,46,56 * * * *
```

Lifecycle refresh:

```text
9,24,39,54 * * * *
```

The setup endpoint discovers its own Supabase URL. No project reference is hard-coded into the repository.

## Install

Prepare:

```text
.env.local
config/aoi.geojson
config/monitoring.json
```

Optional:

```text
config/regions.geojson
```

Linux/macOS:

```bash
bash scripts/install.sh .env.local
```

Windows:

```powershell
.\scripts\install.ps1 -EnvFile .env.local
```

## Security

The setup function is protected by `INSTALL_TOKEN`.

The cron secret is generated automatically and stored in Supabase Vault.

Telegram credentials remain Edge secrets and are never stored in browser code or SQL migrations.
