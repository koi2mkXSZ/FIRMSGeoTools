# Validation and Doctor

Stage 3 adds automated acceptance checks for a clean installation.

## Normal validation

Linux/macOS:

```bash
bash scripts/validate.sh .env.local
```

Windows PowerShell:

```powershell
.\scripts\validate.ps1 -EnvFile .env.local
```

The validator first checks local files and required environment variables.

If those pass, it calls the protected `firewatch-doctor` Edge Function.

## What Doctor checks

### Database / geometry

- AOI exists;
- AOI geometry is valid;
- optional region geometry is valid;
- runtime bbox is available;
- at least one FIRMS source is enabled;
- all Core tables have RLS enabled;
- no stored detection is outside the current AOI;
- no detection is orphaned from an event.

### Cron / bootstrap

- all three Core cron jobs exist and are active;
- Vault cron secret exists;
- bootstrap status;
- FIRMS worker success state;
- Telegram worker success state;
- notification backlog.

### NASA FIRMS

For every enabled FIRMS source Doctor performs a non-ingesting 1-day Area API request using the configured AOI bbox.

This verifies:

- MAP_KEY is accepted;
- source identifier is accepted;
- API response has the expected CSV shape.

It does **not** insert detections.

### Telegram

Normal validation uses non-invasive Telegram checks:

- `getMe` for the bot token;
- `getChat` for the destination.

It does not post a message.

To send exactly one silent test message:

Linux/macOS:

```bash
bash scripts/validate.sh .env.local --telegram-test
```

Windows:

```powershell
.\scripts\validate.ps1 -EnvFile .env.local -TelegramTest
```

## Exit codes

- `0`: PASS, or WARN in normal mode;
- `1`: WARN when strict mode is enabled;
- `2`: FAIL.

Strict mode:

```bash
bash scripts/validate.sh .env.local --strict
```

## Meaning of WARN

A warning is not necessarily a broken installation.

Immediately after setup it is normal to see warnings such as:

- first FIRMS run has not happened yet;
- bootstrap is still pending;
- Telegram worker has not yet recorded a scheduled execution.

After one normal cron cycle, a healthy installation should converge toward PASS.

## Security

Doctor is protected by `INSTALL_TOKEN`.

Its response contains operational status but never returns:

- FIRMS MAP_KEY;
- Telegram token;
- service-role key;
- Vault decrypted secret.
