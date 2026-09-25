# Stage 43.5.1 — Neptun Historical Backfill

## Goal
Reconstruct historical source evidence from the public Telegram archives of the channels listed by Neptun, without presenting reconstructed rows as original Neptun tracks.

## Data provenance
Source registry: `https://neptun.in.ua/api/v1/sources`.

Each archived row stores:
- Telegram source handle and message ID;
- source title/kind/region from the Neptun registry;
- Telegram publication timestamp and text;
- canonical Telegram message URL;
- coarse threat classification;
- immutable content hash;
- `reconstruction_mode=telegram_public_archive`.

The table `neptun_source_messages` is intentionally separate from `neptun_track_history`.

## Backfill engine
Edge Function: `firewatch-neptun-backfill`.

State table: `neptun_backfill_sources`.

Per-source cursoring uses Telegram public archive pagination:
`https://t.me/s/<handle>?before=<message_id>`.

The worker is restart-safe and deduplicates on `(source_handle,message_id)`.

Initial target: **7 days**.
Cron: every 10 minutes, 8 sources per cycle, up to 2 pages per source.
Direct/manual invocations may use higher bounded batch sizes.

## Security
Both new tables:
- RLS enabled;
- anon/authenticated revoked;
- service_role only.

The worker requires `verify_firewatch_cron_secret`.

## Interpretation
This dataset is reconstructed source evidence. It is not a historical export of Neptun track IDs, coordinates, confidence values, or Neptun's own fusion decisions. It must not be merged into `neptun_track_history` as if it were native Neptun telemetry.

## Production acceptance — initial run
- Neptun registry sources discovered: 69;
- first production batch: 8 sources;
- 293 messages inserted;
- 1 source already reached beyond the 7-day cutoff;
- no worker warnings;
- historical provenance recorded in `system_state.monitor_neptun_backfill`.

A larger follow-up batch began successfully and increased the archive to at least 752 messages from 15 sources while the resumable backfill continued.

## Status
**ACTIVE / production backfill — 2026-09-25.**
