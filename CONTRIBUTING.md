# Contributing

FIRMSGeoTools is intended to remain reproducible as a clean public install.

## Before opening a pull request

Run:

Linux/macOS:

```bash
python3 scripts/static_check.py
python3 scripts/release_check.py
```

Windows:

```powershell
python scripts/static_check.py
python scripts/release_check.py
```

GitHub Actions must pass.

## Rules

Do not commit:

- API keys;
- Telegram bot tokens;
- Supabase service-role keys;
- database passwords;
- real `.env.local`;
- operational database dumps;
- private AOI/region files unless intentionally public;
- production project references.

## Database changes

Add a new migration instead of editing a migration that has already shipped in a release.

Increment `schema_version` when a migration changes the installed schema.

## Edge Functions

Keep Core functions geography-agnostic.

Do not introduce:

- country-specific bounding boxes;
- fixed region lists;
- private URLs;
- assumptions that regions are mandatory.

## Tests

At minimum:

- Python syntax;
- repository static checks;
- Deno type checks;
- release manifest consistency.

Changes affecting deployment must also be verified through a fresh-project acceptance test before a stable release.
