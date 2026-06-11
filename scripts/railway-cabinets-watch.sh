#!/usr/bin/env bash
# Мониторинг Railway окружения cabinets (Api, Web, Worker-UB, Worker-Bybit).
# Использование: ./scripts/railway-cabinets-watch.sh [--redeploy-on-fail]
set -u

ENV_NAME="${RAILWAY_ENVIRONMENT:-cabinets}"
API_URL="${CABINETS_API_URL:-https://qwalex-trader-cabinets-api.up.railway.app}"
WEB_URL="${CABINETS_WEB_URL:-https://qwalex-trader-cabinets.up.railway.app}"
LOG_FILE="${CABINETS_WATCH_LOG:-$(cd "$(dirname "$0")/.." && pwd)/logs/railway-cabinets-watch.log}"
CURL_TIMEOUT="${CABINETS_WATCH_CURL_TIMEOUT:-12}"
REDEPLOY="${1:-}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

railway_json() {
  railway deployment list --service "$1" --environment "$ENV_NAME" --json 2>/dev/null || echo '[]'
}

deployment_status() {
  local svc="$1"
  python -c "import json,sys; d=json.load(sys.stdin); print(d[0]['status'] if d else 'UNKNOWN')" <<<"$(railway_json "$svc")"
}

check_http_health() {
  local url="$1"
  local expect_service="$2"
  local body code service
  body="$(curl -sS --max-time "$CURL_TIMEOUT" "$url/health" 2>/dev/null || true)"
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$url/health" 2>/dev/null || echo '000')"
  if [[ "$code" != "200" ]]; then
    log "FAIL $url/health http=$code"
    return 1
  fi
  if [[ -n "$expect_service" ]]; then
    service="$(python -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('service',''))" "$body" 2>/dev/null || echo '')"
    if [[ "$service" != "$expect_service" ]]; then
      log "FAIL $url/health service=$service expected=$expect_service body=$body"
      return 1
    fi
  fi
  log "OK   $url/health ($body)"
  return 0
}

try_redeploy() {
  local svc="$1"
  log "ACTION redeploy $svc (environment=$ENV_NAME)"
  if railway redeploy --service "$svc" --environment "$ENV_NAME" --yes 2>>"$LOG_FILE"; then
    log "ACTION redeploy $svc: triggered"
    return 0
  fi
  log "ACTION redeploy $svc: failed (see log)"
  return 1
}

handle_bad_deployment() {
  local svc="$1"
  local st="$2"
  case "$st" in
    SUCCESS|BUILDING|DEPLOYING|QUEUED)
      log "OK   $svc deployment=$st"
      return 0
      ;;
    CRASHED|FAILED|REMOVED)
      log "FAIL $svc deployment=$st"
      if [[ "$REDEPLOY" == "--redeploy-on-fail" ]]; then
        try_redeploy "$svc" || return 1
      fi
      return 1
      ;;
    *)
      log "WARN $svc deployment=$st"
      return 1
      ;;
  esac
}

main() {
  local failed=0
  log "=== cabinets watch start (env=$ENV_NAME redeploy=$REDEPLOY) ==="

  check_http_health "$API_URL" "api" || failed=1
  check_http_health "$WEB_URL" "" || failed=1

  for svc in Api Web Worker-UB Worker-Bybit; do
    st="$(deployment_status "$svc")"
    handle_bad_deployment "$svc" "$st" || failed=1
  done

  if [[ "$failed" -eq 0 ]]; then
    log "=== all checks passed ==="
  else
    log "=== checks FAILED (see above) ==="
  fi
  return "$failed"
}

main
