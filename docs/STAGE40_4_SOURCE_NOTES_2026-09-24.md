# Stage 40.4 source notes — 2026-09-24

## GeoNames

Official web-service documentation requires a `username` parameter on each REST request and explicitly says not to use the shared demo account in applications.

GeoNames also publishes downloadable country extracts. For production GeoWatch, the first connector uses the official REST service because it supports small event-scoped queries and avoids loading a country-wide gazetteer into the operational database.

## Overture Maps

Overture publishes cloud-native GeoParquet datasets and a STAC catalog.

Official latest release observed during implementation:

`2026-09-23.0`

The Places theme contains public real-world destinations/facilities and exposes names, categories/taxonomy, confidence, addresses, source provenance and GERS identifiers.

Overture documents known quality limitations for Places, including duplicates, junk and incomplete properties; its confidence field should therefore be retained and displayed as source metadata, not interpreted as probability that a fire event is associated with the place.

## Fused mirror

The Overture documentation lists Fused as a community-maintained data mirror.

GeoWatch uses Fused only as transport for bbox/tile access because Supabase Edge Functions are not a suitable place to embed DuckDB/GeoParquet scanning.

The public Fused UDF tested successfully without an API key. It currently serves the `2026-04-15-0` mirror snapshot for this workflow.

The official Overture STAC catalog remains the source of record for release freshness.
