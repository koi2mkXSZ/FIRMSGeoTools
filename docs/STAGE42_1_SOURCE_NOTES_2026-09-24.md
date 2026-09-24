# Stage 42.1 source notes — 2026-09-24

Wikidata supports geospatial search through its Query Service, including the `wikibase:around` extension.

During production testing, WDQS returned valid data but showed intermittent request timeouts from Supabase Edge Runtime.

A more stable production route was verified:

1. Wikimedia geosearch around latitude/longitude
2. page lookup with `pageprops.wikibase_item`
3. use the returned Q-ID as the canonical Wikidata identifier

This route is keyless and returned HTTP 200 during production validation around Ochakiv.

The integration intentionally filters obvious historical-event and list pages so that current area/infrastructure context is not polluted by battles, sieges or list articles sharing the same geography.
