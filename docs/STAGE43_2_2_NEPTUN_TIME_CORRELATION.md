# Stage 43.2.2 — Neptun FIRMS-time correlation fix

## Problem

Public Telegram posts containing Neptun context consistently displayed Neptun timestamps after FIRMS acquisition time.

The display formatter was not inverted. It correctly rendered:

- negative `time_offset_seconds` as `до FIRMS`;
- positive `time_offset_seconds` as `после FIRMS`.

The defect was in correlation generation.

The old `firewatch-neptun` worker compared the **currently active Neptun markers at cron execution time** against FIRMS events from the preceding 24 hours. Older FIRMS events therefore acquired later Neptun observations even when much better historical pre-FIRMS snapshots already existed in `neptun_track_history`.

Production audit before the fix:

- context rows: **183**;
- before FIRMS: **0**;
- same time: **0**;
- after FIRMS: **183**;
- selected publication matches: **37/37 after FIRMS**;
- average offset: approximately **+223.9 minutes**.

This was a correlation-selection defect, not a timezone or sign-formatting defect.

## Corrected correlation model

Migration `0041_stage43_2_2_neptun_time_correlation.sql` introduces:

- index `neptun_track_history_source_time_idx`;
- service-role-only RPC `firewatch_rebuild_neptun_context(integer)`;
- schema version **41**.

For each recent FIRMS event the engine now searches historical Neptun snapshots:

- **6 hours before FIRMS**;
- up to **30 minutes after FIRMS**;
- maximum spatial distance **50 km**.

For each event/track the best historical snapshot is selected with a combined distance/time/confidence score.

### Temporal publication rule

Pre-FIRMS context is authoritative for selection priority:

1. If at least one Neptun candidate exists at or before FIRMS acquisition time, publication context contains **only pre-FIRMS candidates**.
2. Post-FIRMS candidates are allowed only when no pre-FIRMS context exists.
3. Post-FIRMS fallback is limited to **+30 minutes**.

This prevents later cron-time markers from replacing historically relevant context.

The Neptun evidence remains contextual only. Spatial and temporal proximity do not establish causation or attribution.

## Worker integration

`firewatch-neptun` now:

1. fetches the current public Neptun payload;
2. stores current tracks and immutable historical snapshots;
3. calls `firewatch_rebuild_neptun_context(24)`;
4. refreshes affected event dossiers;
5. reports correlation health in `system_state.monitor_neptun`.

Production state fields include:

- `correlation_mode=historical_preferred`;
- `context_before_or_at_firms`;
- `context_after_firms_fallback`;
- `time_window_before_hours=6`;
- `time_window_after_minutes=30`;
- `match_radius_km=50`.

## Case verification — event 52d9e631

FIRMS:

- event: `52d9e631-1129-4f62-b5ab-d9ac30ae932f`;
- first detection: **2026-09-25 01:07:00 UTC**;
- coordinates: **50.37080, 30.92923**.

Old publication context:

- Neptun UAV / Shahed;
- ~25.9 km;
- approximately **+233 minutes after FIRMS**.

Historical audit found much stronger pre-FIRMS observations. The selected corrected context is:

- Neptun track: `trk_00214912`;
- place: **Бориспіль**;
- Neptun source time: **2026-09-25 00:30:18 UTC**;
- distance: **2699 m**;
- offset: **-2202 s = -36.7 min**;
- confidence: **90/100**;
- heading: **263°**.

`firewatch_public_post_context` now returns this corrected record. The existing publication formatter therefore renders approximately:

`Neptun: UAV / Shahed • 2.7 км • 37 мин до FIRMS • курс 263° • conf 90/100`.

## Production backfill

After migration/backfill:

- events with candidate context: **38**;
- events with pre-FIRMS context: **37**;
- retained context rows: **371**;
- before or at FIRMS: **370**;
- post-FIRMS fallback: **1**.

The previous all-positive distribution is eliminated.

## Telegram resynchronization

`fire_events_requiring_telegram_sync` already treats `event_air_threat_context.updated_at` as a late-enrichment source.

Two normal `telegram-drain` cycles were used to edit existing posts:

- first cycle: **12 edited**, 0 sent, 0 errors;
- second cycle: **2 edited**, 0 sent, 0 errors.

Event `52d9e631` retained its existing Telegram message ID **2318** and received a new `telegram_last_update_at` after the correlation rebuild.

Final audit:

- published Telegram messages with Neptun context newer than their last Telegram update: **0**.

No duplicate posts were created.

## Security

`firewatch_rebuild_neptun_context(integer)`:

- `SECURITY INVOKER`;
- anon EXECUTE: revoked;
- authenticated EXECUTE: revoked;
- service_role EXECUTE: granted.

Supabase Security Advisor returned no finding related to the new Neptun correlation RPC/index.

## Production acceptance

- migration `stage43_2_2_neptun_time_correlation`: applied;
- schema version: **41**;
- `firewatch-neptun`: ACTIVE **v5**;
- production v5 smoke: HTTP 200;
- `status=active`;
- `correlation_mode=historical_preferred`;
- `context_before_or_at_firms=370`;
- `context_after_firms_fallback=1`;
- warnings: 0;
- source code CI before final documentation close: **#36102086563 SUCCESS**.

## Status

**CLOSED / production-ready — 2026-09-25.**
