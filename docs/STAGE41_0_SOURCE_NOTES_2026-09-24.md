# Stage 41.0 source notes — 2026-09-24

## RainViewer

Current public Weather Maps API:

`https://api.rainviewer.com/public/weather-maps.json`

The API returns recent radar frame times and tile paths.

Current public documentation states that the free Weather Maps API keeps approximately two hours of past radar frames and no longer exposes free nowcast after the 2025/2026 transition.

The integration therefore polls and archives frame metadata instead of relying on querying an old event after FIRMS reports it.

## EUMETSAT MTG Lightning Imager

Verified operational collection:

- title: LI Lightning Flashes - MTG - 0 degree
- collection ID: `EO:EUM:DAT:0691`
- product type: `MTILI2LFL`
- processing mode: NRT
- processing level: Level 2
- spatial resolution stated by EUMETSAT: 4 km
- data policy: free and unrestricted / CC-BY-4.0

The OpenSearch endpoint accepted time and bbox filters without authentication.

A test around event `19be809d` at 2026-09-24 01:07 UTC returned eight LI products in the 00:30–01:30 search interval.

Search metadata includes product download, quicklook and NetCDF entry links.

EUMETSAT documentation states that programmatic Data Store downloads use ConsumerKey/ConsumerSecret access tokens. GeoWatch does not treat product availability as a local lightning observation until that authenticated extraction step is implemented.
