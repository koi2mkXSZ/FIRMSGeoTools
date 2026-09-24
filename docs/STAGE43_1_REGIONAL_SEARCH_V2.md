# Stage 43.1 — Regional Search v2

## Goal

Upgrade region-wide object search from a category inventory into a reusable regional query engine with:

- multi-category queries;
- safe filters;
- settlement/address normalization;
- count and explain modes;
- adaptive map clustering;
- enriched CSV and GeoJSON export.

The Stage 43.0 invariant remains unchanged: all candidate objects are constrained to the exact `public.oblasts.geom` polygon before they are returned.

## Query examples

```text
/objects Полтавская область АЗС
/objects Полтавская область АЗС + нефтебазы + резервуары
/objects Полтавская область АЗС brand:WOG
/objects Полтавская область АЗС city:Полтава
/objects Полтавская область АЗС source:OSM confidence:90 has_address:yes

/objects_count Полтавская область АЗС brand:WOG
/objects_explain Полтавская область трансформаторные подстанции 110 кВ
/objects_csv Полтавская область АЗС
/objects_geojson Полтавская область АЗС
```

The same query model is exposed in the signed Web Dashboard.

## Multi-category planner

Categories may be combined with `+`.

Each expression is resolved independently through the Stage 43 category resolver. The resulting OSM/Postpass category queries run independently and partial source failures do not discard successful category results.

Duplicate OSM IDs are merged and retain all matched `category_keys`.

Entity resolution only performs probabilistic name-distance merging between records that share at least one requested category. Exact shared Wikidata QIDs may still merge across category labels.

## Filters

Supported filters include:

- `city:`, `town:`, `settlement:`, `город:`, `місто:`;
- `brand:` / `бренд:`;
- `operator:` / `оператор:`;
- `address:` / `адрес:`;
- `source:` / `src:` / `источник:` / `джерело:`;
- `confidence:` / `conf:` / `min_confidence:`;
- `has_address:yes|no`.

Brand/operator/address predicates are pushed down to the whitelisted OSM/Postpass query where possible.

Settlement, source, confidence and address-presence constraints are applied after object normalization, so they also work with inferred settlements and cross-source metadata.

User input is not interpolated as arbitrary SQL. Only static category predicates and escaped whitelisted filter values are used.

## Settlement normalization

Stage 43.1 does not invent street addresses.

Existing OSM address fields are normalized as:

1. `addr:full` when present;
2. otherwise `addr:street + addr:housenumber`.

For objects without a settlement tag, the backend loads OSM `place=city|town|village|hamlet` candidates within the oblast polygon and assigns the nearest public OSM place up to 25 km.

Each result records provenance:

- `settlement_method=osm_addr` — settlement supplied by the object tags;
- `settlement_method=osm_nearest` — nearest-place inference;
- `settlement_distance_m`;
- `settlement_place`;
- `settlement_source_id`;
- `normalized_location`;
- `address_quality=complete|address_only|settlement_only|coordinates_only`.

The response summary exposes direct / inferred / missing settlement counts.

## Explicit settlement filter

A query such as `city:Полтава` first resolves the requested OSM place.

When an administrative settlement polygon is not available in the regional dataset, the query uses an explicitly reported approximate radius fallback:

- city: 15 km;
- town: 9 km;
- village: 4.5 km;
- hamlet: 2.5 km;
- unknown place type: 7 km.

This mode is returned as `summary.settlement_filter.mode=radius_fallback` with the matched target, place type, radius and name score.

It must not be interpreted as the legal/administrative boundary of the settlement.

If a settlement target cannot be resolved safely, the engine falls back to enriched settlement-name matching.

## Count / Explain

`count_only=true` returns the resolved count without returning the object array.

`explain=true` resolves:

- oblast;
- requested categories;
- category-resolution mode and confidence;
- filters;
- source plan;

without executing external object-source inventory queries.

## Cache

Stage 43.1 enriched results use cache version `r43_1_3` in the query key, preventing stale Stage 43.0/early-43.1 rows from being served as enriched results.

TTL remains 12 hours.

Count-only requests are not persisted as full object-cache rows.

## Export

### CSV

CSV contains:

