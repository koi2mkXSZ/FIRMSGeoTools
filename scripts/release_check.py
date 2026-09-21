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

latest_candidates=sorted((ROOT/"supabase/migrations").glob(f"{schema:04d}_*.sql"))
if len(latest_candidates)!=1:
    fail(f"schema_version={schema} must match exactly one migration prefix")
latest=latest_candidates[0] if latest_candidates else None

text=latest.read_text(encoding="utf-8") if latest else ""
if version not in text:
    fail("latest schema migration does not contain VERSION")
if str(schema) not in text:
    fail("latest schema migration does not contain schema_version")

readme=(ROOT/"README.md").read_text(encoding="utf-8")
if "Stage 8" not in readme:
    fail("README does not identify Stage 8")

if errors:
    print("RELEASE CHECK FAILED")
    for e in errors: print(" -",e)
    sys.exit(1)

print(f"RELEASE CHECK PASS: version={version} schema={schema} migrations={len(migrations)} functions={len(functions)}")
