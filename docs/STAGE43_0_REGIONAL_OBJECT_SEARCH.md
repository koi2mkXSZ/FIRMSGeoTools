# Stage 43.0 — Regional Object Search

## Goal

Search public-source objects by a full Ukrainian oblast polygon and category, rather than by a point/radius.

Primary examples:

- `/objects Полтавская область АЗС`
- `/objects Київська аптеки`
- `/objects Львівська школы`
- `/objects_csv Полтавская область АЗС`

## Supported categories

- `fuel` — АЗС / fuel stations
- `hospital` — hospitals and clinics
- `pharmacy` — pharmacies
- `school` — schools, universities, colleges and kindergartens
- `fire_station` — fire stations
- `police` — police
- `energy` — power infrastructure
- `industrial` — industrial sites
- `warehouse` — warehouses
- `supermarket` — supermarkets
- `telecom` — telecom infrastructure
- `transport` — transport hubs

Russian, Ukrainian and English aliases are accepted by the Edge Function and Telegram parsers.

## Geometry

The authoritative search boundary is `public.oblasts.geom`.

`firewatch_oblast_geometry(oblast_id)` returns the oblast bbox, point-on-surface center and GeoJSON polygon/multipolygon. The backend first limits source queries by bbox and then applies point-in-polygon filtering against the full oblast geometry.

This prevents bbox-only leakage into neighboring oblasts.

## Sources

### OpenStreetMap / Geofabrik Postpass

OSM/Postpass is the primary region-wide inventory source in Stage 43.0.

Category predicates are static whitelisted SQL fragments; user text is never interpolated as SQL.

Raw Postpass candidate limit: 7000. Output limit: 5000. If either limit is reached, the response is marked `degraded` / `truncated` instead of being presented as complete.

### Wikidata

Wikidata is used as QID enrichment for OSM objects that already carry a `wikidata=Q...` identifier. It adds labels/descriptions and enables exact-identifier cross-source resolution.

### Overture

Overture is `not_applicable` for region-wide Stage 43.0 v1.

The public Fused Overture example uses `min_zoom=12` for the places theme. Low-zoom regional tile requests return spatial partition metadata rather than POIs, while enumerating an entire oblast at z12 would require an excessive number of tile requests. Stage 43.0 therefore does not claim Overture coverage where it cannot provide real regional POIs.

Point/radius Stage 42 Area Intelligence continues to use Overture in its supported small-radius mode.

## Cross-source resolution

Objects are resolved with:

1. exact Wikidata QID when shared;
2. conservative normalized-name + short-distance matching;
3. otherwise separate single-source entities.

Each result carries:

- canonical name;
- brand/operator where available;
- settlement/address where tagged;
- latitude/longitude;
- source IDs and public source URLs;
- source count;
- resolution status;
- confidence;
- Wikidata QID when available.

## Cache

`public.regional_object_search_cache` stores a result per:

`<oblast-code>:<category-key>`

TTL: 12 hours.

The cache is service-role-only and is not exposed to browser clients.

## Edge Function

`firewatch-regional-search`

Custom authorization accepts only:

- service-role bearer;
- or a valid GeoWatch cron secret.

Direct unauthenticated requests return HTTP 401.

The function can return JSON or CSV (`format: csv`).

## Telegram

Both admin and client bots support the same regional search functionality:

- `/objects <область> <категория>` — summary + first 20 objects;
- `/objects_csv <область> <категория>` — full cached CSV.

The client keyboard includes `🏭 Объекты области`. The admin panel includes the same help entry.

## Web Dashboard

The production `GeoWatch-Dashboard` adds a Regional Object Search section with:

- oblast text field;
- category selector;
- result summary;
- table;
- markers on the existing Leaflet map;
- CSV export.

The signed Dashboard API exposes `action=regional` and proxies the request internally to `firewatch-regional-search`. Service-role credentials are never sent to browser JavaScript.

## Production acceptance — 2026-09-24

Poltava fuel-station search:

- query: `Полтавская область` + `АЗС`;
- HTTP 200;
- status `active`;
- 300 resolved objects;
- 300 OSM objects;
- 1 Wikidata enrichment;
- 1 multi-source entity;
- `truncated=false`;
- Overture explicitly `not_applicable` in region-wide v1;
- polygon validation: 300 inside / 0 outside;
- initial fresh execution before Overture semantic correction: ~18.4 s;
- subsequent region-wide implementation avoids unnecessary Overture tile enumeration.

Generic-category smoke:

- query: `Полтавська` + `аптеки`;
- HTTP 200;
- status `active`;
- 413 resolved objects;
- `truncated=false`.

CSV smoke:

- HTTP 200;
- `Content-Type: text/csv; charset=utf-8`;
- UTF-8 BOM + header + full cached result.

Security:

- unauthenticated Edge request: HTTP 401;
- cache SELECT: anon=false, authenticated=false, service_role=true;
- helper RPC EXECUTE: anon=false, authenticated=false, service_role=true;
- Security Advisor only reports the expected informational RLS-without-policy notice for the backend-only cache table.

Production deployment:

- `firewatch-regional-search` ACTIVE v2;
- `firewatch-client` ACTIVE v42;
- `firewatch-admin` ACTIVE v87;
- `firewatch-dashboard` ACTIVE v12;
- client webhook bootstrap healthy, pending=0;
- admin webhook health healthy, pending=0;
- production `GeoWatch-Dashboard` Pages deployment for Stage 43.0 succeeded;
- production inline Dashboard JavaScript passed syntax validation;
- recovery Dashboard copy synchronized back into FIRMSGeoTools.

## Completeness semantics

`resolved_objects` means all objects found by the configured public sources and filters within the exact oblast polygon at query time. It is not a guarantee that every physically existing object is mapped in the public sources.

The response exposes `source_status`, `errors`, and `truncated` so callers can distinguish a healthy inventory from a partial one.

## Status

**CLOSED / production-ready — 2026-09-24.**
