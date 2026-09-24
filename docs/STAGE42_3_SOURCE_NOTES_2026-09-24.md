# Stage 42.3 source notes — 2026-09-24

## data.gov.ua

The official API documentation exposes CKAN Action API endpoints including:

- /api/3/action/package_list
- /api/3/action/package_show
- /api/3/action/package_search
- /api/3/action/resource_search

DataStore-enabled resources also expose datastore_search and datastore_search_sql.

Stage 42.3 uses only read-only package discovery and bounded metadata retrieval.

## Match policy

A data.gov.ua package result is not treated as a physical-object registry record by default.

High-confidence matching requires strong name/publisher evidence. Automatic status is capped at probable unless a future connector provides a stable object identifier or an independently verifiable exact registry key.

## gov.ua

URLs within the gov.ua domain tree are recorded as official Ukrainian public-authority web references when the URL is already present in the resolved entity profile.

The URL classification confirms the official-domain reference, not operational significance or event association.
