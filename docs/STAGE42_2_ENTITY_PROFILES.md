# Stage 42.2 — Entity Intelligence Profiles

## Goal

Turn each normalized Stage 42.1 area entity into an on-demand OSINT profile with field-level provenance.

The profile answers:

- what public object is this;
- what names/aliases are associated with it;
- which public sources support the identity;
- what public organization/operator/owner metadata is available;
- which administrative entity/country is linked;
- what official/public source links are available.

It does not assess vulnerability, access, operational capability or target value.

## Data model

New backend-only table:

`area_entity_profiles`

Fields:

- entity_id
- refreshed_at
- status
- profile
- field_provenance
- source_status
- errors

Cache lifetime in the Edge Function: 7 days.

## Entity lookup

New service-role RPC:

`firewatch_resolve_area_entity(query)`

Accepted identifiers:

- short/full entity UUID
- Wikidata QID

New cache RPC:

`firewatch_entity_profile_cached(query)`

## Profile sources

### Entity Resolution

Provides:

- canonical name
- coordinates
- normalized category/subcategory
- source count
- resolution status
- resolution confidence

### OpenStreetMap

Public tags currently used for descriptive profile enrichment:

- name / name:uk / name:ru / official_name
- operator
- brand
- website
- wikidata identity when present in the Stage 42 entity pipeline

Operational engineering attributes are intentionally not promoted to the profile.

### Wikidata

On-demand API:

`wbgetentities`

Fields currently used:

- label
- description
- aliases
- P31 — instance of
- P17 — country
- P131 — located in administrative territorial entity
- P127 — owned by
- P137 — operator
- P856 — official website
- P571 — inception

Related QIDs are resolved to labels in uk/ru/en.

### Overture

Overture remains identity/cross-source provenance. The lagging public mirror is not treated as a freshness-sensitive authoritative registry.

## Field-level provenance

Each enriched profile field records separately:

- source
- source_id
- confidence
- extraction/mapping method
- retrieved_at

Identity confidence is not reused as attribute confidence.

## Telegram

New shared command in both bots:

`/entity <QID|entity-id>`

Examples:

`/entity Q30017836`

`/entity 3717e647`

Area OSINT output now includes the short entity UUID next to top multi-source matches, allowing direct follow-up.

## Production validation

### Wikidata + OSM example

Query:

`/entity Q30017836`

Resolved entity:

**Свято-Миколаївський собор (Очаків)**

Profile includes:

- QID Q30017836
- OSM relation R:18041549
- instance of: церква
- country: Україна
- administrative entity: Очаків
- Ukrainian/Russian aliases
- OSM/Wikidata/Wikipedia public links
- field-level provenance

Identity:

- 2 sources
- auto_probable
- confidence 89

### OSM + Overture example

Query:

`/entity 3717e647`

Resolved entity:

**Очаківський Міський Суд Миколаївської області**

Profile includes:

- OSM way W:873221965
- Overture entity
- operator: Судова влада України
- official website: https://oc.mk.court.gov.ua/sud1420/
- alternate source name
- field-level provenance

Identity:

- 2 sources
- auto_probable
- confidence 92

## Production versions

- firewatch-entity-profile v1
- firewatch-client v38
- firewatch-admin v83

## Security

`area_entity_profiles` is backend-only:

- RLS enabled
- anon/authenticated privileges revoked

The two SECURITY DEFINER RPCs are explicitly revoked from PUBLIC/anon/authenticated and granted only to service_role.

Security Advisor shows only the project's existing backend RLS-no-policy INFO pattern and the existing pg_net-public-schema warning; no new exposed privileged function warning.

## Interpretation

A profile is a public-source identity/attribute bundle.

It must not be interpreted as:

- proof that the entity is related to a monitored event;
- a vulnerability assessment;
- an access assessment;
- an operational-capability assessment;
- a target-priority assessment.
