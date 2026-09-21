#!/usr/bin/env python3
import json,re,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
errors=[]

def fail(msg): errors.append(msg)

# JSON syntax
for p in sorted(ROOT.rglob("*.json")):
    if any(x in p.parts for x in (".git","node_modules")): continue
    try: json.loads(p.read_text(encoding="utf-8"))
    except Exception as e: fail(f"{p.relative_to(ROOT)}: invalid JSON: {e}")

# Public-repository secret / production hardcode guard.
forbidden_literals=[
    "swvpqroxbsrmxdmedojd",
    "21.5,43.5,41.5,53.5",
    "outside_ukraine",
    "NASA-FIRMS-UA",
    "GeoWatch-Dashboard",
    "@NASA_FIRMS",
]
telegram_token=re.compile(r"\b\d{8,12}:[A-Za-z0-9_-]{30,}\b")
service_key=re.compile(r"\beyJ[A-Za-z0-9_-]{80,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")

text_ext={".md",".sql",".ts",".json",".py",".sh",".ps1",".toml",".yml",".yaml",".example"}
for p in sorted(ROOT.rglob("*")):
    if not p.is_file() or ".git" in p.parts: continue
    if p.suffix.lower() not in text_ext and p.name not in (".env.example",".gitignore"): continue
    try: text=p.read_text(encoding="utf-8")
    except Exception: continue
    rel=str(p.relative_to(ROOT))
    if rel=="scripts/static_check.py":
        continue
    for lit in forbidden_literals:
        if lit in text: fail(f"{rel}: forbidden production literal: {lit}")
    if telegram_token.search(text): fail(f"{rel}: looks like a real Telegram bot token")
    if service_key.search(text): fail(f"{rel}: looks like a JWT/service key")

# Required clean-install files.
required=[
    ".env.example",
    "config/aoi.example.geojson",
    "config/monitoring.example.json",
    "supabase/migrations/0001_core_schema.sql",
    "supabase/migrations/0002_notifications_lifecycle_cron.sql",
    "supabase/migrations/0003_diagnostics.sql",
    "supabase/migrations/0004_admin_search_analytics.sql",
    "supabase/migrations/0005_integrity_coverage.sql",
    "supabase/migrations/0006_dashboard.sql",
    "supabase/migrations/0007_release_recovery.sql",
    "supabase/functions/firewatch-firms/index.ts",
    "supabase/functions/firewatch-telegram/index.ts",
    "supabase/functions/firewatch-setup/index.ts",
    "supabase/functions/firewatch-doctor/index.ts",
    "supabase/functions/firewatch-admin/index.ts",
    "supabase/functions/firewatch-geo-integrity/index.ts",
    "supabase/functions/firewatch-dashboard/index.ts",
    "scripts/install.sh","scripts/install.ps1","scripts/validate.py",
    "scripts/recovery.py","scripts/upgrade.sh","scripts/upgrade.ps1",
    "scripts/backup.sh","scripts/backup.ps1","scripts/release_check.py",
    "VERSION","release/manifest.json","CHANGELOG.md","LICENSE","CONTRIBUTING.md"
]
for rel in required:
    if not (ROOT/rel).exists(): fail(f"missing required file: {rel}")

if errors:
    print("STATIC CHECK FAILED")
    for e in errors: print(" -",e)
    sys.exit(1)
print("STATIC CHECK PASS")
