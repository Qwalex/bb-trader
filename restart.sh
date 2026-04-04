#!/usr/bin/env bash
set -Eeuo pipefail

NOTIFY_URL="${NOTIFY_URL:-https://dev.qwalex.ru/notify/}"
PROJECT_NAME="${PROJECT_NAME:-bb-trade}"
DEPLOY_VARIANT="${DEPLOY_VARIANT:-production}"
DEPLOY_WRAPPER="${DEPLOY_WRAPPER:-restart.sh}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Состояние только на VPS (не коммитить): последний успешный деплой из registry и журнал.
LAST_GOOD_ENV="$ROOT_DIR/.last-good-deploy.env"
HISTORY_LOG="$ROOT_DIR/.deploy-history.log"
# При ошибке деплоя — append логов контейнеров для разбора на VPS.
COMPOSE_FAILURE_LOG="$ROOT_DIR/.deploy-compose-failure.log"

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

# Список постоянных файлов с логами на VPS (для текста уведомлений).
# strict=1 — после записи логов ошибки деплоя; strict=0 — мягкая формулировка (напр. общий ERR).
deploy_saved_files_notice() {
  local strict="${1:-1}"
  if [[ "$strict" == "1" ]]; then
    echo "Логи ошибки сохранены в файлы:"
  else
    echo "На сервере в каталоге проекта для разбора могут быть полезны файлы:"
  fi
  echo "• ${COMPOSE_FAILURE_LOG} — docker compose ps и логи контейнеров (дописывается при каждом снимке)"
  echo "• ${HISTORY_LOG} — журнал событий деплоя (успехи и откаты)"
  echo "• ${LAST_GOOD_ENV} — последний успешный деплой из registry (переменные образов)"
}

append_deploy_history() {
  local status="$1"
  local ref="${2:-unknown}"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ)"$'\t'"$status"$'\t'"$ref" >> "$HISTORY_LOG"
}

write_last_good_registry_env() {
  umask 077
  {
    echo "# Сгенерировано restart.sh после успешного деплоя из registry. Не коммитить."
    echo "export API_IMAGE=$(printf '%q' "${API_IMAGE:-}")"
    echo "export WEB_IMAGE=$(printf '%q' "${WEB_IMAGE:-}")"
  } > "$LAST_GOOD_ENV"
  chmod 600 "$LAST_GOOD_ENV" 2>/dev/null || true
}

deploy_from_registry() {
  docker compose pull
  docker compose up -d --remove-orphans
}

# Дописывает в файл снимок `docker compose logs` (для анализа после сбоя).
dump_compose_failure_logs() {
  local label="${1:-deploy}"
  {
    echo ""
    echo "======== $(date -u +%Y-%m-%dT%H:%M:%SZ) — $label ========"
    docker compose ps -a 2>&1 || true
    echo "---- logs (последние строки по каждому сервису) ----"
    docker compose logs --no-color --tail 800 2>&1 || echo "(docker compose logs недоступен: $?)"
  } >> "$COMPOSE_FAILURE_LOG"
}

report_deploy_failure_no_rollback() {
  dump_compose_failure_logs "registry: финальная ошибка (откат невозможен или не помог)"
  local tail_log
  tail_log="$(tail -n 80 "$LOG_FILE" 2>/dev/null || true)"
  notify $'❌ '"$DEPLOY_VARIANT"$' деплой не удался (источник: '"$DEPLOY_WRAPPER"$'); откат недоступен (нет файла прошлого успеха) или откат тоже упал.\n\n'"$(deploy_saved_files_notice 1)"$'\n\nПоследние строки лога restart:\n'"$tail_log"
  exit 1
}

