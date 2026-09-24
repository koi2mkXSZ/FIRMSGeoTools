# Stage 42.3 — Registry & Official Sources Fusion

## Goal

Add official/public-registry references to Stage 42 entity cards without treating keyword-search results as proof of physical-object identity.

## Sources

### data.gov.ua

Official Ukraine open-data portal.

Production transport:

- CKAN Action API
- package_search
- package/resource metadata

No API secret is required for read-only discovery.

Search queries are generated from:

- canonical entity name
- selected aliases
- public operator name, when available

Hits are scored conservatively.

Statuses:

- candidate
- probable
- confirmed
- rejected

data.gov.ua search hits are never automatically marked confirmed solely because a dataset title contains similar words.

### gov.ua official web references

If a resolved entity profile contains an official website inside the gov.ua domain tree, Stage 42.3 records a confirmed official-web reference.

This confirms the official website reference only. It does not prove that the entity is involved in a monitored event and does not infer ownership beyond the published source metadata.

## Data model

New backend-only table:

area_entity_registry_hits

Stored fields include:

- entity_id
- source_key
- external_id
- title
- publisher
- resource_url
- landing_url
- external update time
- match status
- match confidence
- match basis
- raw bounded metadata payload
- first/last seen

## RPC

firewatch_entity_registry_cached(query)

Supports:

- full/short entity UUID
- Wikidata QID

## Edge Function

firewatch-registry-fusion v2

Cache window:

- 24 hours

## Telegram

New shared read-only command in both bots:

/registry <QID|entity-id>

Examples:

/registry 3717e647
/registry Q30017836

## Production validation

### Court entity

Entity:

3717e647 — Очаківський Міський Суд Миколаївської області

Confirmed official web reference:

- source: GOV_UA_OFFICIAL_WEB
- domain: oc.mk.court.gov.ua
- URL: https://oc.mk.court.gov.ua/sud1420/
- status: confirmed
- confidence: 100

The data.gov.ua search considered 10 datasets but did not produce a sufficiently strong object-level hit. The system correctly wrote zero CKAN hits instead of forcing a match.

### Ochakiv entity

Q850072 — Очаків

The initial data.gov.ua package search produced no sufficiently strong dataset hits. This is treated as a valid empty result, not a source failure.

## Safety / interpretation

Registry fusion is descriptive source enrichment.

It does not calculate:

- vulnerability
- target value
- access routes
- operational capability
- criticality score

A registry hit is source evidence, not automatic event causation or entity-event linkage.

## Production versions

- firewatch-registry-fusion v2
- firewatch-client v39
- firewatch-admin v84

## Security

area_entity_registry_hits:

- RLS enabled
- anon/authenticated privileges revoked

firewatch_entity_registry_cached():

- SECURITY DEFINER
- execute revoked from PUBLIC/anon/authenticated
- granted only to service_role

Security Advisor produced no new exposed privileged-function warning.
