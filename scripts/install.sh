#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env.local}"
if [[ ! -f "$ENV_FILE" ]]; then echo "Missing $ENV_FILE. Copy .env.example and fill it first."; exit 1; fi
set -a
source "$ENV_FILE"
set +a

required=(SUPABASE_PROJECT_REF FIRMS_MAP_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID INSTALL_TOKEN)
for v in "${required[@]}"; do
  if [[ -z "${!v:-}" ]]; then echo "Missing required variable: $v"; exit 1; fi
done

command -v supabase >/dev/null || { echo "Supabase CLI is required."; exit 1; }
command -v curl >/dev/null || { echo "curl is required."; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required."; exit 1; }

AOI_FILE="${AOI_FILE:-config/aoi.geojson}"
REGIONS_FILE="${REGIONS_FILE:-}"
CONFIG_FILE="${CONFIG_FILE:-config/monitoring.json}"

[[ -f "$AOI_FILE" ]] || { echo "AOI file not found: $AOI_FILE"; exit 1; }
[[ -f "$CONFIG_FILE" ]] || { echo "Config file not found: $CONFIG_FILE"; exit 1; }

echo "[1/7] Linking Supabase project..."
supabase link --project-ref "$SUPABASE_PROJECT_REF"

echo "[2/7] Applying database migrations..."
supabase db push

echo "[3/7] Installing Edge secrets..."
supabase secrets set \
  FIRMS_MAP_KEY="$FIRMS_MAP_KEY" \
  TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
  TELEGRAM_CHAT_ID="$TELEGRAM_CHAT_ID" \
  INSTALL_TOKEN="$INSTALL_TOKEN"

if [[ -n "${TELEGRAM_ADMIN_CHAT_ID:-}" && -n "${TELEGRAM_ADMIN_WEBHOOK_SECRET:-}" ]]; then
  supabase secrets set \
    TELEGRAM_ADMIN_CHAT_ID="$TELEGRAM_ADMIN_CHAT_ID" \
    TELEGRAM_ADMIN_WEBHOOK_SECRET="$TELEGRAM_ADMIN_WEBHOOK_SECRET"
fi

echo "[4/7] Deploying Core Edge Functions..."
supabase functions deploy firewatch-firms --no-verify-jwt
supabase functions deploy firewatch-telegram --no-verify-jwt
supabase functions deploy firewatch-setup --no-verify-jwt
supabase functions deploy firewatch-doctor --no-verify-jwt
supabase functions deploy firewatch-admin --no-verify-jwt
supabase functions deploy firewatch-geo-integrity --no-verify-jwt
supabase functions deploy firewatch-dashboard --no-verify-jwt

echo "[5/7] Configuring geography and cron..."
python3 scripts/build_setup_payload.py "$AOI_FILE" "$REGIONS_FILE" "$CONFIG_FILE" > .setup-payload.json
curl --fail-with-body -sS \
  -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/firewatch-setup" \
  -H "Content-Type: application/json" \
  -H "x-install-token: $INSTALL_TOKEN" \
  --data-binary @.setup-payload.json
rm -f .setup-payload.json

echo
echo "[6/7] Core install completed."
echo "The first scheduled FIRMS run will finish bootstrap automatically."
echo "[7/7] Running installation doctor..."
bash scripts/validate.sh "$ENV_FILE"
