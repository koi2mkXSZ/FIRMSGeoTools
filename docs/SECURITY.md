# Security

## Public repository rule

This repository is public by design.

Therefore it must never contain a real credential or production identifier.

## Secret storage

Runtime credentials belong in:

- Supabase Edge Function secrets;
- Supabase Vault;
- local private installer environment.

## Frontend

The Web Dashboard frontend must never contain:

- SUPABASE_SERVICE_ROLE_KEY;
- database password;
- cron secret;
- Telegram bot token.

Dashboard access should use short-lived signed URLs or another server-side authorization mechanism.

## Database

Service tables use RLS.

Operator-only RPCs must not be executable by `anon` or normal authenticated users unless the release explicitly documents that decision.

## Telegram

Public Telegram destination and private administrator identity are separate concepts.

The clean installer must not assume they are the same chat.

## Reporting vulnerabilities

Before the first stable release, a responsible disclosure contact/process should be added to this document.
