# FIRMSGeoTools

Community-ready deployment of a cloud fire / thermal anomaly monitoring system built around NASA FIRMS, Supabase and Telegram.

The project is derived from a production system, but this repository is intentionally **clean-install only**:

- no production project IDs;
- no Telegram chat IDs;
- no API keys;
- no private URLs;
- no database dumps;
- no operator data.

Users provide their own credentials and monitoring geography.

## What you get

### Core profile

- NASA FIRMS VIIRS NOAA-20 / NOAA-21 / Suomi NPP;
- NASA FIRMS MODIS Terra/Aqua;
- configurable monitoring area;
- event clustering / deduplication;
- Telegram notifications;
- admin bot;
- source coverage and notification integrity;
- search by event ID, filters, coordinate + radius;
- Web Dashboard;
- geographic integrity audit.

### Full profile

Everything in Core, plus optional integrations for:

- EUMETSAT LSA SAF;
- Sentinel-3 SLSTR;
- Sentinel-2 surface evidence;
- CAMS;
- Sentinel-5P;
- OSINT / geo context;
- ground environmental context;
- evidence reports.

## Deployment model

```text
NASA FIRMS / optional sources
          │
          ▼
 Supabase Edge Functions
          │
          ▼
 PostgreSQL + PostGIS
          │
     ┌────┴────┐
     ▼         ▼
 Telegram   Web Dashboard
```

## Quick start

1. Create a Supabase project.
2. Create a Telegram bot and destination channel.
3. Obtain a NASA FIRMS MAP_KEY.
4. Clone this repository.
5. Copy `.env.example` to your local secret file.
6. Configure your monitoring geography.
7. Follow [docs/INSTALL.md](docs/INSTALL.md).

Do **not** commit your secret file.

## Documentation

- [Installation](docs/INSTALL.md)
- [Keys and secrets](docs/KEYS_AND_SECRETS.md)
- [Geography setup](docs/GEO_SETUP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Validation](docs/VALIDATION.md)

## Project status

The public clean-install packaging is being extracted from an already tested production deployment.

The installer is being built in stages. Do not use this repository for production until the README marks the current release as **stable**.
