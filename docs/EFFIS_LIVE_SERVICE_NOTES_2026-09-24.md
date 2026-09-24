# EFFIS live service notes — 2026-09-24

Live GetCapabilities was retrieved directly from:

`https://maps.effis.emergency.copernicus.eu/effis?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1`

Observed service metadata:

- service title: EFFIS
- fees: none
- access constraints: none
- GetMap supports PNG/JPEG/TIFF and additional formats
- GetFeatureInfo supports HTML, GML and plain text

Observed queryability:

- `mf010.fwi`: queryable=0
- `mf010.query`: queryable=1
- `all.hs.query`: queryable=1
- `effis.nrt.ba.poly`: queryable=1

The `effis.nrt.ba.poly` live abstract states that the near-real-time burnt-area product is derived from clustering VIIRS thermal-anomaly detections and is updated at each acquisition cycle.

Implementation rule: treat EFFIS WMS as an optional external dependency with cache, timeout and circuit breaker. Never block primary event ingestion or Telegram delivery on EFFIS availability.
