# Clean Install Stage 5 — Integrity & Coverage

Stage 5 adds independent health and data-loss detection to the Core profile.

## 1. Notification Integrity

The system classifies unsent events into:

- `notification_gap` — a post-bootstrap FIRMS event is suppressed and unsent;
- `delivery_backlog` — an event should be sent but has waited more than 45 minutes;
- `bootstrap_suppressed` — historical first-run event intentionally not published;
- `other_suppressed` — informational suppressed state.

Only real gaps/backlog affect health.

RPCs:

```text
firewatch_notification_integrity_refresh()
firewatch_notification_integrity_summary()
```

Cron:

```text
38 * * * *
```

## 2. Source Coverage

Every enabled entry in `firms_sources` is checked against:

- latest FIRMS worker run;
- worker age;
- fetched rows;
- recent rows;
- detections in 1h / 6h / 24h;
- latest acquisition time;
- latest database receive time;
- worker errors.

A geographically quiet area is **not** treated as a source outage just because it has zero fire detections.

Statuses:

- active;
- stale;
- error;
- empty_fetch;
- unknown.

RPCs:

```text
firewatch_source_coverage_refresh()
firewatch_source_coverage_summary()
```

Cron:

```text
34 * * * *
```

## 3. Robust Source Baseline

Coverage telemetry is stored hourly and compared against a rolling 30-day baseline.

Baseline metrics include:

- fetched rows;
- recent rows;
- worker age;
- ingestion delay.

Detection count itself never directly triggers an anomaly because real fire activity can naturally vary dramatically.

Baseline states:

- learning;
- normal;
- watch;
- anomaly.

An anomaly requires repeated abnormal checks rather than a single deviation.

RPCs:

```text
firewatch_source_baseline_refresh()
firewatch_source_baseline_summary()
```

Cron:

```text
36 * * * *
```

## 4. Geographic Integrity

This is an **independent second fetch** from NASA FIRMS.

`firewatch-geo-integrity`:

1. reads the AOI-derived bbox;
2. reads currently enabled FIRMS sources;
3. fetches the current 24-hour FIRMS records independently of the main worker;
4. classifies every point with `ST_Covers`;
5. calculates the same deterministic detection hash as normal ingestion;
6. verifies that every FIRMS record inside AOI exists in `detections`;
7. checks event and Telegram linkage;
8. builds per-source and optional per-region audit summaries.

Core invariant:

```text
API recent = inside AOI + outside AOI
inside AOI = DB matched + missing in DB
```

Healthy state requires:

```text
missing in DB = 0
```

### Important geography rule

`inside_aoi` is calculated from `monitoring_areas`, not from `regions`.

This means Geographic Integrity works correctly even when the user supplies no ADM1/state/province layer at all.

Regions are only an optional reporting subdivision.

RPCs:

```text
firewatch_geo_integrity_refresh(jsonb)
firewatch_geo_integrity_summary()
```

Worker:

```text
firewatch-geo-integrity
```

Cron:

```text
39 * * * *
```

## 5. Per-region audit

If regions are configured, Stage 5 records for every region:

- API detections;
- DB matched;
- missing in DB;
- distinct events;
- Telegram-published events;
- source breakdown;
- active/degraded/quiet status.

All configured regions are retained, including zero-detection regions.

Points inside AOI but outside every optional region are counted separately as:

```text
inside_without_region
```

## 6. Doctor integration

Stage 5 contributes four additional Doctor checks:

- Notification Integrity;
- Source Coverage;
- Source Baseline;
- Geographic Integrity.

Severity:

- notification gap → FAIL;
- source degraded → FAIL;
- FIRMS record missing from DB → FAIL;
- baseline anomaly → FAIL;
- Telegram backlog → WARN;
- baseline learning → WARN;
- checks not yet executed after fresh install → WARN.

## 7. Admin panel

`/coverage` now shows the full chain:

```text
FIRMS API → AOI → DB → Events → Telegram
```

For each enabled source it shows worker state, baseline state, fetched/recent values, DB activity and independent geographic-audit counts.

## 8. Stage 5 cron

The setup endpoint configures Stage 5 automatically using the current project's own Supabase URL.

No project URL or AOI bbox is hard-coded in the repository.
