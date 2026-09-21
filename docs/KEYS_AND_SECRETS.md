# Keys and secrets

FIRMSGeoTools separates local installer values, Edge Function secrets and database-internal secrets.

## Required Core values

| Variable | Required | Obtain from | Storage after install |
|---|---:|---|---|
| SUPABASE_PROJECT_REF | yes | Supabase project URL | local installer only |
| FIRMS_MAP_KEY | yes | NASA FIRMS API | Supabase Edge secret |
| TELEGRAM_BOT_TOKEN | yes | BotFather | Supabase Edge secret |
| TELEGRAM_CHAT_ID | yes | Telegram destination | Supabase Edge secret |
| INSTALL_TOKEN | yes during setup | generate locally | Supabase Edge secret |
| TELEGRAM_ADMIN_CHAT_ID | optional | your private Telegram chat/user ID | Supabase Edge secret |
| TELEGRAM_ADMIN_WEBHOOK_SECRET | optional | generate locally | Supabase Edge secret |

## Automatically generated

### firewatch_cron_secret

The database migration generates a random cron authentication secret and stores it in **Supabase Vault**.

Users do not copy it into `.env.local`.

pg_cron reads it from Vault when invoking the FIRMS and Telegram Edge Functions.

## Supabase runtime values

Supabase automatically provides Edge Functions with:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`.

Do not place the service-role key in:

- `.env.local` unless a future documented tool explicitly requires it;
- GitHub Pages;
- browser JavaScript;
- public configuration;
- committed files.

## INSTALL_TOKEN

Generate at least 32 random bytes.

Linux/macOS:

```bash
openssl rand -hex 32
```

PowerShell:

```powershell
function New-RandomHex {
    param([int]$Bytes = 32)
    $b = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($b) } finally { $rng.Dispose() }
    -join ($b | ForEach-Object { $_.ToString("x2") })
}
New-RandomHex
```

After setup succeeds, you may rotate/remove this secret until you need the setup endpoint again.

## Optional future Full-profile credentials

These variables are reserved but are not required by current Core:

- `LSASAF_USERNAME`
- `LSASAF_PASSWORD`
- `CDSE_USERNAME`
- `CDSE_PASSWORD`
- `OPENAQ_API_KEY`

## Never commit

Never commit:

- `.env.local`;
- Telegram bot tokens;
- FIRMS MAP_KEY;
- INSTALL_TOKEN;
- service-role keys;
- database passwords;
- Supabase Vault values;
- production database dumps.


## Telegram admin panel

To enable the private admin bot, configure both:

```text
TELEGRAM_ADMIN_CHAT_ID=
TELEGRAM_ADMIN_WEBHOOK_SECRET=
```

The webhook secret must be a random value compatible with Telegram webhook `secret_token` characters. A hexadecimal random string is suitable.

The public destination `TELEGRAM_CHAT_ID` and private `TELEGRAM_ADMIN_CHAT_ID` are intentionally separate.
