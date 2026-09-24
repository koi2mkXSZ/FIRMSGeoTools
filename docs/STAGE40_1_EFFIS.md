# Stage 40.1 — Copernicus EFFIS

## Production integration

GeoWatch now uses EFFIS only as **cached, non-blocking enrichment**.

The source is intentionally excluded from the critical FIRMS → event → Telegram path.

### Live WMS

Base service:

`https://maps.effis.emergency.copernicus.eu/effis`

The live 2026 GetCapabilities catalog was probed before implementation. Current relevant layer names are:

- `mf010.fwi` — Meteo France FWI raster
- `mf010.query` — queryable companion layer for fire-danger metadata
- `all.hs.query` — queryable active-fire layer
- `effis.nrt.ba.poly` — queryable near-real-time burnt-area polygons

Do not hardcode the older documentation example `ecmwf007.fwi` as the only FWI layer; it was not present in the live GetCapabilities response observed on 2026-09-24.

## Runtime design

Edge Function: `firewatch-effis`

- v3
- top 6 recent events per run
- 2-hour event cache
- 8-second timeout per WMS request
- FWI / active-fire / burnt-area requests run concurrently per event
- event-level exponential retry
- global 60-minute circuit breaker after 3 fully failed cycles
- cron: minute 29 of every hour
- pg_net timeout: 90 seconds

## FWI caveat

EFFIS currently returns the query template with placeholders such as `[FWI]` for the tested Ukraine event queries. GeoWatch therefore stores:

- `fwi_value = null`
- `fwi_query_status = template_placeholder`

No numeric FWI is inferred or fabricated.

If the live query layer later returns a real numeric value, it will be stored automatically.

## Evidence semantics

EFFIS active-fire and NRT burnt-area layers are satellite-derived products. They are useful for context and post-fire confirmation, but are **not independent corroboration of FIRMS detections**.

The source catalog marks them:

`independent_for_corroboration = false`

## Deep OSINT

`firewatch_deep_osint()` now includes an `effis` object with:

- cache status
- query time
- FWI value/status
- active-fire match/count
- burnt-area match/count
- failure/backoff state

Both client and admin `/deeposint` outputs show an EFFIS summary.

## Initial live validation

The first full v1 cycle processed 12/12 events successfully with no total failures. Runtime was about 37.8 seconds.

v2 reduced the batch to 6 and parallelized the three WMS calls per event. v3 corrected the HTML field parser used for FWI metadata.

## License

EFFIS data are publicly accessible through its WMS services. EU-owned website content is generally available under CC BY 4.0 subject to attribution and any dataset-specific third-party rights.
