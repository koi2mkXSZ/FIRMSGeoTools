# Stage 40.3 — Air-threat / UAV Context Fusion

## Purpose

Stage 40.3 adds air-alert and public UAV/air-threat context to Deep OSINT without treating temporal overlap as proof of cause.

The layer is deliberately coarse and contextual.

## Data sources already present in GeoWatch

- `air_alert_current`
- `air_alert_history`
- `event_air_threat_context`
- Neptun-derived event context

No live trajectory prediction is produced.

## Critical mapping fix

The existing alerts.com.ua mapper failed for almost all oblasts because the provider returns English names such as `Vinnytsia oblast`, while the old normalizer only stripped the Ukrainian suffix `область`.

Before the fix:

- current rows: 25
- mapped: 1
- unmapped: 24

After the fix:

- current rows: 25
- mapped: 25
- unmapped: 0

The Kyiv city / Kyiv oblast ambiguity is handled explicitly.

## Air-alert history coverage

Historical alert claims are only made for periods actually observed by GeoWatch.

The first snapshot can contain an old provider `changed_at`, but this does not mean GeoWatch observed the alert state at that historical time.

Therefore `firewatch_air_context()` uses the earliest `observed_at` as the coverage boundary.

For events before that boundary:

`relation = history_unavailable`

This prevents false statements such as “no alert” for periods that were never recorded by the system.

## Context classes

Air-alert relation:

- `during_alert`
- `alert_start_within_30m`
- `alert_start_within_2h`
- `no_nearby_alert`
- `history_unavailable`

Public air-threat context:

- present / absent
- threat types
- public source names
- time bucket:
  - `within_30m`
  - `within_2h`
  - `within_6h`
  - `outside_6h`

Exact heading, route, projected movement and target inference are not exposed by this layer.

## Deep OSINT

`firewatch_deep_osint()` now includes:

`air_context`

Client output contains a dedicated:

`✈️ Воздушный контекст`

section.

## Validation

Event `605bfb16`:

- alert history: unavailable for event time
- public air-threat context: none
- combined: `insufficient_alert_history`

Control event `19be809d`:

- alert history: unavailable for event time
- public air-threat context: present
- source: Neptun
- threat type: shahed
- temporal bucket: `within_6h`
- combined: `public_threat_context_only`

## Monitoring

`firewatch_air_context_health()` exposes:

- current rows
- unmapped current rows
- latest alert check
- history row/mapping counts
- event air-threat context counts

Watchdog raises:

- `AIR_ALERT_MAPPING`
- `AIR_ALERT_STALE`

## Interpretation policy

Air alerts and public UAV/air-threat reports are contextual evidence only.

Temporal or regional overlap does not establish causation, attribution, target, route, heading or future movement.
