# Clean Install Stage 6 — Web Dashboard

Stage 6 adds a self-hosted read-only web dashboard to the Core profile.

## Hosting model

Unlike the production deployment, Community Edition does not require a separate GitHub Pages repository.

The `firewatch-dashboard` Supabase Edge Function serves both:

- the HTML dashboard;
- the read-only dashboard API.

This removes per-user CORS and static-host configuration.

## Access security

Dashboard access uses a short-lived HMAC-signed URL.

A dedicated random secret named:

```text
firewatch_dashboard_secret
```

is generated automatically in Supabase Vault by migration `0006_dashboard.sql`.

Default link lifetime: **4 hours**.

Maximum accepted lifetime: **12 hours**.

The browser never receives:

- service-role key;
- FIRMS MAP_KEY;
- Telegram token;
- cron secret;
- dashboard HMAC secret.

## Opening the Dashboard

When the Telegram admin bot is enabled:

```text
/dashboard
```

or tap:

```text
🌐 Dashboard
```

The admin bot generates a new signed URL for the current Supabase project.

## Dashboard features

### Map

- AOI polygon;
- optional region boundaries;
- event markers;
- automatic initial fit to configured AOI;
- click event marker to open event details.

### Event search

Filters:

- event ID;
- region;
- lifecycle/status;
- minimum FRP;
- source;
- coordinates;
- radius.

Coordinate search uses the same server-side radius search as Telegram admin.

### Analytics

Selectable windows:

- 24 hours;
- 7 days;
- 30 days.

Metrics use the Stage 4 semantics:

- New events = `first_seen` inside window;
- Touched = `last_seen` inside window;
- Telegram sent = `telegram_sent_at` inside window.

All configured regions are displayed, including zero-event regions.

### Integrity & Coverage

The dashboard includes:

- Source Coverage;
- source baseline;
- Notification Integrity;
- Geographic Integrity;
- API → AOI → DB counters;
- missing-in-DB count;
- points inside AOI without an optional region assignment.

### Event detail

Displays:

- event ID;
- region;
- lifecycle;
- first/last observation;
- best coordinates;
- nominal resolution;
- observation count;
- platform count;
- sources;
- FRP max / average;
- Telegram delivery state.

## Read-only design

The Dashboard has no write actions.

All data access happens server-side through service-role-only RPCs.

The browser communicates only with its own signed `firewatch-dashboard` Edge Function URL.

## Doctor

Stage 6 extends `firewatch-doctor` with a signed Dashboard probe.

Doctor:

1. obtains the dashboard secret server-side;
2. creates a temporary five-minute HMAC signature;
3. requests the Dashboard endpoint;
4. verifies that the expected HTML page is returned.

Failure to deploy or authenticate the Dashboard is reported as **FAIL**.

## Installation

No new user secret is required.

The normal installer automatically:

1. applies migration `0006_dashboard.sql`;
2. creates the dashboard HMAC secret in Vault;
3. deploys `firewatch-dashboard`;
4. leaves the private admin bot able to generate signed links.

No GitHub Pages configuration is required.
