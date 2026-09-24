# Stage 40.6.1 — Geographic gate correction for event-scoped GDELT

## Incident

For event `19be809d` in Mykolaiv oblast, Deep OSINT displayed several articles about the Neryungri GRES fire in Yakutia.

## Root cause

The GDELT query was event-scoped:

`"Mykolaiv" (fire OR smoke OR explosion OR blaze OR burning)`

However the old scorer treated **being returned by the event-scoped query** as equivalent to a geographic match.

This gave +35 relevance points even when:

`location.matched = false`

As a result, a generic fire keyword plus temporal proximity could produce relevance 90–100.

The Semantic Engine later correctly classified the Yakutia items as:

- `foreign_location_signal`
- `geo_score = 0`

but `firewatch_deep_osint_core()` still rendered the raw `event_public_osint` rows.

## Fix

### Ingestion

`firewatch-event-osint v8` no longer gives geographic score for merely being returned by an event-scoped GDELT query.

A GDELT candidate is stored as active evidence only when:

- the title contains the event nearest-place / oblast / oblast stem;
- relevance remains >= 65.

Unverified event-scoped results are not stored as active candidates.

### Existing data

Previously stored event-scoped GDELT rows with:

`location.matched = false`

are preserved but marked:

- `category = geo_rejected`
- `relevance_score = 0`
- `match_basis.geo_gate = rejected_no_explicit_location_match`

No source row is deleted.

### Deep OSINT

The Timeline and public-OSINT active count now exclude:

- `geo_rejected`
- semantic `foreign_location_signal`
- semantic `other_known_place`

### Semantic summary

Active semantic item/provider/source-class counts exclude hard geographic rejects.

Rejected items remain available through geo flags, provenance and review queue.

## Verification

Before fix for `19be809d`:

- active publications: 11
- Yakutia/Neryungri items visible in Timeline

After fix:

- active publications: 1
- active providers: 1
- active source classes: 1
- geo_rejected: 10
- foreign_location_signals retained for audit: 8
- Timeline contains only UA General Staff, whose match basis has:
  - `location.matched = true`
  - `kind = oblast_stem`
  - `term = миколаїв`

This preserves audit history without presenting geographically rejected articles as event evidence.
