# Stage 42.5 — Map / Graph UI

## Goal

Expose the Stage 42 entity-resolution and Area OSINT context in the signed read-only Web Dashboard without exposing service-role credentials.

For a selected fire event, the dashboard now combines the existing event/timeline view with:

- active Evidence Graph from Stage 40.7;
- Deep OSINT and review context;
- Area Entity Graph;
- nearby resolved entity markers on the Leaflet map;
- entity cards with cross-source provenance;
- public source links from cached entity profiles;
- official registry references;
- configurable 1 / 2 / 5 / 10 km Area Report radius.

## Dashboard API

`firewatch-dashboard` adds signed action `POST ?action=area`.

Body example: `{ "id": "<event-id>", "radius_m": 2000 }`.

The Dashboard Edge Function invokes `firewatch-area-report` internally with the service-role bearer. The browser never receives the service-role key.

The response intentionally exposes only the read-only Area UI package: report/cache status, center/radius, source coverage, entity summary, top resolved entities and per-source match provenance, cached entity profiles and public HTTPS links, official registry references, source status/errors/runtime.

## Area Entity Graph

The graph is descriptive context only:

`event center → resolved entity → source / official registry`

Edges encode spatial context (`nearby_context`), entity-resolution provenance (`single_source`, `name_distance`, etc.), and registry reference status/confidence.

The graph does not imply causation, impact, vulnerability or operational significance.

## Map

Selecting an event overlays the Area Report radius, event center, up to 10 top resolved entities, and Stage 40.7 GeoNames / Overture context where available. Entity markers are colored by broad category and use a larger marker for multi-source entities.

## Entity cards

Cards show canonical name, category/subcategory, distance from report center, resolution status/confidence, source count, source ID, match method/confidence, public entity-profile links, and official registry references.

Only HTTPS profile/registry links are rendered as clickable links.

## Production synchronization

The recovery/source copy lives in `FIRMSGeoTools/docs/dashboard/index.html`.

The actual public dashboard lives in the separate production repository `koi2mkXSZ/GeoWatch-Dashboard`.

Stage 42.5 synchronizes both copies to prevent the drift discovered during implementation.

## Acceptance

- `firewatch-dashboard` ACTIVE v11.
- Signed `action=area` smoke for event `19be809d`, radius 2 km: HTTP 200.
- Response: `cached=true`, `status=active`, coverage 6/6.
- Area payload contains resolved entities, profile provenance and one confirmed official registry hit.
- FIRMSGeoTools Clean Install CI passed on the Stage 42.5 API/UI commit.
- Production `GeoWatch-Dashboard` Pages deployment is required to pass before closing the stage.

## Security

The dashboard remains read-only and HMAC-link protected.

`firewatch-area-report` is not exposed by weakening its authorization. `firewatch-dashboard` performs the internal authenticated call after validating the signed Dashboard URL.

No service-role key, Vault secret or internal database credential is sent to browser JavaScript.
