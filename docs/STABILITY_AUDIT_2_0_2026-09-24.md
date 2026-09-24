# Stability Audit 2.0 — 2026-09-24

## Findings

- The 24-hour Edge Function window was dominated by the earlier runaway Ground OSINT cron incident.
- After hardening, the control window showed **0 new HTTP 5xx** from Edge Functions.
- `pg_net` queue was not stuck and no cron jobs were left running.
- Four cron jobs lacked explicit `timeout_milliseconds`: MODIS, SNPP, Watchdog and Source Audit.
- Two recent `pg_net` requests hit the default 5-second timeout, including a MODIS execution that completed successfully after about 5.1 seconds.
- Static Edge Function scan found external network calls generally protected with `AbortSignal.timeout`. The Dashboard's browser-side same-origin fetch is intentionally not an Edge external dependency.

## Changes

- Added explicit 90-second pg_net timeout to the four legacy cron jobs.
- Added `firewatch_pgnet_health_summary()`.
- Watchdog v26 now checks pg_net queue depth, recent timeouts and 5xx responses.
- Recovery cron snapshot regenerated so fresh installs inherit explicit timeouts.

## Current watch items

- Event OSINT remains the slowest non-critical enrichment path; recent executions are successful but can take roughly 10–18 seconds.
- `pg_net` extension remains installed in the public schema and is still reported by Supabase Security Advisor. It is not moved during this audit because that can affect active cron/network dependencies.
