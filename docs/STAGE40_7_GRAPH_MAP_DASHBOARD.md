# Stage 40.7 — Graph + Map Dashboard

## Goal

Add an operator-facing read-only event intelligence view to the existing signed GeoWatch web dashboard.

The view combines:

- event map
- Overture/GeoNames context
- active evidence graph
- Deep OSINT summary
- provenance
- review queue
- source/delivery latency

## Active evidence graph

New backend RPC:

`firewatch_dashboard_evidence_graph(event-id)`

It starts from the semantic evidence graph but removes documents that have been hard rejected by geographic validation:

- `event_public_osint.category = geo_rejected`
- semantic `foreign_location_signal`
- semantic `other_known_place`

Edges touching rejected document nodes are removed.

Entity/claim/cluster nodes that become disconnected are also omitted from the active dashboard graph.

The response retains:

`stats.rejected_documents`

so operators can see how much evidence was filtered without treating it as active event evidence.

Graph edges remain contextual/extraction relationships and never imply causation.

## Dashboard event-intel RPC

New backend-only RPC:

`firewatch_dashboard_event_intel(event-id)`

Returns one read-only package:

- `deep` — current Deep OSINT
- `graph` — geographically filtered active graph
- `reviews` — pending review queue for the event
- `latency` — source/delivery timing for the event

The RPC is executable only by `service_role`.

## Signed Dashboard API

`firewatch-dashboard v10` adds:

`POST ?action=intel`

The existing HMAC signed-link authentication remains unchanged.

No service-role key or database secret is exposed to the browser.

## Frontend

The static Dashboard now includes a Stage 40.7 event workspace.

Selecting an event automatically loads:

### Evidence graph

Node classes:

- event
- document
- cluster
- entity
- claim

The header shows:

- active node count
- active edge count
- geographically rejected document count

### Deep OSINT / Review

Displays:

- active publication/provider count
- geo-rejected count
- provenance statement count
- pending reviews
- source latency
- GeoWatch delivery latency
- active timeline
- first review-queue items

The web dashboard is read-only. Review actions remain in the admin Telegram bot.

### Map context

When geolocation enrichment is cached, the selected event map also renders:

- event position
- nearby Overture Places
- nearby GeoNames places

This is contextual map information only and does not assert that a nearby feature caused, was affected by, or is otherwise associated with the thermal event.

## Verification

For event `19be809d` after the Stage 40.6.1 geographic-gate fix:

- raw historical semantic graph: 28 nodes / 64 edges
- active dashboard graph: 5 nodes / 4 edges
- geographically rejected documents: 10
- active document: UA General Staff
- pending review items: 9
- source latency: 175.1 min
- delivery latency: 3.0 min

The Yakutia/Neryungri articles remain available in review/provenance history but are no longer rendered as active event evidence.

## Security

The new RPCs are SECURITY DEFINER because they aggregate backend-only RLS-protected tables for the already-authenticated signed Dashboard Edge Function.

Execution is explicitly revoked from:

- PUBLIC
- anon
- authenticated

and granted only to:

- service_role

Security Advisor showed no new exposed privileged RPC finding.
