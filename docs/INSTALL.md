# Installation — Core pre-release

This guide installs the current FIRMSGeoTools Core into a **new Supabase project**.

> Current status: pre-release. A full fresh-project acceptance test is still required before the repository is marked stable.

## 1. Requirements

You need:

- Git;
- Python 3;
- Supabase CLI;
- Supabase account;
- Telegram account;
- NASA FIRMS MAP_KEY.

Linux/macOS also needs `curl`.

## 2. Clone and prepare files

```bash
git clone https://github.com/koi2mkXSZ/FIRMSGeoTools.git
cd FIRMSGeoTools
```

Create local configuration files:

Linux/macOS:

```bash
cp .env.example .env.local
cp config/aoi.example.geojson config/aoi.geojson
cp config/monitoring.example.json config/monitoring.json
```

PowerShell:

```powershell
Copy-Item .env.example .env.local
Copy-Item config/aoi.example.geojson config/aoi.geojson
Copy-Item config/monitoring.example.json config/monitoring.json
```

The real files are ignored by Git.

## 3. Create Supabase project

Create an empty Supabase project.

Copy its project reference. Example:

```text
https://abcdefghijklmnop.supabase.co
        ^^^^^^^^^^^^^^^^
        project reference
```

Put only the project reference into:

```text
SUPABASE_PROJECT_REF=
```

in `.env.local`.

The installer uses your Supabase CLI login for database deployment. It does not require the service-role key in `.env.local`.

## 4. Get NASA FIRMS MAP_KEY

Request your MAP_KEY from NASA FIRMS API.

Set:

```text
FIRMS_MAP_KEY=
```

The installer stores it as a Supabase Edge Function secret.

## 5. Create Telegram bot

Using BotFather:

1. create a bot;
2. copy the bot token;
3. add the bot to the destination channel/group;
4. grant permission to publish messages;
5. determine the destination chat/channel ID.

Set:

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

## 6. Generate INSTALL_TOKEN

This protects the setup endpoint during installation.

Linux/macOS:

```bash
openssl rand -hex 32
```

PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes).ToLower()
```

Put the result in:

```text
INSTALL_TOKEN=
```

A separate cron secret is generated automatically inside Supabase Vault. You do not need to create or copy it.

## 7. Configure monitoring area

Edit:

```text
config/aoi.geojson
```

The AOI must be WGS84 / EPSG:4326 Polygon or MultiPolygon geometry.

For per-region statistics later, optionally provide:

```text
config/regions.geojson
```

and set:

```text
REGIONS_FILE=config/regions.geojson
```

See [GEO_SETUP.md](GEO_SETUP.md).

## 8. Configure monitoring

Edit:

```text
config/monitoring.json
```

Important values:

- `project_name`;
- `timezone`;
- `poll_interval_minutes`;
- `event_match_hours`;
- `bootstrap_fresh_hours`;
- enabled FIRMS sources;
- VIIRS/MODIS event matching radii;
- lifecycle inactivity/close windows.

## 9. Login to Supabase CLI

```bash
supabase login
```

## 10. Run installer

Linux/macOS:

```bash
bash scripts/install.sh .env.local
```

Windows PowerShell:

```powershell
.\scripts\install.ps1 -EnvFile .env.local
```

The installer:

1. links the Supabase project;
2. applies migrations;
3. installs Edge secrets;
4. deploys Core Edge Functions;
5. uploads AOI/regions;
6. configures cron using the project's own Supabase URL;
7. deploys and runs the installation doctor.

## 11. Bootstrap behavior

The first scheduled FIRMS run imports the normal recent upstream window, but old records are not published to Telegram.

Only events newer than `bootstrap_fresh_hours` are marked for initial delivery.

Default: **3 hours**.

After the first successful FIRMS run, bootstrap is complete and later new events are delivered normally.

## 12. Core cron

FIRMS polling uses `poll_interval_minutes` from `config/monitoring.json`.

Telegram queue draining currently runs several times per hour.

Lifecycle refresh runs several times per hour.

No Supabase project URL is hard-coded in repository SQL.

## 13. Next validation

Automated acceptance scripts are the next packaging stage.

Until that stage is complete, verify the deployment from the Supabase dashboard:

- migrations succeeded;
- the three Edge Functions are deployed;
- AOI exists in `monitoring_areas`;
- `core_cron` exists in `system_state`;
- after the first FIRMS run, `bootstrap.done=true`;
- `monitor_firms.last_success_run` updates;
- Telegram receives only fresh new events.


## 14. Automatic validation

The installer finishes by running the Stage 3 doctor.

Immediately after installation, `WARN` for bootstrap/first worker execution is normal.

After one monitoring cycle, run strict validation:

Linux/macOS:

```bash
bash scripts/validate.sh .env.local --strict
```

PowerShell:

```powershell
.\scripts\validate.ps1 -EnvFile .env.local -Strict
```

To test actual Telegram publishing once:

```bash
bash scripts/validate.sh .env.local --telegram-test
```

or:

```powershell
.\scripts\validate.ps1 -EnvFile .env.local -TelegramTest
```


## 15. Optional private admin bot

To enable the operator panel, add to `.env.local`:

```text
TELEGRAM_ADMIN_CHAT_ID=your-private-chat-id
TELEGRAM_ADMIN_WEBHOOK_SECRET=random-secret
```

Then rerun the installer.

The setup endpoint automatically registers:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/firewatch-admin
```

as the Telegram webhook.

Open a private chat with the bot and send:

```text
/panel
```

Do not use the public channel ID as the admin ID unless that is explicitly what you intend.
