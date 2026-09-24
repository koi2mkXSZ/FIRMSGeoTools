# Stage 40.4 — Geolocation Enrichment Layer

## Goal

Add independent geospatial reference context to Deep OSINT and use nearby place names as additional semantic-geolocation hints.

This layer is non-critical and never blocks FIRMS ingestion or Telegram delivery.

## Sources

### Overture Maps Places

Data provider: Overture Maps Foundation.

Runtime transport: public Fused `UDF_Overture_Maps_Example`.

Important provenance distinction:

- underlying data: Overture
- transport/mirror: Fused public UDF

The production function uses z16 tiles around each event, a 3×3 neighborhood, and retains the nearest places within 1.4 km.

Stored fields include:

- Overture/GERS feature id
- primary name
- basic/category value
- confidence
- public address/locality when present
- operating status
- distance from the FIRMS event
- contributing Overture datasets

No phone/email/social fields are retained.

### GeoNames

GeoNames is implemented through the official REST service.

The free API requires a GeoNames username. Until `GEONAMES_USERNAME` is configured, the connector reports:

`waiting_username`

This is fail-soft and does not degrade the GeoWatch pipeline.

## Overture release freshness

At implementation time:

- official Overture STAC latest: `2026-09-23.0`
- public Fused UDF mirror snapshot available to this integration: `2026-04-15-0`

The runtime queries the official STAC catalog and exposes:

- `overture_release`
- `overture_official_latest`
- `overture_mirror_lag`

The mirror lag is explicit provenance metadata. Nearby static POI context remains useful, but it must not be described as the latest Overture snapshot.

## Cache and runtime

Edge Function:

`firewatch-geolocation`

Production v3:

- event window: 48 h
- max refresh: 4 events/run
- cache: 7 days
- Overture tile zoom: 16
- 3×3 tile neighborhood
- place radius: 1.4 km
- request timeout: 9 s
- cron: minute 12 every hour
- pg_net timeout: 90 s

Partial neighboring-tile timeouts are recorded as `overture_status=partial`; they do not mark the whole enrichment cycle failed if usable Overture data were returned.

## Deep OSINT

`firewatch_deep_osint()` now includes:

`geolocation`

Client Telegram output contains:

`🗺 Геоконтекст`

with up to three nearest Overture places.

Admin output additionally shows release and tile coverage.

## Semantic integration

`firewatch-osint-semantic v5` reads cached Overture/GeoNames place names.

A nearby place-name match produces:

`semantic_geo_status = local_reference`

with geo score 85.

This is weaker than an event's exact nearest-place/oblast evidence and is only a geographic hint.

## Validation

Event `eb9d8ee2`:

- Overture status: active
- tiles: 9/9
- nearest place: `OKKO`
- category: `gas_station`
- distance: 244 m
- Overture confidence: 0.77
- contributing dataset: Foursquare + Overture

The semantic summary remained geographically supported after enrichment.

## Interpretation

A nearby Overture/GeoNames feature is contextual map evidence only.

It does not establish that the thermal event occurred at, affected, targeted, or was caused by that feature.
