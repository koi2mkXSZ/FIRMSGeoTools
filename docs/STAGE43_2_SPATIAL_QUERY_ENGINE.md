# Stage 43.2 — Spatial Query Engine

## Goal

Extend the existing regional object engine into a single dynamic spatial query engine without creating a second category/search stack.

Stage 43.2 reuses:

- Stage 43.1 category resolver and multi-category planner;
- safe brand/operator/address/source/confidence/address-presence filters;
- OpenStreetMap/Postpass inventory;
- Wikidata QID enrichment;
- settlement/address enrichment;
- entity resolution;
- CSV / GeoJSON output;
- both Telegram bots;
- signed Web Dashboard proxy.

Dynamic spatial queries are intentionally not stored in the 12-hour regional cache.

## Supported spatial modes

### Radius

Objects inside a metric radius around a point.

```json
{
  "query": "АЗС",
  "spatial": {
    "mode": "radius",
    "lat": 49.5883,
    "lon": 34.5514,
    "radius_m": 5000
  }
}
```

Returned objects include `distance_m`.

Limits: 100 m to 50 km.

### Nearest N

Nearest N objects within a bounded search radius.

```json
{
  "query": "АЗС",
  "spatial": {
    "mode": "nearest",
    "lat": 49.5883,
    "lon": 34.5514,
    "nearest_n": 5,
    "search_radius_m": 20000
  }
}
```

Limits:

- N: 1..100;
- search radius: 0.5..100 km.

Objects are returned in ascending `distance_m`.

### Settlement / city / town

Resolve a public OSM place by name, then execute a bounded radius query around its center.

```json
{
  "query": "АЗС",
  "spatial": {
    "mode": "city",
    "name": "Полтава",
    "radius_m": 10000
  }
}
```

If radius is omitted, the Stage 43.1 place-type fallback is used.

The radius is an explicitly approximate geometric search zone and is not represented as an administrative settlement boundary.

### Polygon

Objects whose representative point is inside a GeoJSON Polygon or MultiPolygon.

Limits:

- maximum 500 coordinates;
- maximum polygon bounding-box area 75,000 km².

Polygon holes are respected.

### Route corridor

Objects within a metric corridor around a LineString / coordinate route.

```json
{
  "query": "АЗС",
  "spatial": {
    "mode": "route",
    "route": [[34.40,49.55],[34.75,49.62]],
    "corridor_m": 2000
  }
}
```

Returned route metadata:

- `route_distance_m` — shortest distance to route;
- `route_along_m` — approximate distance from route start;
- `route_segment`.

Limits:

- maximum 200 route points;
- maximum route length 1000 km;
- corridor 100 m..20 km;
- maximum 16 source-query windows.

Long routes are split into bounded Postpass query windows instead of using one oversized bbox.

## Exact Ukraine gate

The first implementation loaded every oblast GeoJSON into Edge memory. Production smoke exposed a real `WORKER_RESOURCE_LIMIT`.

Stage 43.2 therefore uses the database as the spatial authority.

Migration `0040_stage43_2_spatial_gate.sql` adds:

`public.firewatch_spatial_gate(p_points jsonb)`

For each supplied point the RPC uses:

`ST_Covers(public.oblasts.geom, ST_SetSRID(ST_MakePoint(lon,lat),4326))`

and returns the matching oblast metadata.

Properties:

- maximum 15,000 points per database RPC batch;
- Edge orchestration chunks larger candidate sets into 10,000-point batches, so settlement enrichment up to its 20,000-candidate source limit cannot overflow the RPC cap;
- SECURITY INVOKER;
- `anon`: no EXECUTE;
- `authenticated`: no EXECUTE;
- `service_role`: EXECUTE.

The gate is applied to:

- user-supplied spatial vertices;
- OSM object candidates;
- OSM settlement/place candidates.

Thus spatial source bboxes may overlap outside Ukraine, but returned object candidates must pass the exact PostGIS oblast geometry gate.

## Telegram commands

Available in both client and admin bots:

```text
/objects_near <lat> <lon> <radius_km> <object>
/objects_nearest <lat> <lon> <N> <search_km> <object>
/objects_city <city> | [radius_km] | <object>
/objects_polygon <object> | lat,lon;lat,lon;lat,lon...
/objects_route <object> | <corridor_km> | lat,lon;lat,lon...
```

Examples:

```text
/objects_near 49.5883 34.5514 5 АЗС
/objects_nearest 49.5883 34.5514 5 20 АЗС
/objects_city Полтава | 10 | АЗС
/objects_polygon АЗС | 49.53,34.45;49.53,34.65;49.65,34.65;49.65,34.45
/objects_route АЗС | 2 | 49.55,34.40;49.62,34.75
```

The same object filters and multi-category syntax remain available inside the object expression.

## Web Dashboard

The Stage 43.2 Dashboard exposes one search UI with modes:

- Oblast;
- Radius;
- Nearest N;
- City / settlement;
- Polygon;
- Route corridor.

It adds:

- lat/lon;
- radius / route corridor;
- nearest N;
- city/settlement name;
- coordinate-list editor for polygon/route;
- distance and route-distance display;
- map overlay for radius, polygon and route;
- existing adaptive object clustering;
- CSV and GeoJSON download.

The browser never receives `service_role`.

