#!/usr/bin/env bash
set -Eeuo pipefail

# Базовые smoke-проверки после деплоя:
# 1) API /health
# 2) Web base path (учитывает STACK_SLUG)
# 3) Защищенный API endpoint /settings (если есть token)

SMOKE_MAX_ATTEMPTS="${SMOKE_MAX_ATTEMPTS:-30}"
SMOKE_SLEEP_SECONDS="${SMOKE_SLEEP_SECONDS:-2}"
SMOKE_CURL_TIMEOUT="${SMOKE_CURL_TIMEOUT:-8}"

detect_slug() {
  if [[ -n "${STACK_SLUG:-}" ]]; then
    printf '%s' "${STACK_SLUG}"
    return
  fi
  case "${DEPLOY_VARIANT:-production}" in
    development) printf '%s' "trade-dev" ;;
    test) printf '%s' "trade-test" ;;
    *) printf '%s' "trade" ;;
  esac
}

compose_host_port() {
  local service="$1"
  local internal_port="$2"
  local raw
  raw="$(docker compose port "$service" "$internal_port" 2>/dev/null || true)"
  if [[ -z "$raw" ]]; then
    return 1
  fi
  awk 'NF { last = $0 } END { print last }' <<<"$raw"
}

wait_for_http_200() {
  local url="$1"
  local label="$2"
  local i
  for ((i = 1; i <= SMOKE_MAX_ATTEMPTS; i++)); do
    local code
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$SMOKE_CURL_TIMEOUT" "$url" || true)"
    if [[ "$code" == "200" ]]; then
      echo "smoke: ok: ${label} (${url})"
      return 0
    fi
    echo "smoke: wait ${label} attempt ${i}/${SMOKE_MAX_ATTEMPTS}, http=${code:-n/a}"
    sleep "$SMOKE_SLEEP_SECONDS"
  done
  echo "smoke: fail: ${label} (${url}) did not become HTTP 200"
  return 1
}

check_settings_endpoint() {
  local api_base="$1"
  local url="${api_base}/settings"
  local code

  if [[ -n "${API_ACCESS_TOKEN:-}" ]]; then
    code="$(
      curl -sS -o /dev/null -w '%{http_code}' \
        --max-time "$SMOKE_CURL_TIMEOUT" \
        -H "Authorization: Bearer ${API_ACCESS_TOKEN}" \
        "$url" || true
    )"
    if [[ "$code" != "200" ]]; then
      echo "smoke: fail: /settings с API_ACCESS_TOKEN вернул HTTP ${code:-n/a}"
      return 1
    fi
    echo "smoke: ok: /settings с токеном"
    return 0
  fi

  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$SMOKE_CURL_TIMEOUT" "$url" || true)"
  case "$code" in
    200|401|403)
      echo "smoke: ok: /settings без токена (ожидаемо: 200/401/403), http=${code}"
      return 0
      ;;
    *)
      echo "smoke: fail: /settings без токена вернул неожиданный HTTP ${code:-n/a}"
      return 1
      ;;
  esac
}

main() {
  local slug
  local api_host_port
  local web_host_port

  slug="$(detect_slug)"
  api_host_port="$(compose_host_port api 3001)"
  web_host_port="$(compose_host_port web 3000)"

  if [[ -z "$api_host_port" || -z "$web_host_port" ]]; then
    echo "smoke: fail: не удалось определить порты API/Web через docker compose port"
    return 1
  fi

  local api_base="http://${api_host_port}"
  local web_url="http://${web_host_port}/${slug}"

  echo "smoke: start (variant=${DEPLOY_VARIANT:-production}, slug=${slug})"
  wait_for_http_200 "${api_base}/health" "api health"
  wait_for_http_200 "${web_url}" "web base path"
  check_settings_endpoint "${api_base}"
  echo "smoke: all checks passed"
}

main "$@"
