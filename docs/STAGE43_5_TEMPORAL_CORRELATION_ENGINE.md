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

## Production scheduling / backfill

The batch selector uses a round-robin policy:

1. oldest or null `fire_events.temporal_correlation_updated_at`;
2. higher event priority;
3. newer FIRMS reference time.

This prevents a fixed priority top-N from starving the rest of the 168-hour window while keeping higher-priority events ahead within the same refresh age.

## Surfaces

Stage 43.5 is exposed in:

- Web Dashboard event timeline;
- Dashboard API detail/timeline payloads;
- Event Evidence Report HTML and JSON;
- admin Telegram `/dossier`;
- client Telegram `/dossier`.

Automatic public Telegram publication/resync was deliberately left unchanged for the initial rollout. The temporal backfill therefore does not trigger mass edits of historical channel posts.

## Production acceptance — 2026-09-25

Deployment state:

- database schema: 44;
- `firewatch-temporal-correlation`: ACTIVE v2;
- `firewatch-dashboard`: ACTIVE v16;
- `firewatch-event-report`: ACTIVE v8;
- `firewatch-admin`: ACTIVE v103;
- `firewatch-client`: ACTIVE v57.

Known-event acceptance, event `52d9e631-1129-4f62-b5ab-d9ac30ae932f`:

- reference: FIRMS `2026-09-25 01:07:00 UTC`;
- consistency: 87/100, `strong_alignment`;
- alignment: 90/100;
- coverage: 75%;
- 5 sources across 3 scored families;
- nearest Neptun source-time offset used for temporal family scoring: -101 s;
- OSINT publication timestamps remain explicitly marked as publication time;
- repeated targeted run retained the same profile hash and unchanged `updated_at`.

Backfill acceptance:

- first batch: 250 profiles;
- second round-robin batch processed a different set;
- confirmed total after the two batches: 501 unique event temporal profiles.

Evidence Report acceptance:

- version: `stage43.5-report-v1`;
- production HTML generated successfully: 15,193 bytes;
- production JSON generated successfully: 76,221 bytes;
- `last_error` null.

Security advisor note: the new internal table follows the existing service-role-only pattern (RLS enabled, public roles revoked). Supabase reports the informational `rls_enabled_no_policy` lint for this and other internal tables. The pre-existing `pg_net` public-schema warning also remains.

## Status

**CLOSED / PRODUCTION READY — 2026-09-25.**