Signed Dashboard requests pass `spatial` through the existing HMAC-protected `firewatch-dashboard` proxy.

## Export

Stage 43.2 CSV adds:

- Distance m;
- Route distance m;
- Route along m;
- Route segment.

GeoJSON Feature properties contain the corresponding fields.

## Production smoke

Reference point: Poltava, 49.5883 / 34.5514.

### Radius 5 km

- HTTP 200;
- status active;
- 39 resolved objects;
- 44 OSM candidates after Ukraine gate;
- truncated=false;
- exact oblast: UA53;
- output includes `distance_m`.

### Nearest 5 within 20 km

- HTTP 200;
- status active;
- exactly 5 returned objects;
- 63 OSM candidates;
- sorted by distance;
- truncated=false.

### City / settlement

`Полтава`, explicit radius 10 km:

- HTTP 200;
- status active;
- 55 objects;
- 57 OSM candidates;
- target resolved to Полтава;
- truncated=false.

### Polygon

Reference rectangle around Poltava:

- HTTP 200;
- status active;
- 50 objects;
- 50 OSM candidates;
- truncated=false.

### Route

Reference route length 26.405 km, corridor ±2 km:

- HTTP 200;
- status active;
- 27 objects;
- 57 OSM candidates;
- truncated=false;
- output includes route distance / along-distance / segment.

Warm radius / nearest / polygon / route requests were approximately 1.6–1.9 seconds in Edge logs.
City name resolution may be slower because it first performs a public OSM place lookup.

## Export acceptance

Nearest CSV:

- HTTP 200;
- 5 data rows;
- `text/csv; charset=utf-8`;
- contains `Distance m`.

Route GeoJSON:

- HTTP 200;
- 27 features;
- `application/geo+json; charset=utf-8`;
- features contain `route_distance_m`.

## Security acceptance

- direct unauthenticated regional/spatial request: HTTP 401;
- spatial RPC callable only by `service_role`;
- signed Dashboard proxy returns the same nearest-N result as the direct backend;
- invalid/outside-Ukraine geometry is rejected before object inventory is returned.

## Recovery

Schema version: 40.

Migration:

- `0040_stage43_2_spatial_gate.sql`.

No new Edge Function was introduced; Stage 43.2 extends `firewatch-regional-search`.

Production Dashboard and recovery copy are synchronized.

## Final production acceptance — CLOSED

Final production versions:

- `firewatch-regional-search`: ACTIVE **v22**;
- `firewatch-client`: ACTIVE **v52**;
- `firewatch-admin`: ACTIVE **v98**;
- `firewatch-dashboard`: ACTIVE **v15**;
- schema version: **40**.

Exact-main hardening:

- Edge spatial gate now chunks candidate sets in 10,000-point batches before calling the 15,000-point RPC;
- client/admin help is labeled Stage 43.2 and exposes all spatial commands;
- Clean Install CI for exact code head `46b762086054e5d3391167230baf001e3d1b16b0`: **SUCCESS #36094543246**;
- Supabase Security Advisor: no finding related to Stage 43.2 spatial gate.

Post-deploy v22 data-plane smoke:

- Radius 5 km, Poltava: HTTP 200, active, **39** objects, 44 OSM candidates, no truncation.
- Nearest 5 within 20 km: HTTP 200, active, **5** objects, sorted distances 837 / 1156 / 1578 / 2095 / 2457 m.
- City Poltava, 10 km: HTTP 200, active, **55** objects, target OSM city resolved exactly.
- Reference polygon: HTTP 200, active, **50** objects.
- Reference route, corridor ±2 km: HTTP 200, active, **27** objects, route length ~26.405 km.
- All successful spatial responses report `ukraine_gate=batch_postgis_st_covers`.
- Invalid radius 100 km: **HTTP 400**, `radius_m must be 100..50000`.
- Point outside Ukraine: **HTTP 400**, `spatial input contains point outside Ukraine`.
- Direct unauthenticated request: **HTTP 401**.

Post-deploy export smoke:

- nearest CSV: HTTP 200, `text/csv; charset=utf-8`, **5 data rows**, includes `Distance m`;
- route GeoJSON: HTTP 200, `application/geo+json; charset=utf-8`, **27 features**, includes `route_distance_m`.

Signed Dashboard acceptance:

- HMAC-signed `action=regional` nearest-N request: HTTP 200;
- returns the same **5** objects and the same sorted distances as the direct backend;
- public Dashboard commit `6d1cb51d115b3bdf9b3893f5dd7cc7b6d1db5103`;
- Pages deployment **#36093623986 SUCCESS**;
- inline Dashboard JavaScript syntax check: PASS;
- public and recovery Dashboard copies are byte-identical.

Telegram acceptance:

- client bootstrap: HTTP 200, webhook enabled, pending updates 0, last error null;
- admin health: HTTP 200, webhook enabled, pending updates 0, last error null;
- admin command registry: `commands_v20=true`;
- both bot code paths expose `/objects_near`, `/objects_nearest`, `/objects_city`, `/objects_polygon`, and `/objects_route`.

Performance observation on v22:

- warm radius/nearest/polygon/route requests are approximately 1–2 seconds;
- city-name mode may take longer because it performs a public OSM place lookup first; one acceptance request took ~17.4 seconds, still within the 90-second caller budget.

## Status

**CLOSED / production-ready — 2026-09-25.**
