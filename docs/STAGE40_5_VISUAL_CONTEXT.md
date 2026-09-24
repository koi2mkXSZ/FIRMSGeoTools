# Stage 40.5 — Visual Verification Context

## Goal

Stage 40.5 adds a non-blocking visual-source availability layer to Deep OSINT.

It answers a narrow question:

> Are there open street-level or aerial images available near this event that an analyst could inspect?

It does **not** automatically interpret those images or treat their existence as confirmation of a fire event.

## Sources

### Panoramax

Panoramax exposes a STAC-compatible API for geolocated street-level pictures.

GeoWatch queries two public instances:

- `https://api.panoramax.xyz/api`
- `https://panoramax.openstreetmap.fr/api`

For each event the connector searches a small bbox around the FIRMS coordinate and stores only metadata:

- instance
- picture/item id
- sequence/collection id
- capture datetime
- distance to event
- coordinates
- producer
- horizontal accuracy if available
- thumbnail/self URL when provided by the API

No image analysis is performed.

### OpenAerialMap

The current HOT OpenAerialMap backend is STAC/eoAPI based.

GeoWatch uses:

`https://api.imagery.hotosm.org/stac/search`

with collection:

`openaerialmap`

Stored metadata:

- STAC item id
- acquisition datetime
- platform
- GSD
- bbox
- whether bbox contains the event point
- thumbnail
- image asset URL
- STAC self URL

OpenAerialMap itself describes this collection as open satellite/UAV imagery.

## Runtime

Edge Function:

`firewatch-visual-context`

- recent event window: 72 h
- max refresh: 4 events/run
- cache: 14 days
- external request timeout: 8 s
- cron: every 6 hours at minute 23
- pg_net timeout: 90 s
- exponential retry after total source failure

No-coverage is a valid `active` result with count 0.

## Deep OSINT

`firewatch_deep_osint()` now includes:

`visual_context`

Client Telegram output:

`🖼 Визуальный контекст`

Example with no current coverage:

`Panoramax: 0`
`OpenAerialMap: 0`

If coverage exists, the summary includes count, nearest Panoramax distance and latest OpenAerialMap acquisition date.

Admin output retains the compact technical counts.

## Monitoring

Watchdog v33 adds:

- `VISUAL_CONTEXT_STALE`
- `VISUAL_CONTEXT_ERROR`

The visual context is expected only every 6 hours, so stale threshold is 8 hours.

## Initial production validation

The first production pass processed four high-priority recent events:

- active: 4
- degraded: 0
- errors: 0
- Panoramax items: 0
- OpenAerialMap items: 0

Both sources returned valid empty coverage for those AOIs.

Direct endpoint validation was also performed for:

- `eb9d8ee2`
- `605bfb16`

Panoramax returned empty FeatureCollections and OpenAerialMap returned `numberReturned=0` for the `openaerialmap` collection in those small AOIs.

## Provenance and interpretation

Panoramax and OpenAerialMap are registered as `visual_reference` sources with:

`independent_for_corroboration = false`

Availability of imagery is not event evidence by itself.

A future visual-review stage may promote a manually or algorithmically verified observation into the evidence graph with separate provenance and review status.
