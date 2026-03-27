#!/usr/bin/env bash
set -Eeuo pipefail

NOTIFY_URL="https://dev.qwalex.ru/notify/"
PROJECT_NAME="bb-trade"

LOG_FILE="$(mktemp -t "${PROJECT_NAME}-restart.XXXXXX.log")"

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

notify() {
  local text="$1"
  local payload
  payload="{\"text\":\"$(json_escape "$text")\"}"

  curl -X POST "$NOTIFY_URL" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --fail \
    --show-error \
    --silent || echo "curl error"
}

on_error() {
  local exit_code="$?"
  local cmd="${BASH_COMMAND:-unknown}"
  local tail_log
  tail_log="$(tail -n 80 "$LOG_FILE" 2>/dev/null || true)"

  notify $'❌ Обновление проекта '"$PROJECT_NAME"$' завершилось ошибкой.\n\nКоманда:\n'"$cmd"$'\n\nКод выхода: '"$exit_code"$'\n\nПоследние строки лога:\n'"$tail_log"
  exit "$exit_code"
}

cleanup() {
  rm -f "$LOG_FILE" >/dev/null 2>&1 || true
}

trap on_error ERR
trap cleanup EXIT

exec > >(tee -a "$LOG_FILE") 2>&1

# Опционально: перед pull из приватного GHCR задать на сервере или передать из CI:
#   echo "$GHCR_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
if [[ -n "${GHCR_TOKEN:-}" && -n "${GHCR_USERNAME:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

# Один fetch + жёсткий сброс на origin (быстрее, чем fetch + reset HEAD + pull).
# SKIP_GIT=1 — пропустить git (только образы из registry; compose/restart.sh на диске не обновятся).
if [[ "${SKIP_GIT:-}" != "1" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  git fetch origin
  git reset --hard "origin/${branch}"
fi

# Деплой из registry (CI задаёт API_IMAGE и WEB_IMAGE): pull слоёв + recreate.
# Локально без образов в registry: сборка на месте с кэшем слоёв.
if [[ -n "${API_IMAGE:-}" && -n "${WEB_IMAGE:-}" ]]; then
  docker compose pull
  docker compose up -d --remove-orphans
else
  docker compose up -d --build --remove-orphans
fi

notify "✅ Проект ${PROJECT_NAME} обновлён без ошибок."
