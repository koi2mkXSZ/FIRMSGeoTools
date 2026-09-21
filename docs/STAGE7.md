# Clean Install Stage 7 — Recovery, Upgrade and Release Packaging

Stage 7 turns the pre-release Core into a maintainable release candidate.

## Versioning

Repository version:

```text
VERSION
```

Machine-readable release metadata:

```text
release/manifest.json
```

Database release metadata:

```text
public.release_metadata
firewatch_release_info()
```

Current version:

```text
0.7.0-pre
schema_version = 7
```

## Portable recovery

`firewatch_recovery_export()` creates a non-secret portable bundle containing:

- project configuration;
- AOI;
- regions;
- source enablement;
- source match radii;
- release/schema version;
- secret inventory.

Secret **values are never exported**.

CLI:

```bash
python3 scripts/recovery.py export --env .env.local
```

Restore configuration:

```bash
python3 scripts/recovery.py unpack backups/firmsgeotools-recovery-....json --output-dir config
```

## Operational backup

Optional data backup:

```bash
bash scripts/backup.sh .env.local
```

or PowerShell:

```powershell
.\scripts\backup.ps1 -EnvFile .env.local
```

This creates the portable bundle plus a data-only SQL dump.

## Upgrade

Existing installations can be upgraded without replacing AOI/regions.

Linux/macOS:

```bash
bash scripts/upgrade.sh .env.local
```

Windows:

```powershell
.\scripts\upgrade.ps1 -EnvFile .env.local
```

Upgrade performs:

1. database migrations;
2. Edge Function redeploy;
3. protected runtime reconfiguration;
4. cron refresh;
5. admin webhook refresh;
6. validation.

## Setup modes

`firewatch-setup` now supports:

- `install`;
- `upgrade`;
- `recovery_export`.

All modes remain protected by `INSTALL_TOKEN`.

## Rollback policy

Generic rollback never automatically drops database objects or operational data.

For application-code rollback, deploy Edge Functions from a previous Git tag.

Schema rollback is release-specific and should use documented rollback notes or a database backup.

## Release consistency

`scripts/release_check.py` verifies:

- VERSION matches manifest;
- manifest migration list matches repository;
- manifest Edge Function list matches repository;
- schema version maps to the current release migration;
- release migration contains the repository version;
- README identifies the current stage.

This check is mandatory in CI.

## Licensing and contribution

Stage 7 adds:

- MIT LICENSE;
- CONTRIBUTING.md;
- CHANGELOG.md;
- release process documentation.

## Remaining gate

Stage 7 does not declare the project stable.

The final gate is **Stage 8 — Fresh-project Acceptance Test**.

Only after a brand-new Supabase project passes the documented end-to-end acceptance flow should the repository be tagged `v1.0.0`.
