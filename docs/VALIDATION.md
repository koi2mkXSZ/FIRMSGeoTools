# Validation checklist

A clean install is not complete until all checks pass.

## Database

- required extensions installed;
- AOI geometry valid;
- optional ADM1 geometry valid;
- required tables present;
- required RPCs present;
- RLS enabled where expected.

## FIRMS

For each enabled source:

- request succeeds;
- current records parsed;
- inside/outside AOI accounting balances;
- deterministic hashes generated;
- no silent record loss.

Expected invariant:

```text
API recent = outside AOI + inside AOI
inside AOI = DB matched + DB missing
```

Healthy state requires `DB missing = 0` after ingestion has caught up.

## Telegram

- bot token valid;
- destination writable;
- admin pairing works;
- webhook healthy;
- one controlled test message succeeds.

## Cron

- project ref points to the current project;
- cron secret resolves from Vault;
- no stale project URL remains;
- source workers run at expected cadence.

## Dashboard

- frontend contains no secret;
- signed link opens;
- unsigned protected API request is rejected;
- map/search/analytics load.

## Recovery

A release is stable only after a fresh-project installation succeeds using only:

- this repository;
- documented credentials;
- documented geography files.
