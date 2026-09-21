#!/usr/bin/env python3
import json,re,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
errors=[]

def fail(x): errors.append(x)

version=(ROOT/"VERSION").read_text(encoding="utf-8").strip()
manifest=json.loads((ROOT/"release/manifest.json").read_text(encoding="utf-8"))

if manifest.get("version")!=version:
    fail(f"VERSION={version} but manifest version={manifest.get('version')}")

schema=int(manifest.get("schema_version",-1))
migrations=sorted(p.name for p in (ROOT/"supabase/migrations").glob("*.sql"))
listed=manifest.get("migrations",[])
if migrations!=listed:
    fail(f"manifest migrations differ from repository: repo={migrations}, manifest={listed}")

functions=sorted(p.parent.name for p in (ROOT/"supabase/functions").glob("*/index.ts"))
listed_functions=sorted(manifest.get("edge_functions",[]))
if functions!=listed_functions:
    fail(f"manifest Edge Functions differ: repo={functions}, manifest={listed_functions}")

latest=ROOT/"supabase/migrations"/f"{schema:04d}_release_recovery.sql"
if not latest.exists():
    fail(f"schema_version={schema} does not match expected migration {latest.name}")

text=latest.read_text(encoding="utf-8") if latest.exists() else ""
if version not in text:
    fail("release metadata migration does not contain VERSION")
if f"'schema_version',{schema}" in text:
    pass

readme=(ROOT/"README.md").read_text(encoding="utf-8")
if "Stage 7" not in readme:
    fail("README does not identify Stage 7")

if errors:
    print("RELEASE CHECK FAILED")
    for e in errors: print(" -",e)
    sys.exit(1)

print(f"RELEASE CHECK PASS: version={version} schema={schema} migrations={len(migrations)} functions={len(functions)}")
