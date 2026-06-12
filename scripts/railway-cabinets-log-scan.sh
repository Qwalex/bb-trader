#!/usr/bin/env bash
# Скан логов Railway cabinets на типовые ошибки worker split / auth / userbot.
# Usage: ./scripts/railway-cabinets-log-scan.sh [environment]
set -u

ENV_NAME="${1:-${RAILWAY_ENVIRONMENT:-cabinets}}"
LOG_FILE="${CABINETS_SCAN_LOG:-$(cd "$(dirname "$0")/.." && pwd)/logs/railway-cabinets-log-scan.log}"
LINES="${CABINETS_LOG_SCAN_LINES:-400}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

# service|grep pattern|severity label
PATTERNS=(
  'Api|userbot proxy failed: Auth is not configured|CRITICAL'
  'Api|userbot proxy failed: Invalid API access token|CRITICAL'
  'Api|userbot proxy failed: Missing forwarded auth token|CRITICAL'
  'Api|userbot proxy .*: 401|WARN'
  'Worker-UB|Auth is not configured|CRITICAL'
  'Worker-UB|AUTH_KEY_DUPLICATED|WARN'
  'Worker-Bybit|Internal service auth is not configured|CRITICAL'
  'Worker-Bybit|worker internal .*: 401|WARN'
  'Api|GramJS|WARN'
  'Worker-Bybit|AUTH_KEY_DUPLICATED|WARN'
)

scan_service() {
  local svc="$1"
  local pattern="$2"
  local label="$3"
  local hits
  hits="$(railway logs --service "$svc" --environment "$ENV_NAME" --lines "$LINES" 2>/dev/null \
    | grep -E "$pattern" | tail -5 || true)"
  if [[ -n "$hits" ]]; then
    log "$label $svc pattern=/$pattern/"
    while IFS= read -r line; do
      log "  $line"
    done <<<"$hits"
    return 1
  fi
  log "OK   $svc no recent matches for /$pattern/"
  return 0
}

main() {
  local failed=0
  log "=== cabinets log scan start (env=$ENV_NAME lines=$LINES) ==="

  if ! ./scripts/check-cabinets-worker-auth-env.sh "$ENV_NAME" >>"$LOG_FILE" 2>&1; then
    log "FAIL worker auth env check (see above)"
    failed=1
  fi

  for entry in "${PATTERNS[@]}"; do
    IFS='|' read -r svc pattern label <<<"$entry"
    scan_service "$svc" "$pattern" "$label" || failed=1
  done

  if [[ "$failed" -eq 0 ]]; then
    log "=== log scan passed ==="
  else
    log "=== log scan found issues ==="
  fi
  return "$failed"
}

cd "$(dirname "$0")/.."
main
