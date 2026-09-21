# Clean Install Stage 4 — Admin Bot, Search and Analytics

Stage 4 ports the operator layer into the public clean install.

## Admin bot

The same Telegram bot can be used for:

- public event delivery;
- private operator/admin commands.

The private admin chat is restricted by `TELEGRAM_ADMIN_CHAT_ID`.

Webhook requests are authenticated with Telegram's `secret_token` header using `TELEGRAM_ADMIN_WEBHOOK_SECRET`.

## Admin commands

```text
/panel
/status
/coverage
/events
/event [ID]
/analytics [hours]
/search ...
/doctor
```

### Event detail

```text
/event 73320c39
```

A partial event UUID is accepted.

### Filter search

Examples:

```text
/search region=North status=active min_frp=20 limit=20
/search source=VIIRS_NOAA21_NRT min_platforms=2
/search sent=false
```

Supported filters:

- id;
- region;
- status;
- source;
- from;
- to;
- min_frp;
- min_obs;
- min_platforms;
- sent;
- limit.

### Coordinate-radius search

```text
/search coord=50.45,30.52 radius=10
```

Radius is in kilometers.

Allowed range: **0.1–500 km**.

Default when coordinates are supplied without radius: **10 km**.

Results are sorted by distance first and event recency second.

## Analytics

```text
/analytics 24
/analytics 168
/analytics 720
```

Semantics are explicit:

- **New events**: `first_seen` is inside the selected window;
- **Touched**: `last_seen` is inside the window;
- **Telegram sent**: `telegram_sent_at` is inside the window;
- detections are counted by their acquisition time.

All configured regions are returned, including regions with **zero** events.

If the region list is too long for one Telegram message, the bot automatically splits it into multiple messages instead of truncating it.

Events that belong to the AOI but not to any configured region are shown as **Unassigned**.

## Coverage

`/coverage` shows every enabled FIRMS source with:

- display name;
- source ID;
- nominal resolution;
- event match radius;
- fetched row count from the latest worker run;
- recent row count.

More advanced production-style integrity/baseline coverage will be ported in a later stage.

## Doctor

`/doctor` exposes database-side diagnostics in Telegram.

The full external Doctor remains available through:

```text
scripts/validate.sh
scripts/validate.ps1
```

## Setup

Admin bot configuration is optional.

Add to `.env.local`:

```text
TELEGRAM_ADMIN_CHAT_ID=
TELEGRAM_ADMIN_WEBHOOK_SECRET=
```

When both are present, the installer:

1. stores them as Edge Function secrets;
2. deploys `firewatch-admin`;
3. registers the webhook automatically using the current Supabase project URL.

If they are not provided, FIRMS monitoring and public Telegram notifications continue to operate normally.

## Security

The admin function checks both:

1. Telegram webhook secret header;
2. exact configured admin chat ID.

Messages from other chats are ignored.

No service-role key, Telegram token or webhook secret is returned by admin commands.
