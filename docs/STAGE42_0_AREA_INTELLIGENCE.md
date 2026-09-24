# Stage 42.0 — Infrastructure & Area Intelligence

## Goal

Turn GeoWatch into an optional coordinate-driven OSINT context engine, not limited to fire-related enrichment.

Inputs:

- event ID + radius
- arbitrary latitude/longitude + radius

Supported radius:

- minimum 250 m
- default 2 km
- maximum 10 km

## Primary source

OpenStreetMap through Geofabrik Postpass.

The current query extracts contextual features in the following normalized classes:

- energy
- industrial
- government
- emergency
- healthcare
- education
- transport
- logistics
- water
- telecom
- commercial
- residential
- cultural
- public_service
- storage

The cache stores a bounded set of representative features and category counts.

## Buildings

A separate server-side Postpass aggregate returns:

- building footprint count
- named-building count
- tagged non-residential building count

The API does not stream all building polygons to Telegram.

## Overture cross-source

Overture is used as a secondary cross-source context layer for radius <= 2.5 km.

Current public Fused mirror:

- snapshot: 2026-04-15-0
- official Overture latest: 2026-09-23.0
- `mirror_lag = true`

The lag is always surfaced. The mirror is never presented as current official Overture data.

Official Overture 2026-09-23.0 documents base/infrastructure features such as airports, bridges, communication towers and power lines, and building footprints are available in the buildings theme.

## Safe output profile

The operator-facing layer intentionally does not expose engineering/operational parameters such as:

- line voltage
- pipeline pressure
- pipeline diameter
- equipment ratings

It also does not compute:

- vulnerability score
- target-value score
- access-route score
- suitability-for-action score

Output is descriptive geospatial context: category, public name, public source, distance and basic classification.

## Cache

New backend-only table:

`area_intel_cache`

Cache lifetime in Edge Function: 12 hours.

## Edge Function

`firewatch-area-intel v3`

Authentication:

- service-role bearer for internal bot calls
- cron secret for controlled diagnostics

Modes:

`{"event_id":"19be809d","radius_m":2000}`

or

`{"lat":46.61212,"lon":31.55511,"radius_m":2000}`

## Admin Telegram commands

`/infra <event-id> [radius_m]`

Example:

`/infra 19be809d 2000`

Arbitrary point:

`/area <lat> <lon> [radius_m]`

Example:

`/area 46.61212 31.55511 2000`

## Production smoke test

Event `19be809d`, radius 2 km:

- OSM context features: 146
- energy: 14
- industrial: 17
- government: 3
- emergency: 3
- healthcare: 2
- education: 7
- transport: 28
- logistics: 6
- telecom: 3
- commercial: 23
- residential: 35
- cultural: 3
- public_service: 2
- OSM building footprints: 806
- named buildings: 17
- tagged non-residential buildings: 19
- Overture cross-source context: 20 features
- OSM/Postpass status: active
- Overture status: active
- errors: 0

Examples of public-context matches included a court, school, pharmacy, market and other mapped civic/commercial objects.

## Security

`area_intel_cache` is backend-only:

- RLS enabled
- anon/authenticated grants revoked

All SECURITY DEFINER RPCs are revoked from PUBLIC/anon/authenticated and granted only to service_role.

Security Advisor introduced no new exposed privileged-RPC warning.
