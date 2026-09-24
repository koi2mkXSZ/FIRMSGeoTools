# Stage 41.0.1 — EUMETSAT MTG LI disabled

The project decided not to depend on EUMETSAT Data Store credentials/subscription state.

Changes:

- `EUMETSAT_MTG_LI.enabled = false`
- environment poller no longer calls EUMETSAT OpenSearch
- historical LI product metadata is preserved for audit only
- event environment context exposes MTG LI as `disabled`
- RainViewer remains active
- client/admin/watchdog no longer show historical LI product counts as an active source

Production verification for event `19be809d`:

- RainViewer: `history_unavailable`
- MTG LI: `disabled`
- LI product_count: 0
- local_signal: `disabled`

No new EUMETSAT requests are made by the environment cron.
