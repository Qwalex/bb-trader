#!/usr/bin/env bash
# Деплой development-стека (docker-compose.dev.yml). Вызывать из каталога с клоном ветки development.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"
export PROJECT_NAME="${PROJECT_NAME:-bb-trade-dev}"
exec "$ROOT_DIR/restart.sh" "$@"
