# Stage 43.2.1 — /geo on-demand enrichment hotfix

## Problem

Telegram `/geo <event-id>` could return a false-empty context when a newly created FIRMS event was requested before the background `firewatch-geo-osint` cycle had populated `geo_osint_event_cache`.

The user-visible result could therefore say:

- nearest object: none;
- no significant objects;
- infrastructure not found;

even when the event was inside a dense urban / industrial area.

The root cause was architectural: `firewatch_geo_context(text)` is a read-only cache projection. The bot read it directly and did not refresh an empty or stale event cache on demand.

## Fix

### firewatch-geo-osint

`firewatch-geo-osint` now supports:

```json
{"mode":"event","event_id":"<short-or-full-event-id>"}
```

The event path:

1. resolves the event through `firewatch_geo_context`;
2. reads the current event coordinates;
3. queries Geofabrik Postpass immediately;
4. rebuilds the 10 km Geo OSINT / OpenInfraMap-compatible profile;
5. persists `geo_osint_event_cache`;
6. updates the legacy `fire_events.osm_*` fields;
7. returns the refreshed feature/infrastructure counts.

Authorization remains internal only:

- valid cron secret; or
- exact service-role bearer from another trusted Edge Function.

Unauthenticated requests still return HTTP 401.

### Telegram client and admin

Both bots now treat the Geo cache as requiring an on-demand refresh when any of these are true:

- cache is absent;
- `feature_count <= 0`;
- cache has `last_error`;
- cache snapshot is older than 24 hours.

For an explicit `/geo` request the bots concurrently request:

- point-specific Geo OSINT refresh when required;
- Area Intel at 5 km for urban/building context.

After a successful refresh the bot rereads `firewatch_geo_context` before rendering the message.

If live refresh fails, the response no longer states that objects are absent. It says that live refresh was unavailable and the cache may be incomplete.

## Expanded /geo output

The client response now includes:

- total Geo OSINT object count;
- top OSM categories;
- nearest mixed-context objects, not only settlement/forest/agriculture/water;
- specialized infrastructure;
- 5 km building footprint count;
- residential/commercial/education/healthcare/transport/industrial/energy/etc. Area Intel counts;
- nearest examples from the urban profile;
- explicit refresh/incomplete state.

The admin output retains GHSL and deep infrastructure details and now adds the same 5 km urban/building profile plus on-demand refresh status.

## Production acceptance: event 52d9e631

Event:

- ID: `52d9e631-1129-4f62-b5ab-d9ac30ae932f`;
- coordinates: 50.37080, 30.92923;
- oblast: Київська.

On-demand Geo OSINT v18:

- HTTP 200;
- 10 km radius;
- **1208** Geo OSINT objects;
- **30** retained infrastructure objects;
- nearest feature: Борисполь / Бориспіль, 0 m;
- categories:
  - forest 302;
  - transport 231;
  - agriculture 186;
  - water 162;
  - industrial 134;
  - power 56;
  - storage 40;
  - telecom 31;
  - settlement 25;
  - waste 15;
  - warehouse 12;
  - oil/gas 12.

Area Intel, 5 km, fresh:

- HTTP 200;
- status active;
- **1567** classified context features;
- **8488 building footprints**;
- 178 named buildings;
- 155 explicitly non-residential tagged buildings;
- residential 423;
- commercial 395;
- energy 243;
- industrial 173;
- transport 80;
- education 64;
- healthcare 44;
- storage 38;
- public service 24;
- water 19;
- telecom 17;
- cultural 17;
- government 12;
- emergency 11;
- logistics 7.

Nearest Area Intel examples include:

- industrial landuse ~15 m;
- residential landuse ~74 m;
- commercial object ~125 m;
- kindergarten ~142 m;
- substation ~925 m.

This confirms the earlier empty Telegram card was caused by cache timing, not by absence of mapped urban objects.

## Production versions

- `firewatch-geo-osint`: ACTIVE v18;
- `firewatch-client`: ACTIVE v53;
- `firewatch-admin`: ACTIVE v99.

## Security / webhook smoke

- direct unauthenticated `mode=event` call: HTTP 401;
- client webhook: enabled, pending 0, last error null;
- admin webhook: enabled, pending 0, last error null.

## CI

Hotfix source head before documentation close: `164b5acbdfd5e86c91684f5eaa03e43c79c99b91`.

Clean Install CI: **#36100364692 — SUCCESS**.

## Status

**PRODUCTION READY — 2026-09-25.**
