# Stage 43.3 — Spatial Analytics

## Goal

Add analytical metrics on top of the Stage 43.2 Spatial Query Engine without changing the query model or source semantics.

Stage 43.3 analyzes the **full spatial population inside the requested search geometry** and adds:

- object density;
- concentric distance rings;
- directional sectors;
- ring × sector coverage gaps;
- route segmentation and continuous route gaps;
- polygon area / density;
- category counts per analytical unit.

The user-facing object list remains bounded by the query mode (for example `nearest_n=5` still returns only five objects), while analytics are computed over the full spatial search population.

## Implementation

New module:

`supabase/functions/firewatch-regional-search/regional_spatial_analytics.ts`

Integrated into the existing:

`firewatch-regional-search`

No new Edge Function and no new database schema are required.

The response is exposed at:

`summary.analytics`

## Radius / nearest analytics

For point-centered searches the engine computes:

- study area in km²;
- density `objects / km²`;
- rings:
  - 0–0.5 km;
  - 0.5–1 km;
  - 1–2 km;
  - 2–5 km;
  - 5–10 km;
  - optional 10 km → search limit ring;
- sectors:
  - N;
  - NE;
  - E;
  - SE;
  - S;
  - SW;
  - W;
  - NW;
- category counts per sector;
- empty ring × sector cells;
- empty-cell fraction.

### Important nearest-N semantic

For `nearest` mode:

- `objects` contains only the requested `nearest_n` objects;
- `summary.analytics` is calculated from **all matching objects inside the full search radius**.

This prevents a nearest-5 request from producing a meaningless density based on only five returned rows.

## Route analytics

The route corridor is divided into 5 km along-route segments.

Each segment includes:

- `from_m`;
- `to_m`;
- object count;
- corridor area;
- density;
- category counts.

The route summary includes:

- `gap_segments`;
- `gap_count`;
- `max_gap_m`.

`max_gap_m` means the longest **continuous run** of adjacent empty route segments, not merely the size of one empty segment.

Regression coverage explicitly verifies that consecutive empty 5 km bins merge into one continuous gap.

## Polygon analytics

Polygon area uses the supplied Polygon / MultiPolygon geometry.

Interior rings are subtracted from the exterior ring, so holes do not inflate study area.

The polygon summary exposes:

- area in km²;
- input vertex count;
- density over the corrected polygon area.

## Telegram

Both client and admin spatial search responses now display:

- density and study area;
- ring counts;
- ranked sectors;
- coverage gap count/fraction;
- route 5 km segment counts;
- longest continuous route gap.

The explanatory footer makes clear that density/gaps describe the **mapped public-source objects returned by the configured sources**, not physical completeness of the real territory.

## Web Dashboard

The Stage 43.3 production Dashboard displays spatial analytics from `summary.analytics`.

Public Dashboard commit:

`e6b980777b65c39532b6849f0621ad11c4a5f1c4`

Deployment:

`Deploy GeoWatch Dashboard #36104547374 — SUCCESS`

The recovery copy was synchronized back into FIRMSGeoTools in:

`b2f5324829e7a2aaac43ed478c9d66c9fac4cad1`

Recovery CI:

`Clean Install CI #36105431642 — SUCCESS`

Recovery Dashboard Pages:

`#36105431702 — SUCCESS`

Inline Dashboard JavaScript syntax validation: PASS.

## Regression tests

CI runs:

- `regional_spatial_analytics_test.ts`;
- existing regional spatial tests;
- Edge Function type checks;
- static repository checks;
- release consistency checks.

Important corrective commits:

- `1c084865...` — analyze full nearest search radius;
- `333b431a...` — polygon area with holes;
- `2985f4fd...` — separate nearest output list from analytics population;
- `f3751d8f...` — regression-test full nearest population;
- `9e7d5179...` — continuous route gap length;
- `16f7f466...` — continuous-gap regression test.

Exact Stage 43.3 logic CI before production redeploy:

`Clean Install CI #36104847214 — SUCCESS`

## Production acceptance

Production function after final redeploy:

`firewatch-regional-search ACTIVE v24`

Telegram:

- `firewatch-client ACTIVE v54`;
- `firewatch-admin ACTIVE v100`.

Dashboard proxy:

- `firewatch-dashboard ACTIVE v15`.

### Radius 10 km — Poltava / fuel

Request center:

- 49.5883, 34.5514;
- radius: 10 km.

Result:

- HTTP 200;
- status active;
- returned objects: **55**;
- study area: **314.159 km²**;
- density: **0.175 objects/km²**;
- no truncation.

Rings:

- 0–0.5 km: 0;
- 0.5–1 km: 1;
- 1–2 km: 2;
- 2–5 km: 36;
- 5–10 km: 16.

Sectors:

- N 2;
- NE 1;
- E 1;
- SE 7;
- S 6;
- SW 16;
- W 18;
- NW 4.

Coverage:

- 40 ring × sector cells;
- 27 empty;
- empty fraction 0.675.

### Nearest 5 within 20 km

The API returns exactly **5 nearest objects**.

Analytics uses **63 objects** found within the complete 20 km search radius.

- study area: **1256.637 km²**;
- density: **0.050 objects/km²**;
- coverage cells: 48;
- empty cells: 32;
- empty fraction: 0.667.

This verifies that nearest-N display size no longer contaminates density / ring / sector analysis.

### Polygon with an interior hole

Reference polygon result:

- HTTP 200;
- status active;
- returned objects: **52**;
- corrected polygon area: **764.603 km²**;
- density: **0.068 objects/km²**;
- input vertex count including hole ring: 10.

The interior ring is excluded from area.

### Route corridor

Reference route:

- length: ~75.574 km;
- corridor: ±1 km;
- returned objects: **12**;
- study area: **154.290 km²**;
- density: **0.078 objects/km²**.

5 km segment counts:

- #1 0;
- #2 0;
- #3 0;
- #4 3;
- #5 5;
- #6 3;
- #7 1;
- #8–#16 0.

Gap result:

- empty segments: 12;
- maximum **continuous** empty gap: **40.574 km**.

This is the production regression that closes the bug where adjacent empty 5 km segments previously could be reported as only `max_gap=5 km`.

## Signed Dashboard acceptance

Signed `action=regional` radius-10-km request:

- HTTP 200;
- status active;
- objects 55;
- density 0.175 objects/km²;
- empty ring × sector cells 27.

The signed Dashboard therefore receives the same Stage 43.3 analytics as the direct backend.

## Bot health

Post-acceptance bootstrap:

- client HTTP 200;
- admin HTTP 200;
- admin webhook pending updates: 0;
- admin webhook last error: null.

## Status

**CLOSED / PRODUCTION READY — 2026-09-25.**
