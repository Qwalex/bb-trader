#!/usr/bin/env bash
# Проверка AUTH_JWT_SECRET / API_ACCESS_TOKEN на worker-сервисах cabinets.
# Usage: ./scripts/check-cabinets-worker-auth-env.sh [environment]
set -euo pipefail

ENV_NAME="${1:-${RAILWAY_ENVIRONMENT:-cabinets}}"
SERVICES=(Api Worker-UB Worker-Bybit)
REQUIRED_ON=(Worker-UB Worker-Bybit)
failed=0

check_secret() {
  local svc="$1"
  local json
  json="$(railway variable list --service "$svc" --environment "$ENV_NAME" --json 2>/dev/null || echo '{}')"
  python -c "
import json, sys
d = json.loads(sys.argv[1])
ok = bool((d.get('AUTH_JWT_SECRET') or '').strip() or (d.get('API_ACCESS_TOKEN') or '').strip())
print('ok' if ok else 'missing')
" "$json"
}

echo "=== worker auth env (environment=$ENV_NAME) ==="
for svc in "${SERVICES[@]}"; do
  st="$(check_secret "$svc")"
  if [[ "$st" == "ok" ]]; then
    echo "OK   $svc: user auth secret configured"
  else
    echo "FAIL $svc: AUTH_JWT_SECRET and API_ACCESS_TOKEN both missing"
    failed=1
  fi
done

for svc in "${REQUIRED_ON[@]}"; do
  st="$(check_secret "$svc")"
  if [[ "$st" != "ok" ]]; then
    echo "HINT copy API_ACCESS_TOKEN from Api to $svc (proxied routes need JWT verification)"
  fi
done

exit "$failed"
