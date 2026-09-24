# Environment Context hotfix — 2026-09-24

Production issue:

After EUMETSAT MTG LI was disabled, the environment Edge Function still destructured three results from a Promise.all containing only two Supabase queries.

That produced:

`TypeError: Cannot read properties of undefined (reading 'data')`

on every cron invocation.

Effects:

- `monitor_environment_context` stopped advancing after 11:04 UTC;
- watchdog reported Environment Context stale;
- the old state still displayed MTG LI as active;
- pg_net accumulated 5xx responses.

Fix:

- Promise destructuring corrected to two results;
- obsolete LI product purge removed;
- historical EUMETSAT LI metadata is retained for audit;
- no EUMETSAT polling/read/write/purge remains in the environment poller.

Validation:

- firewatch-environment-context v3 returned HTTP 200;
- monitor_environment_context advanced to 2026-09-24T11:40:16Z;
- RainViewer status active, archive frames 21;
- EUMETSAT LI status disabled, polling false;
- manual watchdog returned HTTP 200;
- active watchdog issues after recovery: SOURCE_LATENCY and historical PGNET_5XX only.

The PGNET_5XX count is a one-hour rolling window and will age out if no further failures occur.
