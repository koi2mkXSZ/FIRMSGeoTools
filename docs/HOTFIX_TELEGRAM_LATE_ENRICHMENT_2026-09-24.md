# Telegram enrichment hotfix — 2026-09-24

## Problem

Recent FIRMS publications were missing some previously visible enrichment rows:

- nearest populated place
- GHSL exposure
- infrastructure
- atmosphere
- dynamics

## Root causes

The publication template still contained all five rows. The loss was caused by timing and queue semantics.

1. New FIRMS events were published immediately.
2. Several enrichers run asynchronously.
3. The Telegram resync queue watched GHSL, Geo OSINT, public OSINT, air-threat and surface timestamps, but did not watch:
   - fire_events.atmosphere_updated_at
   - fire_events.intelligence_updated_at
   - event_geolocation_context.updated_at
4. Therefore late atmosphere/intelligence/geolocation data could appear in the database without causing the existing Telegram post to be edited.
5. Nominatim also returned HTTP 403 for recent place lookups.
6. GHSL and Geo OSINT were limited to only two uncached events per hourly run, which could delay enrichment during bursts.

Concrete example:

Event 84c57954 was published/edited at 11:56:03 UTC, while intelligence_updated_at became 11:56:14 UTC. Dynamics existed in the database eleven seconds later, but the old queue did not trigger a second edit.

## Fix

### Queue

fire_events_requiring_telegram_sync() now also tracks:

- atmosphere_updated_at
- intelligence_updated_at
- event_geolocation_context.updated_at

### Public post context

firewatch_public_post_context() now exposes GeoNames nearest-place context from event_geolocation_context.

### Place lookup

firewatch-ua now uses:

1. Nominatim
2. GeoNames fallback

when nearest_place_name is missing.

### Enrichment throughput

MAX_REFRESH increased:

- firewatch-geo-osint: 2 -> 6
- firewatch-ghsl: 2 -> 6

The hourly cadence remains unchanged.

### Caption priority

The following rows are protected from the normal caption compaction priority list:

- Ближайший населённый пункт
- Экспозиция GHSL
- Инфраструктура
- Атмосфера
- Динамика

Lower-priority/redundant rows are removed first when Telegram's 1024-character photo-caption limit is reached.

## Production validation

Events from the reported screenshots:

### 84c57954

After the hotfix:
- nearest place: Sviatotroitske, ~2.10 km
- GHSL 5 km population: ~282
- GHSL built fraction: ~0.0835%
- nearest infrastructure: power line, ~602 m
- atmosphere timestamp: 12:17 UTC
- dynamics present
- Telegram post re-edited at 12:23:48 UTC

### 71236514

After the hotfix:
- nearest place: Kommuna Imeni Kotovskogo, ~4.18 km
- GHSL 5 km population: ~2,832
- GHSL built fraction: ~0.6500%
- nearest infrastructure: telecom mast, ~2.23 km
- Telegram post re-edited at 12:24:24 UTC

The names above are source-provided GeoNames values and are not manually normalized.

## Security

No new public access was added. SECURITY DEFINER RPC execution remains service-role only.
