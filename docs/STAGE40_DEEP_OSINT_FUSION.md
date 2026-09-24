# Stage 40 — Deep OSINT Fusion

## Goal

Stage 40 turns GeoWatch OSINT from several independent feeds into one normalized evidence/fusion layer.

The engine stores source documents separately from event links, so one source item can be correlated with zero, one, or several fire events without losing provenance.

## Core tables

- `osint_source_catalog` — source provenance and transport metadata.
- `osint_documents` — normalized source items with original payload.
- `osint_event_links` — explainable fire-event links with spatial, temporal and text components.

All tables use RLS and are backend/service-role only.

## Initial source catalog

Existing sources mirrored into Fusion:

- GDACS
- NASA EONET
- Copernicus EMS Rapid Mapping

New Stage 40 sources:

- USGS Earthquake Catalog — active, no key.
- Ukraine DSNS/MIA Open Data via Data.gov.ua CKAN — active, no key.
- ReliefWeb — connector implemented; requires pre-approved `RELIEFWEB_APPNAME`.

## Correlation

Correlation is source-aware.

USGS is deliberately strict:
- up to 25 km;
- up to 12 hours;
- maximum five candidate fire-event links;
- strong geo/time score required.

General geolocated disaster sources:
- up to 75–100 km;
- up to 72 hours;
- spatial + temporal scoring.

Non-geolocated documents:
- require textual place/oblast evidence plus a temporal match.

The system explicitly treats correlation as contextual; it does not infer cause or attribution.

## Deep OSINT RPC

`firewatch_deep_osint(event_id_or_prefix)`

Returns:
- event metadata;
- normalized timeline;
- source/provider breakdown;
- source classes;
- strong independent provider count;
- corroboration level;
- relevance and match basis.

Legacy `event_public_osint` and `osint_evidence` are included in the same timeline for backward compatibility.

## Telegram

Client and admin bot:

`/deeposint <event_id>`

Client button: **🧠 Deep OSINT**

## Scheduling

`firewatch-osint-fusion` runs at minutes 10 and 40 each hour with an explicit 90-second pg_net timeout.

Watchdog v27 checks the Fusion last-check age and error/degraded state.

## Next source wave

High-value candidates:

1. Copernicus EFFIS: fire danger (FWI), active-fire and burnt-area layers. Integrate behind cache/circuit breaker because the public WMS can be slow.
2. ReliefWeb: activate after obtaining a pre-approved appname.
3. DSNS incident/news layer: add structured per-incident parsing when a stable machine endpoint is confirmed.
4. CAMS Fire Emissions Watch/GFAS: evaluate a stable machine endpoint for fire-emission and smoke-plume evidence.
5. Additional official CAP/emergency feeds where machine-readable Ukraine coverage is confirmed.
