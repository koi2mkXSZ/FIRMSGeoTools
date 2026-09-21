#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="${1:-.env.local}"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }
set -a; source "$ENV_FILE"; set +a
: "${SUPABASE_PROJECT_REF:?Missing SUPABASE_PROJECT_REF}"
: "${INSTALL_TOKEN:?Missing INSTALL_TOKEN}"
command -v supabase >/dev/null || { echo "Supabase CLI is required."; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required."; exit 1; }

echo "[1/5] Link project"
supabase link --project-ref "$SUPABASE_PROJECT_REF"
echo "[2/5] Apply migrations"
supabase db push
echo "[3/5] Deploy Edge Functions"
for fn in firewatch-firms firewatch-telegram firewatch-setup firewatch-doctor firewatch-admin firewatch-geo-integrity firewatch-dashboard; do
  supabase functions deploy "$fn" --no-verify-jwt
done
echo "[4/5] Finalize runtime configuration"
python3 - "$SUPABASE_PROJECT_REF" "$INSTALL_TOKEN" <<'PY'
import json,sys,urllib.request
ref,token=sys.argv[1],sys.argv[2]
req=urllib.request.Request(
 f"https://{ref}.supabase.co/functions/v1/firewatch-setup",
 data=json.dumps({"mode":"upgrade"}).encode(),method="POST",
 headers={"Content-Type":"application/json","x-install-token":token})
with urllib.request.urlopen(req,timeout=120) as r:
 print(r.read().decode())
PY
echo "[5/5] Validate"
bash scripts/validate.sh "$ENV_FILE"
