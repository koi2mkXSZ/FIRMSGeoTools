#!/usr/bin/env bash
set -euo pipefail
ENV_FILE="${1:-.env.local}"
shift || true
python3 scripts/validate.py --env "$ENV_FILE" "$@"
