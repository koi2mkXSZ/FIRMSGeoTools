# Source / Delivery Latency Monitor

## Purpose

Separate external source latency from GeoWatch/Telegram delivery latency.

Metrics:

- source latency = `received_at - acq_datetime`
- delivery latency = `telegram_sent_at - first_received_at`
- end-to-end latency = `telegram_sent_at - first_seen`

Default control window: 24 hours.

Thresholds:

- source latency warning: > 90 min
- internal delivery warning: > 10 min

## RPCs

### firewatch_latency_health(hours)

Returns:

- detection count
- source avg / p50 / p95 / max
- count above 90 min
- per-source latency statistics
- published event delivery avg / p50 / p95 / max
- count above 10 min
- required but unsent events
- worst source and delivery examples

### firewatch_event_latency(event-id)

Returns the latency chain for one event, including every contributing detection.

## Watchdog

Watchdog v35 adds two independent issue classes:

- `SOURCE_LATENCY`
- `DELIVERY_LATENCY`

This distinction prevents slow upstream NRT publication from being mistaken for a Telegram/GeoWatch processing failure.

## Admin bot

Admin v77 adds:

- button `⏱ Latency`
- command `/latency` for 24 h summary
- command `/latency <event-id>` for one event

## Production validation

24 h snapshot:

- detections: 59
- source p50: 156.1 min
- source p95: 287.1 min
- source max: 287.1 min
- source >90 min: 52

Per-source examples:

- VIIRS NOAA-21 p95: 287.1 min
- VIIRS SNPP p95: 185.8 min
- VIIRS NOAA-20 p95: 159.1 min
- EUMETSAT MTG p95: 19.2 min

Internal delivery:

- published events: 22
- p50: 0.4 min
- p95: 3.5 min
- max: 3.6 min
- >10 min: 0
- required unsent: 0

For event `19be809d`:

- source latency: 175.1 min
- internal delivery: 3.0 min
- end-to-end: 178.1 min

The live watchdog correctly reported `SOURCE_LATENCY` but not `DELIVERY_LATENCY`.
