#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="${1:-.env.local}"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }
set -a; source "$ENV_FILE"; set +a
: "${SUPABASE_PROJECT_REF:?Missing SUPABASE_PROJECT_REF}"
command -v supabase >/dev/null || { echo "Supabase CLI is required."; exit 1; }
mkdir -p backups
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
supabase link --project-ref "$SUPABASE_PROJECT_REF"
python3 scripts/recovery.py export --env "$ENV_FILE" --output "backups/firmsgeotools-recovery-$STAMP.json"
supabase db dump --linked --data-only --use-copy -f "backups/firmsgeotools-data-$STAMP.sql"
echo "Backup complete: backups/*-$STAMP.*"
