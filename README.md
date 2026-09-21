# FIRMSGeoTools

Community-ready deployment of a cloud fire / thermal-anomaly monitoring system built around NASA FIRMS, Supabase and Telegram.

This repository is a **clean-install extraction** of an already tested production system. It intentionally contains:

- no production Supabase project IDs;
- no Telegram chat IDs;
- no API keys;
- no private URLs;
- no database dumps;
- no operator data.

Users provide their own credentials and monitoring geography.

## Current status

**Clean Install Core: Stage 4 / pre-release**

Already implemented in the public clean install:

- configurable AOI from GeoJSON;
- optional regions / ADM1 from GeoJSON;
- automatic FIRMS bbox derived from AOI;
- NOAA-20 / NOAA-21 / Suomi NPP VIIRS;
- Terra/Aqua MODIS;
- deterministic detection deduplication;
- spatial event clustering;
- bootstrap-safe first import;
- Telegram notification delivery;
- persistent Telegram delivery state and lease;
- event lifecycle refresh;
- parameterized pg_cron;
- Windows PowerShell installer;
- Linux/macOS installer;
- automated installation doctor;
- local + remote validation;
- non-invasive FIRMS and Telegram credential checks;
- private Telegram admin panel;
- event search and coordinate-radius search;
- descriptive analytics across all configured regions.

Stage 3 also adds `scripts/validate.*` and the protected `firewatch-doctor` endpoint.

Still being ported from the private production system:

- source coverage;
- notification integrity;
- geographic integrity audit;
- Web Dashboard;
- event timeline;
- optional EUMETSAT / Sentinel / CAMS / OSINT modules.

Do **not** treat the current branch as a stable production release until the fresh-project acceptance test is complete.

## Deployment model

```text
NASA FIRMS
    │
    ▼
firewatch-firms
    │
    ▼
PostgreSQL + PostGIS
    │
    ├── detections
    ├── clustered events
    └── lifecycle / notification state
              │
              ▼
      firewatch-telegram
              │
              ▼
           Telegram
```

## Quick start

1. Create a new Supabase project.
2. Create a Telegram bot and destination channel/group.
3. Obtain a NASA FIRMS MAP_KEY.
4. Clone this repository.
5. Copy `.env.example` to `.env.local`.
6. Copy `config/aoi.example.geojson` to `config/aoi.geojson` and edit it.
7. Copy `config/monitoring.example.json` to `config/monitoring.json`.
8. Optional: provide `config/regions.geojson`.
9. Follow [docs/INSTALL.md](docs/INSTALL.md).

Never commit `.env.local`, your actual AOI/region configuration if private, or any secret.

## Documentation

- [Installation](docs/INSTALL.md)
- [Keys and secrets](docs/KEYS_AND_SECRETS.md)
- [Geography setup](docs/GEO_SETUP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Clean Core](docs/CLEAN_CORE.md)
- [Stage 2](docs/STAGE2.md)
- [Stage 3](docs/STAGE3.md)
- [Stage 4](docs/STAGE4.md)
- [Security](docs/SECURITY.md)
- [Validation](docs/VALIDATION.md)
