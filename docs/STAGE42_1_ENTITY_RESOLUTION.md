# Stage 42.1 — Wikidata + Entity Resolution + Cross-Source Dedup

## Goal

Resolve OSM, Overture and Wikidata-linked area-context records into normalized entity cards without destructively modifying any source record.

## Sources

### OpenStreetMap / Postpass
Primary infrastructure source.

### Overture
Secondary cross-source context. The public Fused mirror is still tagged with mirror lag.

### Wikidata
Production transport:

`uk.wikipedia.org geosearch -> pageprops.wikibase_item -> Wikidata QID`

This path was selected after WDQS radius queries showed intermittent Edge Runtime timeouts.

The transport keeps Wikidata identity while avoiding a heavy SPARQL query on the critical path.

Historical-event/list pages are filtered from current area context.

## Data model

### area_entities

One normalized card per resolved entity.

Fields include:

- canonical name
- normalized category/subcategory
- coordinates
- Wikidata QID when known
- source count
- resolution status
- resolution confidence
- aliases
- provenance

Statuses:

- `single_source`
- `auto_exact`
- `auto_probable`
- `review_needed`

### area_entity_sources

Appendable provenance rows connecting an entity card to its OSM / Overture / Wikidata source record.

### area_entity_resolution_proposals

Ambiguous potential `same_as` links are kept separately instead of being merged automatically.

## Resolution rules

### Exact

If two source records carry the same Wikidata QID:

`match_method = exact_wikidata_qid`

This may auto-merge at confidence 100.

### Probable

Cross-source records may auto-merge when:

- sources differ;
- categories are compatible;
- coordinates are close;
- normalized names are strongly similar;
- one candidate is clearly better than alternatives.

Generic fallback labels such as `industrial`, `residential`, `parking`, `bus_stop` and similar class names are never used as entity-name evidence.

### Ambiguous

If multiple candidates are plausible, the records remain separate and a reviewable proposal is created.

The resolver never uses same-source name similarity to merge two OSM objects.

## Production smoke test

Event:

`19be809d`

Radius:

`2000 m`

Sources:

- OSM/Postpass: active
- Overture: active
- Wikidata transport: active / Wikimedia geosearch
- Wikidata-linked context objects: 5 after current-page filtering

Normalized resolution:

- entities: 91
- source provenance rows: 94
- multi-source entities: 3
- probable cross-source merges: 3
- pending ambiguous proposals: 0
- Wikidata source rows: 5
- OSM source rows: 69
- Overture source rows: 20

Verified multi-source examples:

1. **Очаківський Міський Суд Миколаївської області**
   - OSM + Overture
   - confidence 92

2. **Центральний ринок**
   - OSM + Overture
   - confidence 90

3. **Свято-Миколаївський собор (Очаків)**
   - Wikidata Q30017836 + OSM
   - confidence 89

## Failure handling

Wikidata/Wikimedia enrichment is fail-soft.

If a transient knowledge-graph request fails and a previous successful Wikidata entity set exists, the previous entity resolution is retained rather than erased.

## Telegram

`/infra <event-id> [radius_m]`

and

`/area <lat> <lon> [radius_m]`

now include an **Entity resolution** section:

- total entities
- multi-source entities
- Wikidata count
- exact QID merges
- probable merges
- pending review proposals
- top multi-source entity cards

## Security

The three new tables are backend-only:

- RLS enabled
- anon/authenticated table privileges revoked

`firewatch_area_entities()` is executable only by `service_role`.

Security Advisor shows no new exposed privileged RPC warning. The existing project's RLS-no-policy INFO pattern and pg_net-public-schema warning remain unchanged.

## Interpretation

Entity resolution answers:

> “Do these public records probably describe the same mapped object?”

It does not establish event causation, operational importance, vulnerability, access, or suitability for action.
