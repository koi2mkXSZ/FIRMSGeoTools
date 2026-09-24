# Stage 39 — Event Priority / Operator Triage

Stage 39 adds a transparent 0–100 priority score for deciding which thermal events should be reviewed first.

This is **not** a causal, attribution, intent, threat or military-significance score.

## Components

Maximum 100 points:

- satellite confirmation — 25
- thermal intensity / FRP — 25
- persistence + observation count — 20
- current dynamics — 10
- civilian context (GHSL population + nearby settlement) — 15
- independent non-military context — 5

Air-threat/Neptun context and critical-infrastructure proximity are deliberately excluded from the score.

## Levels

- 75–100: high
- 55–74: elevated
- 30–54: normal
- 0–29: low

## Runtime

Priority is automatically refreshed when relevant `fire_events` fields change and when GHSL or dossier context is updated.

RPCs:

- `firewatch_event_priority(event_uuid)`
- `firewatch_refresh_event_priority(event_uuid)`
- `firewatch_priority_events(hours, limit, min_score)`
- `firewatch_refresh_priority_recent(hours, limit)`

## Telegram

Client bot and admin bot support:

`/priority [hours] [min_score]`

Examples:

`/priority`

`/priority 24 50`

`/priority 168 70`

The event dossier also displays the current priority score.

## Initial production backfill

On 2026-09-24, 3,052 events from the previous 7 days were scored:

- high: 11
- elevated: 222
- normal: 988
- low: 1,831
