#!/usr/bin/env bash
# Однократно (или при новом томе) создаёт БД _supabase и схему _analytics для Logflare / analytics в dev-стеке.
# Вызывать из корня репозитория на VPS, где поднят docker-compose.dev.yml:
#   ./scripts/ensure-analytics-db.sh
# Или: COMPOSE_FILE=docker-compose.dev.yml ./scripts/ensure-analytics-db.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FILE="${COMPOSE_FILE:-docker-compose.dev.yml}"

have_db=$(
  docker compose -f "$FILE" exec -T db psql -U postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='_supabase'" 2>/dev/null | tr -d '[:space:]' || true
)

if [[ "$have_db" != "1" ]]; then
  echo "Creating database _supabase..."
  docker compose -f "$FILE" exec -T db psql -U postgres -v ON_ERROR_STOP=1 -c \
    "CREATE DATABASE _supabase WITH OWNER postgres;"
fi

echo "Ensuring schema _analytics..."
docker compose -f "$FILE" exec -T db psql -U postgres -d _supabase -v ON_ERROR_STOP=1 -c \
  "CREATE SCHEMA IF NOT EXISTS _analytics; ALTER SCHEMA _analytics OWNER TO postgres;"

echo "OK. Перезапустите analytics и studio, если они уже падали:"
echo "  docker compose -f $FILE restart analytics studio"
