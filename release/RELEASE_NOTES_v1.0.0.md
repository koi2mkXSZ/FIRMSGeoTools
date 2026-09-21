# FIRMSGeoTools v1.0.0

First stable Community Edition release.

## Highlights

- configurable AOI and optional administrative regions from GeoJSON;
- NASA FIRMS NOAA-20, NOAA-21, Suomi NPP VIIRS and MODIS ingestion;
- deterministic deduplication and spatial event clustering;
- Telegram event delivery with persistent delivery state;
- private Telegram admin panel with search, radius search, analytics and status;
- Source Coverage, robust source baseline and Notification Integrity;
- independent Geographic Integrity audit;
- static read-only Web Dashboard with short-lived signed Supabase API access;
- Windows and Linux/macOS install, upgrade, validation, backup and recovery workflows;
- automated Doctor, CI, release consistency and secret/hardcode guards.

## Acceptance

v1.0.0 was validated on a new Supabase project from the public repository only.

Acceptance results included:

- Core diagnostics: 11/11 PASS;
- Doctor: 23 PASS / 1 expected baseline-learning WARN / 0 FAIL;
- Source Coverage: 4/4 active;
- Geographic Integrity: API 3 → AOI 3 → DB 3, missing_in_db = 0;
- Telegram test delivery: PASS;
- admin webhook: PASS;
- Dashboard deployment and HTTP reachability: PASS;
- recovery export: PASS.

The baseline-learning warning is expected immediately after a new installation while the rolling source baseline accumulates history.
