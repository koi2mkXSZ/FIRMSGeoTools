# Release Process

## Current release

```text
0.7.0-pre
schema_version = 7
channel = pre-release
```

## Release checks

Run:

```bash
python3 scripts/static_check.py
python3 scripts/release_check.py
```

GitHub Actions must be green.

## Stable v1.0 acceptance gate

Do not publish `v1.0.0` until Stage 8 passes on a brand-new Supabase project using only the public repository and documented credentials.

Required acceptance conditions:

- migrations apply from zero;
- all Edge Functions deploy;
- AOI imports correctly;
- first FIRMS bootstrap completes;
- subsequent monitoring cycle succeeds;
- Telegram test message succeeds;
- admin webhook works when configured;
- Source Coverage healthy;
- Notification Integrity has no gaps;
- Geographic Integrity reports `missing_in_db = 0`;
- signed Dashboard opens;
- strict validation exits 0;
- recovery export succeeds.

## Tagging

After Stage 8:

1. change `VERSION` to `1.0.0`;
2. update `release/manifest.json`;
3. add a stable entry to `CHANGELOG.md`;
4. add a migration updating `release_metadata` to stable;
5. run release checks;
6. tag `v1.0.0`;
7. publish GitHub Release notes.

## Release artifacts

The repository itself is the install source.

Do not attach files containing credentials, database dumps or private geography to a public release.
