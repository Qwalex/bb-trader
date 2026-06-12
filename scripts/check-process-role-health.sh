#!/usr/bin/env bash
# Проверка capabilities по API_PROCESS_ROLE на cabinets (или другом env).
# Usage: ./scripts/check-process-role-health.sh [api_url]
set -euo pipefail

API_URL="${1:-https://qwalex-trader-cabinets-api.up.railway.app}"
echo "GET ${API_URL}/health"
curl -sf "${API_URL}/health" | python -m json.tool

echo ""
echo "Ожидаемые значения capabilities:"
echo "  Api:         userbotMtproto=false, telegramBots=true,  bybitPrivateWs=false, workerQueue=false, userAuthConfigured=true"
echo "  Worker-UB:   userbotMtproto=true,  telegramBots=false, bybitPrivateWs=false, userAuthConfigured=true"
echo "  Worker-Bybit: userbotMtproto=false, bybitPrivateWs=true,  workerQueue=true (if enabled), userAuthConfigured=true"
