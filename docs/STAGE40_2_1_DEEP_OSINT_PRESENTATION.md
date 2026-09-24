# Stage 40.2.1 — Deep OSINT metric and Telegram presentation correction

Real Telegram output exposed a presentation bug: the header used Fusion-only counters while the timeline also contained `event_public_osint` items.

Example: event `605bfb16` had two Ukraine NOW publications, but the message displayed:

- strong providers: 0
- source classes: 0

The underlying data was valid; the labels were misleading.

## Fix

Client/admin Deep OSINT now use semantic-layer totals for the visible evidence summary:

- publications/items
- distinct providers
- distinct source classes
- geographic support
- duplicate/repost count
- divergence count

The Fusion corroboration metric remains separate and keeps its original meaning.

For event `605bfb16`, the corrected values are:

- items: 2
- providers: 1
- source classes: 1
- geo supported: 2/2
- duplicates: 0
- divergences: 0
- independent corroboration: none

This is the intended interpretation: evidence exists, but both publications are from one provider.

## EFFIS presentation

`not_cached` is no longer shown as if it were an EFFIS failure.

Client output:

`EFFIS: not cached • ещё не обработано текущим priority batch`

Admin output:

`EFFIS not cached • not yet processed in current priority batch`

## Client vs admin

Client output is now evidence-oriented and hides low-value internal counters such as `Fusion/public/legacy`.

Admin output retains a `Technical:` line for diagnostics.

No correlation or scoring logic was changed in this stage; this is a metric-definition and presentation correction.
