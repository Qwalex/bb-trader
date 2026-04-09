#!/usr/bin/env bash
set -Eeuo pipefail

# Полный перенос стека между VPS:
# - backup: код + compose + env + docker volumes в один архив
# - restore: разворачивает архив, восстанавливает volumes и поднимает стек
#
# Примеры:
#   ./scripts/transfer-stack.sh backup
#   ./scripts/transfer-stack.sh backup --output /tmp/signalsbot-transfer.tar.gz
#   ./scripts/transfer-stack.sh restore --bundle /tmp/signalsbot-transfer.tar.gz --target-dir /opt/signalsBotProd
#
# Важно:
# - запускать backup на исходной VPS в корне проекта
# - запускать restore на целевой VPS

MODE="${1:-}"
if [[ -z "$MODE" || ( "$MODE" != "backup" && "$MODE" != "restore" ) ]]; then
  echo "Использование:"
  echo "  $0 backup  [--output <file.tar.gz>] [--compose-file <docker-compose.yml>] [--no-stop]"
  echo "  $0 restore --bundle <file.tar.gz> [--target-dir <dir>] [--compose-file <docker-compose.yml>] [--project-name <name>] [--no-start]"
  exit 1
fi
shift || true

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="docker-compose.yml"
OUTPUT_FILE=""
BUNDLE_FILE=""
TARGET_DIR="$REPO_ROOT"
PROJECT_NAME=""
STOP_STACK=1
START_STACK=1

# Можно переопределить через ENV_PATHS=".env apps/api/.env ..."
ENV_PATHS_DEFAULT=(
  ".env"
  ".env.local"
  "apps/api/.env"
  "apps/api/.env.local"
)
if [[ -n "${ENV_PATHS:-}" ]]; then
  # shellcheck disable=SC2206
  ENV_PATHS_ARR=(${ENV_PATHS})
else
  ENV_PATHS_ARR=("${ENV_PATHS_DEFAULT[@]}")
fi

log() { printf '[transfer] %s\n' "$*"; }
warn() { printf '[transfer][warn] %s\n' "$*" >&2; }
die() { printf '[transfer][error] %s\n' "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Не найдена команда: $1"
}

compose_cmd() {
  docker compose -f "$COMPOSE_FILE" "${@}"
}

volume_exists() {
  local v="$1"
  docker volume inspect "$v" >/dev/null 2>&1
}

resolve_existing_volume_name() {
  local logical="$1"
  if volume_exists "$logical"; then
    printf '%s\n' "$logical"
    return 0
  fi
  local candidate
  candidate="$(docker volume ls --format '{{.Name}}' | awk -v s="_${logical}$" '$0 ~ s {print $0; exit}')"
  if [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  return 1
}

resolve_or_create_target_volume_name() {
  local logical="$1"
  local project="$2"

  if resolved="$(resolve_existing_volume_name "$logical")"; then
    printf '%s\n' "$resolved"
    return 0
  fi

  local created="${project}_${logical}"
  if ! volume_exists "$created"; then
    docker volume create "$created" >/dev/null
  fi
  printf '%s\n' "$created"
}

ensure_compose_file() {
  [[ -f "$COMPOSE_FILE" ]] || die "Файл compose не найден: $COMPOSE_FILE"
}

read_logical_volumes() {
  compose_cmd config --volumes 2>/dev/null || true
}

copy_project_snapshot() {
  local out_tar="$1"
  tar \
    --exclude='.git' \
    --exclude='node_modules' \
    --exclude='**/node_modules' \
    --exclude='.next' \
    --exclude='**/.next' \
    --exclude='dist' \
    --exclude='**/dist' \
    --exclude='coverage' \
    --exclude='**/coverage' \
    --exclude='tmp' \
    --exclude='**/tmp' \
    -czf "$out_tar" \
    -C "$REPO_ROOT" .
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --compose-file)
        COMPOSE_FILE="$2"
        shift 2
        ;;
      --output)
        OUTPUT_FILE="$2"
        shift 2
        ;;
      --bundle)
        BUNDLE_FILE="$2"
        shift 2
        ;;
      --target-dir)
        TARGET_DIR="$2"
        shift 2
        ;;
      --project-name)
        PROJECT_NAME="$2"
        shift 2
        ;;
      --no-stop)
        STOP_STACK=0
        shift
        ;;
      --no-start)
        START_STACK=0
        shift
        ;;
      *)
        die "Неизвестный аргумент: $1"
        ;;
    esac
  done
}

