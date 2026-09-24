# Stage 40.2 — Semantic / Entity OSINT Engine

## Goal

Stage 40.2 converts linked OSINT documents into structured, explainable evidence.

It does not ask an LLM to decide what happened. Extraction is deterministic and auditable.

## Semantic layers

### Items

Every event-linked source item becomes an `osint_semantic_items` record with:

- stable origin reference
- event ID
- provider/source class
- normalized text
- SHA-256 fingerprint
- processing version

### Entities

`osint_entities` currently extracts:

- incident types: fire, explosion, smoke, strike/attack, damage, power outage
- infrastructure types: fuel station, warehouse, power, transport, residential, hospital, industrial, shopping
- event geography: nearest place, oblast, Ukraine
- coordinate mentions
- explicit geo warning signals

### Claims

`osint_claims` stores:

- incident-type claims
- killed/injured counts when an explicit numeric expression is present
- semantic geographic status

No causal attribution is inferred.

## Geographic semantic review

Each document/event association receives one of the contextual states:

- `nearest_place` — explicit event-place support
- `oblast` — oblast/root support
- `country_only` — Ukraine only
- `other_known_place` — mentions another known GeoWatch place
- `foreign_location_signal` — explicit foreign-location signal
- `none` — no geographic support found

Review actions in `firewatch_semantic_osint()`:

- foreign location → `reject_candidate`
- another known place → `review_location`
- no location support → `weak_location_support`

These are review flags. Raw source records are preserved.

## Deduplication

Near-duplicate text is clustered with PostgreSQL trigram similarity.

Threshold: 0.72 within a 72-hour window.

This collapses:

- the same Telegram message linked to several events;
- syndicated/rephrased news;
- repeated source items.

Provider count remains separate from document count.

## Numeric divergence

For casualty claims from different providers, differing numeric values are recorded in `osint_claim_divergences`.

A divergence is **not automatically called a contradiction** because casualty counts often change as information is updated.

Statuses support:

- unresolved
- temporal_update
- resolved
- not_comparable

## Evidence graph

RPC:

`firewatch_osint_evidence_graph(<event-id>)`

Node types:

- event
- document
- cluster
- entity
- claim

Edge types:

- linked_to
- member_of
- mentions
- asserts

Graph edges represent evidence relationships, not causal relationships.

## Deep OSINT integration

`firewatch_deep_osint()` now returns:

- Fusion timeline
- EFFIS context
- `semantic`
- `evidence_graph`

Telegram `/deeposint` shows semantic counts:

- items
- clusters
- duplicate items
- geographically unsupported items
- divergence flags

## Production schedule

`firewatch-osint-semantic`

Schedule:

`18,48 * * * *`

The function processes fresh data from the previous 72 hours and remains separate from the critical FIRMS ingestion path.

## Initial validation

The first smoke pass produced:

- 25 semantic items
- 89 extracted entities
- 71 claims
- 16 clusters

Examples validated:

- one Ukraine NOW post linked repeatedly was collapsed into a five-item cluster;
- Radio Svoboda duplicates formed a three-item cluster;
- syndicated Interfax/RIA Yakutia stories formed a shared cluster;
- Neryungri/Yakutia stories incorrectly returned by event-scoped GDELT were flagged `foreign_location_signal` with geo score 0.

## Current limitations

This first semantic engine is deterministic and deliberately conservative.

It is not yet a general named-entity recognizer for arbitrary organizations/persons, and it does not infer intent, responsibility, military significance or cause.

Future expansion can add a second model-assisted extraction layer while retaining this deterministic layer as an audit baseline.
