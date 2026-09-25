# Stage 43.5 — Temporal Correlation Engine

## Goal

Create one normalized event-time model for FIRMS, Neptun, OSINT, independent satellite observations and atmospheric/radar context without confusing source time with ingestion or publication time.

## Time semantics

The engine keeps the following concepts separate:

- FIRMS / EUMETSAT: satellite acquisition time;
- Neptun: source observation timestamp from the consumed API;
- OSINT: publication timestamp;
- CAMS: model/observation timestamp;
- Sentinel-5P: satellite observation timestamp;
- RainViewer: radar frame timestamp;
- Sentinel-2 Surface: BEFORE/AFTER imagery timestamp;
- ingestion/processing timestamps are stored separately and never substituted for source time.

Reference time is fire_events.first_seen, derived from FIRMS event acquisition chronology.

## Output

event_temporal_correlations stores a normalized timeline, signed offsets from FIRMS reference time, before/simultaneous/after relation, per-family temporal proximity, alignment_score, coverage_score, combined consistency_score, flags, explanations and a stable profile_hash.

Classes are strong_alignment, aligned, partial, weak and unknown.

The score describes temporal agreement only. It is not a severity, attribution, intent, causation or incident-confidence score.

## Scored families

- Neptun: 30%;
- OSINT publication time: 20%;
- atmosphere/radar: 25%;
- independent satellite acquisition: 25%.

Sentinel-2 BEFORE/AFTER scenes remain on the timeline but do not inflate the event-time score because multi-day surface evidence has different temporal semantics.

## Idempotency

The worker recomputes a stable profile hash. If the normalized profile has not changed, the database row is not rewritten and fire_events.temporal_correlation_updated_at is not advanced.

## Runtime

Edge Function: firewatch-temporal-correlation.

Default production batch: 168 h, up to 250 events. Cron minutes: 6, 21, 36 and 51 of every hour.

## Interpretation

Temporal proximity is contextual evidence only. It does not establish that an OSINT post, air-threat track, atmospheric anomaly or satellite observation caused the FIRMS thermal anomaly.

## Status

Implementation started 2026-09-25.
