#!/usr/bin/env bash
# Деплой test-стека (docker-compose.test.yml): отдельная БД, префикс URL trade-test.
# На VPS: каталог /root/bb-trader-test (ветка test). Иначе задайте секрет VPS_TEST_PATH в GitHub Actions.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
export PROJECT_NAME="${PROJECT_NAME:-bb-trade-test}"
export DEPLOY_VARIANT="${DEPLOY_VARIANT:-test}"
export DEPLOY_WRAPPER="${DEPLOY_WRAPPER:-restart-test.sh}"
exec "$ROOT_DIR/restart.sh" "$@"
