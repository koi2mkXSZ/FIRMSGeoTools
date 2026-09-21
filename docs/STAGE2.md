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
- Windows PowerShell installer.

## Bootstrap behavior

The first FIRMS API response may contain up to 24 hours of recent records.

To avoid flooding a new channel:

1. installation leaves `bootstrap.done=false`;
2. the first successful FIRMS run ingests the normal 24-hour window while notifications are suppressed;
3. only events newer than `bootstrap_fresh_hours` are marked for delivery;
4. bootstrap becomes complete;
5. future new events are notification-required immediately.

Default fresh window: **3 hours**.

## Default cron schedules

- FIRMS ingest: `5,20,35,50 * * * *`;
- Telegram drain: `1,11,16,26,31,41,46,56 * * * *`;
- lifecycle refresh: `9,24,39,54 * * * *`.

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
./scripts/install.sh .env.local
```

Windows PowerShell:

```powershell
.\scripts\install.ps1 -EnvFile .env.local
```

## Security

The setup function is protected with `INSTALL_TOKEN`.

The token is an Edge Function secret and must never be committed.

After installation it may be rotated or removed if no further setup calls are required.

Telegram credentials remain Edge secrets and are never stored in browser code or SQL migrations.
