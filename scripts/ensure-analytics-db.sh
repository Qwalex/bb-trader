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

# Logflare подключается как supabase_admin (см. docker-compose analytics).
echo "Granting supabase_admin access to _supabase..."
docker compose -f "$FILE" exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c \
  "GRANT CONNECT ON DATABASE _supabase TO supabase_admin; GRANT ALL PRIVILEGES ON DATABASE _supabase TO supabase_admin;"

echo "Ensuring schema _analytics..."
docker compose -f "$FILE" exec -T db psql -U postgres -d _supabase -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA IF NOT EXISTS _analytics;
ALTER SCHEMA _analytics OWNER TO postgres;
GRANT USAGE, CREATE ON SCHEMA _analytics TO supabase_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA _analytics TO supabase_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA _analytics TO supabase_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA _analytics GRANT ALL ON TABLES TO supabase_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA _analytics GRANT ALL ON SEQUENCES TO supabase_admin;
SQL

echo "OK. Перезапустите analytics и studio:"
echo "  docker compose -f $FILE restart analytics studio"
echo ""
echo "Если команда exec пишет «service db is not running» — запустите стек из этого каталога:"
echo "  docker compose -f $FILE up -d db"
echo "Сообщения про queue_timeout / pool без FATAL _supabase обычно следствие недоступной БД выше."
