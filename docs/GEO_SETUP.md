# Geography setup

A major goal of FIRMSGeoTools is to remove any dependency on one country.

## Geography model

The clean install supports two levels:

1. **AOI (Area of Interest)** — required.
2. **Administrative subdivisions** — optional but recommended.

### AOI

AOI decides whether an incoming FIRMS point belongs to the monitored territory.

Supported target geometry types:

- Polygon;
- MultiPolygon.

Coordinate reference system must be WGS84 / EPSG:4326.

Point inclusion uses PostGIS `ST_Covers`, not `ST_Contains`, so detections exactly on the boundary are not silently discarded.

## Minimal install

For a simple monitoring area, provide only:

```text
config/aoi.geojson
```

All events will belong to the project-level AOI without regional subdivision.

## Regional statistics

To obtain region/oblast/state/province statistics, provide an ADM1 GeoJSON dataset.

Every ADM1 feature should contain a stable identifier and display name.

The importer will normalize the features into the database.

## Bounding box

FIRMS Area API requires a bbox.

The installer must derive the bbox automatically from your AOI geometry and add a small configurable margin.

Do not hand-code country bbox constants into Edge Functions.

## Validation

Before enabling monitoring the installer must check:

- valid geometry;
- SRID 4326;
- non-empty geometry;
- no invalid self-intersections;
- ADM1 polygons fit within or reasonably overlap AOI;
- no unexpected large overlaps between ADM1 polygons;
- bbox covers the entire AOI.

## Example

The example polygon in `config/aoi.example.geojson` is intentionally generic and is not tied to any real deployment.

## Production safety rule

Never replace administrative boundaries automatically from a secondary dataset.

Boundary changes must be reviewed because different providers can disagree on coastal or disputed administrative geometries.