on_error() {
  local exit_code="$?"
  local cmd="${BASH_COMMAND:-unknown}"
  local tail_log
  tail_log="$(tail -n 80 "$LOG_FILE" 2>/dev/null || true)"

  notify $'❌ '"$DEPLOY_VARIANT"$' обновление '"$PROJECT_NAME"$' завершилось ошибкой (источник: '"$DEPLOY_WRAPPER"$').\n\nКоманда:\n'"$cmd"$'\n\nКод выхода: '"$exit_code"$'\n\nПоследние строки лога:\n'"$tail_log"$'\n\n'"$(deploy_saved_files_notice 0)"
  exit "$exit_code"
}

cleanup() {
  rm -f "$LOG_FILE" >/dev/null 2>&1 || true
}

trap on_error ERR
trap cleanup EXIT

exec > >(tee -a "$LOG_FILE") 2>&1

cd "$ROOT_DIR"

# Опционально: перед pull из приватного GHCR задать на сервере или передать из CI:
#   echo "$GHCR_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
if [[ -n "${GHCR_TOKEN:-}" && -n "${GHCR_USERNAME:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

# Один fetch; жёсткий сброс выполняется только при явном разрешении.
# SKIP_GIT=1 — пропустить git (только образы из registry; compose/restart.sh на диске не обновятся).
# ALLOW_GIT_HARD_RESET=1 — разрешить destructive sync до origin/<branch>.
if [[ "${SKIP_GIT:-}" != "1" ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  git fetch origin
  if [[ "${ALLOW_GIT_HARD_RESET:-}" == "1" ]]; then
    git reset --hard "origin/${branch}"
  else
    git merge --ff-only "origin/${branch}"
  fi
fi

# Деплой из registry (CI задаёт API_IMAGE и WEB_IMAGE): pull слоёв + recreate.
# Локально без образов в registry: сборка на месте с кэшем слоёв.
# При ошибке registry-деплоя — повтор с переменными из .last-good-deploy.env (последний успех на этом сервере).
if [[ -n "${API_IMAGE:-}" && -n "${WEB_IMAGE:-}" ]]; then
  ATTEMPT_REF="${API_IMAGE##*:}"
  if deploy_from_registry; then
    write_last_good_registry_env
    append_deploy_history "ok" "$ATTEMPT_REF"
  else
    dump_compose_failure_logs "registry: первый деплой не удался (до отката)"
    # Временнo отключено по запросу: при неудачном registry deploy не откатываемся
    # к предыдущему образу автоматически, а сразу завершаем деплой ошибкой.
    # if [[ -f "$LAST_GOOD_ENV" && "${ROLLBACK_IN_PROGRESS:-}" != "1" ]]; then
    #   # shellcheck disable=SC1090
    #   if source "$LAST_GOOD_ENV" 2>/dev/null; then
    #     export ROLLBACK_IN_PROGRESS=1
    #     ROLLBACK_REF="${API_IMAGE##*:}"
    #     notify $'⚠️ Деплой не удался. Откат к последнему успешному образу ('"$ROLLBACK_REF"').\n\n'"$(deploy_saved_files_notice 1)"
    #     if deploy_from_registry; then
    #       append_deploy_history "rollback_ok" "$ROLLBACK_REF"
    #       notify "✅ Откат выполнен. Проект ${PROJECT_NAME} снова на образе ${ROLLBACK_REF}."
    #       exit 0
    #     fi
    #   fi
    # fi
    report_deploy_failure_no_rollback
  fi
else
  if docker compose up -d --build --remove-orphans; then
    GIT_REF="$(git rev-parse --short HEAD 2>/dev/null || echo local-build)"
    append_deploy_history "ok" "$GIT_REF"
  else
    dump_compose_failure_logs "локальная сборка (docker compose up --build)"
    tail_log="$(tail -n 80 "$LOG_FILE" 2>/dev/null || true)"
    notify $'❌ Локальная сборка не удалась.\n\n'"$(deploy_saved_files_notice 1)"$'\n\nПоследние строки лога restart:\n'"$tail_log"
    exit 1
  fi
fi

notify "✅ ${DEPLOY_VARIANT} стенд: проект ${PROJECT_NAME} обновлён без ошибок (источник: ${DEPLOY_WRAPPER})."
