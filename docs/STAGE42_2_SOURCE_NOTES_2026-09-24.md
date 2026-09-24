# Stage 42.2 source notes — 2026-09-24

## Wikidata entity API

Stage 42.2 uses the MediaWiki/Wikidata Action API `wbgetentities` on demand for a known QID.

This is separate from the Stage 42.1 coordinate-discovery path:

- coordinate discovery: Wikimedia geosearch -> QID
- profile enrichment: Wikidata wbgetentities -> labels/descriptions/aliases/selected claims

This split avoids putting WDQS SPARQL latency on the critical path while retaining stable Wikidata identifiers and structured claims.

## Selected properties

Only descriptive public identity/context properties are promoted:

- P31 instance of
- P17 country
- P131 administrative entity
- P127 owner
- P137 operator
- P856 official website
- P571 inception

Engineering/operational properties are intentionally excluded from the operator-facing profile.
