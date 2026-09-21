# Keys and secrets

FIRMSGeoTools intentionally separates **required Core secrets** from **optional module credentials**.

## Core

| Variable | Required | Where to obtain | Where stored |
|---|---|---|---|
| FIRMS_MAP_KEY | yes | NASA FIRMS API | Supabase Edge secret |
| TELEGRAM_BOT_TOKEN | yes | BotFather | Supabase Edge secret |
| TELEGRAM_CHAT_ID | yes | Telegram channel/group | Supabase Edge secret |
| FIREWATCH_CRON_SECRET | yes | generate locally | Supabase Vault / installer |
| TELEGRAM_ADMIN_WEBHOOK_SECRET | yes for admin | generate locally | Supabase Vault / installer |
| TELEGRAM_ADMIN_CHAT_ID | optional at first | your Telegram admin account/chat | database pairing state |

## Supabase runtime values

Supabase automatically provides Edge Functions with:

- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

Do not copy the service-role key into browser JavaScript, GitHub Pages or public configuration.

## Optional integrations

### EUMETSAT LSA SAF

- LSASAF_USERNAME
- LSASAF_PASSWORD

Required only when enabling the EUMETSAT modules.

### Copernicus Data Space

- CDSE_USERNAME
- CDSE_PASSWORD

Used by Sentinel modules that require authenticated catalogue/product access.

### OpenAQ

- OPENAQ_API_KEY

Optional. The monitoring system must continue operating when OpenAQ is not configured.

## Generating secrets

Use a cryptographically random value of at least 32 bytes.

Examples:

Linux/macOS:

```bash
openssl rand -hex 32
```

PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes).ToLower()
```

Generate different values for cron authentication and Telegram webhook authentication.

## Never commit

Never commit:

- `.env.local`;
- service-role keys;
- database passwords;
- Telegram tokens;
- private chat IDs if you consider them sensitive;
- Supabase Vault values;
- database dumps containing operational data.