do_backup() {
  require_cmd docker
  require_cmd tar
  require_cmd awk
  require_cmd mktemp

  cd "$REPO_ROOT"
  ensure_compose_file

  local ts tmp_dir bundle_name
  ts="$(date +%Y%m%d-%H%M%S)"
  bundle_name="signalsbot-transfer-${ts}.tar.gz"
  if [[ -z "$OUTPUT_FILE" ]]; then
    OUTPUT_FILE="${REPO_ROOT}/${bundle_name}"
  fi
  OUTPUT_FILE="$(cd "$(dirname "$OUTPUT_FILE")" && pwd)/$(basename "$OUTPUT_FILE")"

  tmp_dir="$(mktemp -d)"
  mkdir -p "$tmp_dir/meta" "$tmp_dir/volumes" "$tmp_dir/env"

  if [[ "$STOP_STACK" -eq 1 ]]; then
    log "Останавливаю стек перед бэкапом"
    compose_cmd down
  else
    warn "Бэкап без остановки стека: для SQLite это риск неконсистентного снапшота"
  fi

  log "Сохраняю snapshot проекта"
  copy_project_snapshot "$tmp_dir/project.tar.gz"

  log "Сохраняю env-файлы (если есть)"
  : >"$tmp_dir/meta/env-files.txt"
  for rel in "${ENV_PATHS_ARR[@]}"; do
    if [[ -f "$REPO_ROOT/$rel" ]]; then
      mkdir -p "$tmp_dir/env/$(dirname "$rel")"
      cp "$REPO_ROOT/$rel" "$tmp_dir/env/$rel"
      printf '%s\n' "$rel" >>"$tmp_dir/meta/env-files.txt"
    fi
  done

  log "Сохраняю compose-файл"
  cp "$COMPOSE_FILE" "$tmp_dir/meta/compose-file.yml"

  local logical_volumes
  logical_volumes="$(read_logical_volumes)"
  if [[ -z "$logical_volumes" ]]; then
    warn "В compose не найдено volumes"
  fi

  : >"$tmp_dir/meta/volumes-map.txt"
  while IFS= read -r logical; do
    [[ -z "$logical" ]] && continue
    local actual
    if ! actual="$(resolve_existing_volume_name "$logical")"; then
      warn "Volume для '$logical' не найден, пропускаю"
      continue
    fi
    log "Архивирую volume: ${logical} (${actual})"
    docker run --rm \
      -v "${actual}:/from:ro" \
      -v "${tmp_dir}/volumes:/to" \
      alpine sh -c "tar czf /to/${logical}.tar.gz -C /from ."
    printf '%s=%s\n' "$logical" "$actual" >>"$tmp_dir/meta/volumes-map.txt"
  done <<<"$logical_volumes"

  cat >"$tmp_dir/meta/manifest.env" <<EOF
CREATED_AT=${ts}
SOURCE_REPO_ROOT=${REPO_ROOT}
COMPOSE_FILE=${COMPOSE_FILE}
EOF

  log "Формирую итоговый архив: $OUTPUT_FILE"
  tar -czf "$OUTPUT_FILE" -C "$tmp_dir" .

  rm -rf "$tmp_dir"
  log "Готово: $OUTPUT_FILE"
  log "Далее скопируйте архив на новую VPS и выполните restore"
}

do_restore() {
  require_cmd docker
  require_cmd tar
  require_cmd awk
  require_cmd mktemp
  require_cmd rsync

  [[ -n "$BUNDLE_FILE" ]] || die "Укажите --bundle <file.tar.gz>"
  [[ -f "$BUNDLE_FILE" ]] || die "Файл архива не найден: $BUNDLE_FILE"

  mkdir -p "$TARGET_DIR"
  TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"
  if [[ -z "$PROJECT_NAME" ]]; then
    PROJECT_NAME="$(basename "$TARGET_DIR" | tr '[:upper:]' '[:lower:]')"
  fi

  local tmp_dir
  tmp_dir="$(mktemp -d)"
  tar -xzf "$BUNDLE_FILE" -C "$tmp_dir"

  mkdir -p "$TARGET_DIR"
  log "Восстанавливаю snapshot проекта в $TARGET_DIR"
  tar -xzf "$tmp_dir/project.tar.gz" -C "$TARGET_DIR"

  log "Восстанавливаю env-файлы"
  if [[ -f "$tmp_dir/meta/env-files.txt" ]]; then
    while IFS= read -r rel; do
      [[ -z "$rel" ]] && continue
      mkdir -p "$TARGET_DIR/$(dirname "$rel")"
      if [[ -f "$tmp_dir/env/$rel" ]]; then
        cp "$tmp_dir/env/$rel" "$TARGET_DIR/$rel"
      fi
    done <"$tmp_dir/meta/env-files.txt"
  fi

  cd "$TARGET_DIR"
  COMPOSE_FILE="$TARGET_DIR/${COMPOSE_FILE}"
  if [[ ! -f "$COMPOSE_FILE" && -f "$tmp_dir/meta/compose-file.yml" ]]; then
    COMPOSE_FILE="$TARGET_DIR/docker-compose.yml"
    cp "$tmp_dir/meta/compose-file.yml" "$COMPOSE_FILE"
  fi
  ensure_compose_file

  if [[ "$STOP_STACK" -eq 1 ]]; then
    log "Останавливаю стек перед восстановлением volume"
    compose_cmd --project-name "$PROJECT_NAME" down || true
  fi

  log "Создаю/резолвлю volumes и восстанавливаю данные"
  if [[ -f "$tmp_dir/meta/volumes-map.txt" ]]; then
    while IFS= read -r row; do
      [[ -z "$row" ]] && continue
      local logical actual_target
      logical="${row%%=*}"
      actual_target="$(resolve_or_create_target_volume_name "$logical" "$PROJECT_NAME")"
      if [[ ! -f "$tmp_dir/volumes/${logical}.tar.gz" ]]; then
        warn "Не найден архив volume для ${logical}, пропускаю"
        continue
      fi
      log "Восстанавливаю ${logical} -> ${actual_target}"
      docker run --rm \
        -v "${actual_target}:/to" \
        -v "${tmp_dir}/volumes:/from:ro" \
        alpine sh -c "rm -rf /to/* /to/.[!.]* /to/..?* 2>/dev/null || true; tar xzf /from/${logical}.tar.gz -C /to"
    done <"$tmp_dir/meta/volumes-map.txt"
  else
    warn "Файл volumes-map.txt отсутствует, восстановление volume пропущено"
  fi

  if [[ "$START_STACK" -eq 1 ]]; then
    log "Запускаю стек"
    compose_cmd --project-name "$PROJECT_NAME" up -d
  else
    warn "Автозапуск отключен (--no-start)"
  fi

  rm -rf "$tmp_dir"
  log "Restore завершен"
}

parse_args "$@"

if [[ "$MODE" == "backup" ]]; then
  do_backup
else
  do_restore
fi

