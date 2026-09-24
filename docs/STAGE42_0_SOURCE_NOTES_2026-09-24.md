# Stage 42.0 source notes — 2026-09-24

## OpenStreetMap / Overpass model

OpenStreetMap Overpass supports radius-based `around` filtering and bounding-box filtering. GeoWatch uses Geofabrik Postpass for the production query path because the project already has a stable low-volume Postpass cache architecture.

## Overture Maps

Official current release verified on 2026-09-24:

`2026-09-23.0`

Schema version:

`v2.0.0`

The Base / Infrastructure schema includes Point, LineString, Polygon and MultiPolygon infrastructure such as:

- bridges
- airports
- communication towers
- power lines
- transit
- utility and water infrastructure

Buildings are published separately as Overture building/building_part datasets.

## Public Fused mirror limitation

The project's anonymous Fused UDF mirror successfully serves:

`2026-04-15-0`

for `place`, `infrastructure` and `building` tile calls.

The same UDF returned HTTP 422 for the official latest `2026-09-23-0` release during validation.

Therefore Stage 42.0 exposes both:

- `overture_mirror_release`
- `overture_official_latest`
- `overture_mirror_lag=true`

and treats Overture as secondary context, not freshness-sensitive truth.
