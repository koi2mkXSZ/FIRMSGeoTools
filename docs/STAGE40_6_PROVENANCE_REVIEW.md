# Stage 40.6 — Provenance & Review Queue

## Goal

Separate source/extractor lineage from interpretation and provide a non-destructive analyst review workflow.

## Statement-level provenance

New backend-only table:

`osint_statement_provenance`

Each provenance snapshot records independently:

- statement kind: claim / entity / event link
- source/provider/source class
- extractor version
- extraction confidence
- document-event link relevance
- source independence
- current review status
- source/origin identifiers and extraction attributes
- observed/captured timestamps

The model deliberately keeps `extraction_confidence`, `link_relevance`, `source_independent`, and `review_status` as separate fields. They are not collapsed into one score.

## Review Queue

New table:

`osint_review_queue`

Initial automatic review reasons:

- `foreign_location_signal` — high
- `location_mismatch` / other-known-place — medium
- `weak_location_support` — low
- `numeric_claim_divergence` — medium

Statuses:

- pending
- accepted
- rejected
- needs_more_evidence

Review is non-destructive. Original documents, semantic items, entities and claims are preserved.

## Automatic refresh

`firewatch-osint-semantic v8` calls `firewatch_refresh_statement_provenance()` for every affected event after divergence refresh.

Latest live cycle:

- processed semantic items: 34
- provenance statements refreshed: 206
- pending reviews: 11
- status: active

## Initial backfill

206 statement records:

- claims: 88
- entities: 118
- event links: 0 (Fusion link table is currently empty)

The first queue contains 11 items.

Eight high-severity items are foreign-location signals about Neryungri/Yakutia that had been associated with a Ukraine event. This is an expected and useful review result.

For event `19be809d`:

- statements: 106
- claims: 46
- entities: 60
- pending reviews: 9
- high-priority reviews: 8

For event `605bfb16`:

- statements: 42
- claims: 16
- entities: 26
- pending reviews: 0

## Telegram

Client `/deeposint` shows:

`Provenance: <N> statements • review <N>`

Admin Deep OSINT additionally shows independent/reviewed/high counts.

Admin panel adds:

`🧾 Review Queue`

For up to six queue items it provides:

- ✅ accept
- ❌ reject
- ⏳ needs more evidence

Commands are also available:

- `/review [event-id]`
- `/review_accept <review-id> [note]`
- `/review_reject <review-id> [note]`
- `/review_more <review-id> [note]`

Reviewer identity and optional note are stored with the review decision.

## Watchdog

Watchdog v34 displays:

- pending review count
- provenance statement count

A non-empty review queue is not treated as a system fault.

## Security

Both new tables are backend-only:

- RLS enabled
- no anon/authenticated access
- SECURITY DEFINER RPC execution revoked from PUBLIC/anon/authenticated
- execution granted explicitly to service_role

Supabase security advisor reports only the project's existing intentional RLS-no-policy INFO findings and the existing pg_net-public-schema warning; no new exposed privileged RPC warning was introduced.

## Interpretation

A review status is an analyst workflow state, not a truth score.

Accepting a review item means the extraction/link was accepted for workflow purposes. Rejecting it does not rewrite the source document or erase provenance.