- number;
- name;
- category keys;
- brand/operator;
- settlement;
- settlement method and distance;
- address;
- address quality;
- normalized location;
- coordinates;
- sources;
- source count;
- resolution status/confidence;
- Wikidata QID.

### GeoJSON

The backend supports `format=geojson` and returns an RFC 7946-style `FeatureCollection` with Point geometry and enriched object properties.

Both Telegram bots expose `/objects_geojson`.

The Web Dashboard provides local CSV and GeoJSON download from the currently displayed signed result.

## Dashboard

The production dashboard includes:

- oblast input;
- free-form/multi-category input;
- settlement, brand, operator, address, source, confidence and address-presence filters;
- Search / Count / Explain;
- CSV / GeoJSON export;
- enriched settlement/address quality in the result table;
- category badges;
- adaptive map clustering.

Clustering is implemented in the existing Leaflet map without loading an additional third-party clustering library. Grid size changes with map zoom; cluster click zooms into the group.

## Production acceptance

### Base Poltava fuel inventory

Fresh Stage 43.1 query:

`Полтавская область АЗС`

Result:

- HTTP 200;
- status `active`;
- 300 resolved objects;
- 300 OSM objects;
- 1 Wikidata enrichment;
- `truncated=false`;
- 3053 OSM settlement candidates;
- settlement direct: 9;
- settlement inferred: 291;
- settlement missing: 0;
- objects with address: 80.

### Multi-category

Fresh query:

`Полтавская область АЗС + нефтебазы`

Result:

- HTTP 200;
- status `active`;
- 303 resolved objects;
- 2/2 Postpass category queries successful;
- by category: fuel 300, oil-depot semantic hint 3;
- settlement inferred: 294;
- settlement missing: 0;
- `truncated=false`.

### Filters

`Полтавская область АЗС source:OSM confidence:100 has_address:yes`

Count result:

- 80 matches;
- HTTP 200;
- status `active`.

### Settlement filter

`Полтавская область АЗС city:Полтава`

With Stage 43.1 radius fallback:

- HTTP 200;
- status `active`;
- 61 matches;
- matched target: Полтава;
- OSM place type: city;
- radius fallback: 15 km;
- name score: 1.0.

The response explicitly states that this is not an administrative city boundary.

### Export

Backend GeoJSON smoke:

- HTTP 200;
- `Content-Type: application/geo+json; charset=utf-8`;
- 300 Point features for the cached Poltava fuel inventory.

Backend CSV smoke:

- HTTP 200;
- `Content-Type: text/csv; charset=utf-8`;
- enriched Stage 43.1 header and 300 rows.

### Security

Direct unauthenticated regional-search request returns HTTP 401.

Dashboard access remains HMAC-signed and proxies to the service-role protected regional backend; service-role credentials are never sent to browser JavaScript.

## Final production acceptance

- `firewatch-regional-search`: ACTIVE v18.
- `firewatch-client`: ACTIVE v49.
- `firewatch-admin`: ACTIVE v95.
- `firewatch-dashboard`: ACTIVE v13.
- Database schema remains v39; Stage 43.1 requires no new schema migration.
- Client bot bootstrap: HTTP 200, webhook enabled, pending updates 0, last error null.
- Admin bot health: HTTP 200, webhook enabled, pending updates 0, last error null.
- Admin command registry is at `commands_v19=true`; both bot menus include `/objects_geojson`.
- Signed Dashboard Stage 43.1 settlement-filter smoke: HTTP 200, 61 matches, `radius_fallback=15 km`.
- Direct unauthenticated regional backend request: HTTP 401.
- Current `r43_1_3` Poltava fuel export: CSV 300 data rows; GeoJSON 300 Point features.
- Production Dashboard commit: `7f0b892be0919ffc1a9e271d0a610f0b0e0f7e72`.
- Production Dashboard Pages deployment: #36041984618 SUCCESS.
- Dashboard inline JavaScript syntax validation: PASS.
- Recovery Dashboard synchronized to FIRMSGeoTools in `f54c7667a4f428f72f53ec9be3fbee886d91b759`.
- Exact recovery/source CI on that synchronized commit: #36042132813 SUCCESS.

## Status

**CLOSED / production-ready — 2026-09-24.**
