# Stage 42.1.1 — Bot Search / OSINT Command Parity

## Goal

Make the search and read-only OSINT functionality available in both Telegram bots.

The guest/client bot now exposes the same read-only operational/search commands as the admin bot.

## Shared read-only/search commands

- /search
- /event
- /events
- /latest
- /nearby
- /history
- /priority
- /stats
- /analytics
- /deeposint
- /dossier
- /geo
- /infra
- /area
- /osint
- /ground
- /satellite
- /report
- /latency
- /coverage
- /integrity
- /sources
- /archive

## Guest/client additions

New direct commands:

- /infra <event-id> [radius_m]
- /area <lat> <lon> [radius_m]
- /osint <event-id>
- /ground <event-id>
- /satellite <event-id>
- /report <event-id>
- /latency [event-id]
- /coverage
- /integrity
- /events
- /sources
- /archive

The search help screen now lists the Area OSINT and additional OSINT layers.

The reply keyboard also includes:

- Area OSINT
- Satellite

All guest queries continue to pass through the existing client access check and request accounting.

## Admin additions

To close reverse parity, the admin bot adds:

- /history <lat> <lon> [radius_km]
- /latest
- /stats [hours]

## Deliberate exceptions

The two bots are not identical for account-management or state-changing actions.

Client-only:

- /me

Admin-only:

- /clients
- /clientinvite
- /panel
- /review
- /review_accept
- /review_reject
- /review_more

Review mutation and user-management actions remain admin-only.

## Safety / output policy

The shared /infra and /area output uses Stage 42 sanitized Area Intelligence:

- descriptive public object type/name/distance/provenance
- cross-source entity resolution
- no vulnerability score
- no target-value score
- no access-route score
- no operational equipment parameters such as line voltage, pipeline pressure or diameter

## Validation

Production versions:

- firewatch-client v37
- firewatch-admin v82

Automatic command-set comparison confirmed that all read-only/search commands are shared.

The remaining command differences are only:

Client:
- /me

Admin:
- /clients
- /clientinvite
- /panel
- review workflow commands

A 5 km history RPC smoke test around the Stage 42 sample point returned 12 archive rows.
