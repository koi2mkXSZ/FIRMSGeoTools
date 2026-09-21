# Architecture

## Core data flow

```text
FIRMS Area API
      │
      ▼
source workers
      │
      ▼
AOI / ADM1 spatial filter
      │
      ▼
detections
      │
      ▼
event clustering
      │
      ├──► Telegram
      │
      ├──► Admin bot
      │
      └──► Dashboard
```

## Design goals

- cloud-only;
- no local PC required after deployment;
- idempotent ingestion;
- deterministic detection hashing;
- configurable AOI;
- no secrets in public frontend;
- explicit source health monitoring;
- audit path from upstream record to Telegram event.

## Core modules

### FIRMS workers

Independent workers for:

- NOAA-20 VIIRS;
- NOAA-21 VIIRS;
- Suomi NPP VIIRS;
- MODIS Terra/Aqua.

### PostgreSQL/PostGIS

Stores:

- AOI and optional ADM1 geometry;
- raw/current detections;
- clustered events;
- source health;
- notification state;
- integrity audit state.

### Telegram

One public event corresponds to one clustered event, not one satellite pixel.

Subsequent detections can update an existing event.

### Admin bot

Operator functions include:

- system status;
- source coverage;
- event search;
- radius search;
- analytics;
- geographic integrity.

### Dashboard

Static frontend plus server-side authenticated read-only API.

No Supabase service-role credential is exposed to the browser.

## Profiles

### core

FIRMS + Telegram + dashboard + health/integrity.

### full

Adds optional remote sensing and OSINT modules.

Full profile must remain optional so missing third-party credentials never prevent Core from running.
