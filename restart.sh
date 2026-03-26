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

# Пишем весь вывод в лог, но сохраняем вывод и в консоль GitHub Actions/SSH.
exec > >(tee -a "$LOG_FILE") 2>&1

git fetch
git reset --hard HEAD
git pull

# 1) Остановить и удалить контейнеры этого compose-проекта
docker compose down --remove-orphans
# 2) Пересобрать образы без кэша (и с обновлением базового образа)
docker compose build --no-cache --pull
# 3) Поднять заново
docker compose up -d

notify "✅ Проект ${PROJECT_NAME} обновлён без ошибок."
