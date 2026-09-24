# Stage 40.5 visual-source notes — 2026-09-24

## Panoramax

Current Panoramax backend documentation states that its HTTP API follows the STAC API specification and exposes collections, items and metadata.

Picture search is available through `/api/search`; the web-viewer API also provides helpers for pictures around coordinates.

Picture metadata may include:

- capture datetime
- producer
- horizontal accuracy
- thumbnails
- related nearby pictures
- semantic tags

GeoWatch currently stores metadata only.

## OpenAerialMap

The current HOT OpenAerialMap repository documents a revamped backend based on STAC FastAPI PgSTAC/eoAPI.

Production STAC endpoint verified:

`https://api.imagery.hotosm.org/stac/`

The catalog contains an `openaerialmap` collection with CC-BY-4.0 metadata and visual imagery assets.

The catalog also includes non-OAM collections such as Copernicus DEM and Maxar Open Data. GeoWatch therefore explicitly filters:

`collections=openaerialmap`

to avoid incorrectly presenting DEM or other catalog content as OpenAerialMap visual imagery.

## Design rule

Visual availability and visual verification are separate concepts.

Stage 40.5 only establishes whether reference imagery exists. No statement about fire, damage, cause, target or attribution is created from availability alone.
