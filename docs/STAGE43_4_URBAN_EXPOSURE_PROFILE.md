# Stage 43.4 — Urban Exposure Profile

## Goal

Add an explainable urban-context profile on top of Stage 43.3 spatial analytics.

The profile combines:

- JRC GHSL GHS-POP epoch 2025;
- JRC GHSL GHS-BUILT-S epoch 2025;
- OpenStreetMap/Postpass building-footprint counts within 2 km;
- OSM residential / industrial / commercial / retail landuse within 2 km;
- OSM amenity, shop, office and transport activity indicators;
- explicit local counters for residential/commercial/industrial buildings, schools, hospitals/clinics, fuel stations, energy objects and transport;
- forest/wood and agricultural land-use indicators.

## Output

Spatial responses expose the profile at:

`summary.urban_exposure`

Classes:

- `dense_urban`
- `urban`
- `suburban`
- `industrial`
- `forest`
- `agricultural`
- `mixed`
- `rural`
- `unknown`

Every classification includes confidence, source completeness, component scores, raw GHSL metrics, raw OSM context counters and human-readable reasons.

## Geometry semantics

For radius / nearest / settlement searches, GHSL is sampled at the query center.

For route and polygon searches, GHSL is sampled at a representative center calculated from the input vertices.

OSM urban context is intentionally normalized to a fixed **2 km radius around the representative center** for every spatial mode. Building footprints are counted by an aggregate Postpass query; POI / landuse context uses a bounded local query. This avoids downloading thousands of building geometries and makes profiles comparable across searches with different requested radii.

The representative-center rule is explicit in `center_method` and `context_radius_m=2000`. It must not be interpreted as whole-polygon or whole-route population accounting.

## Cache

GHSL is static for the configured epoch, so Stage 43.4 uses a server-side cache keyed by rounded coordinates and profile version.

Table:

`urban_exposure_ghsl_cache`

Public roles have no access. The Edge Function accesses it with server-side service credentials only.

## Safety / interpretation

The Urban Exposure Profile is contextual cartography. It is not a count of persons currently present, building occupancy, damage, casualties, or physical completeness of the territory.

## Latency guard

Urban enrichment is non-critical to the base spatial search.

- GHSL and OSM urban probes are started in parallel.
- Each Urban Exposure Postpass query has a 6 s hard timeout.
- On timeout or source failure the response remains valid and returns a degraded/partial exposure profile from the remaining evidence.
- Urban source degradation does not convert a successful core object search into a hard failure.

This is intentional production hardening after a dense-city acceptance probe showed that downloading generic building geometries could keep the function occupied for too long.
