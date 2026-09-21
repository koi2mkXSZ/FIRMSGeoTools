# Clean Core v0.1

This is the first parameterized extraction of the production FIRMS monitoring core.

## What is already generic

- no country-specific bbox;
- no production Supabase project reference;
- no fixed administrative region names;
- AOI is loaded from user GeoJSON;
- regions are optional user GeoJSON;
- FIRMS bbox is calculated from enabled AOI geometries;
- one FIRMS worker handles NOAA-20, NOAA-21, Suomi NPP and MODIS;
- per-source resolution and event radius live in the database.

## Database configuration

`project_config` stores non-secret settings.

`monitoring_areas` stores one or more AOI polygons.

`regions` stores optional ADM1/state/province/county polygons.

`firms_sources` controls enabled FIRMS sources and matching radii.

## Geography import RPC

The installer calls:

```sql
select public.firewatch_set_geography(:aoi_geojson, :regions_geojson);
```

The AOI must be a GeoJSON FeatureCollection containing Polygon/MultiPolygon geometries.

Regions are optional.

## Runtime configuration

The FIRMS worker calls:

```sql
select public.firewatch_runtime_config();
```

It receives the bbox and enabled source configuration at runtime.

## Current limitations

This v0.1 core extraction does not yet include the complete Telegram renderer/admin/dashboard/recovery stack.

Those modules will be added after their production code has been parameterized and tested against this generic schema.
