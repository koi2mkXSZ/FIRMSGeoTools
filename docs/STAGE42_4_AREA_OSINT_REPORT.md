# Stage 42.4 — Area OSINT Report

The shared /area command now produces a fused area report for coordinates or a FIRMS event ID.

Examples:
- /area 46.61212 31.55511 5000
- /area 19be809d 5000

Default radius is 5 km. /infra remains the fast infrastructure-only mode.

The report fuses OSM/Postpass infrastructure, Overture when applicable, Wikidata/entity resolution, top entity profiles, official/registry references, JRC GHSL exposure, local spatial OSINT, and coverage status.

New backend cache: area_osint_reports, 6-hour cache.
New Edge Function: firewatch-area-report v2.
GHSL now accepts internal service-role bearer in addition to cron-secret auth for coordinate probe mode.

Production smoke:
- 19be809d / 2 km: active, errors 0, coverage 6/6, 91 entities, 3 multi-source, 1 confirmed registry hit.
- 19be809d / 5 km: active, errors 0, coverage 5/5 applicable; Overture radius_limited and excluded from denominator.
- GHSL sample: population ~4,419 / 14,473 / 18,385 within 1/5/10 km; built fraction ~20.19% / 2.98% / 1.16%.

Area OSINT spatial search uses PostGIS ST_DWithin/ST_Distance over the ingested GeoWatch corpus. Spatial proximity does not establish causation or operational significance.
