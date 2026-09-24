# Stage 42.4 — Area OSINT Report

The shared /area command produces a fused area report for coordinates or a FIRMS event ID.

Examples:
- /area 46.61212 31.55511 5000
- /area 19be809d 5000

Default radius is 5 km. /infra remains the fast infrastructure-only mode.

The report fuses OSM/Postpass infrastructure, Overture when applicable, Wikidata/entity resolution, top entity profiles, official/registry references, JRC GHSL exposure, local spatial OSINT, and coverage status.

Backend cache: area_osint_reports, 6-hour TTL.
Area OSINT time window: fixed 168 hours so cache semantics are deterministic.
Edge Function: firewatch-area-report.
GHSL accepts internal service-role bearer in addition to cron-secret auth for coordinate probe mode.

## Production hardening

- Initial independent layers (area intelligence, GHSL and local spatial OSINT) execute concurrently.
- Entity-profile and registry enrichment execute concurrently after entity resolution.
- Per-layer timeouts keep the orchestrator inside the Telegram caller budget.
- Partial layer failures are reported as degraded instead of being mislabeled active.
- Local OSINT and official/registry coverage statuses reflect actual layer failures.
- Handler-level exceptions always return structured JSON.
- Cache read errors are surfaced instead of silently behaving as misses.
- SQL cache-key formatting is byte-compatible with JavaScript toFixed(5), including trailing zeroes.
- SECURITY DEFINER helper RPCs are executable only by service_role; anon/authenticated access remains revoked.
- Stage 42 Edge Functions are included in GitHub CI Deno type-checks.

## Acceptance

Production smoke before hardening:
- 19be809d / 2 km: active, errors 0, coverage 6/6, 91 entities, 3 multi-source, 1 confirmed registry hit.
- 19be809d / 5 km: active, errors 0, coverage 5/5 applicable; Overture radius_limited and excluded from denominator.
- GHSL sample: population ~4,419 / 14,473 / 18,385 within 1/5/10 km; built fraction ~20.19% / 2.98% / 1.16%.
- Observed Area Report latency: fresh ~5.3–9.6 s, cached ~1.2 s.

Final production acceptance requires: successful migration, active Edge deployment, fresh 2 km smoke with errors=0, cache readback, security advisor review, and green repository CI.

Area OSINT spatial search uses PostGIS ST_DWithin/ST_Distance over the ingested GeoWatch corpus. Spatial proximity does not establish causation or operational significance.
