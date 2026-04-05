#!/bin/sh
# Вывести HS256 JWT для anon и service_role под заданным секретом (как в
# https://github.com/supabase/supabase/blob/master/docker/utils/generate-keys.sh).
# Использование:
#   SUPABASE_JWT_SECRET='ваш_секрет_из_.env' sh scripts/supabase-jwt-keys-from-secret.sh
# Затем обновите в .env: SUPABASE_ANON_KEY, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SERVICE_ROLE_KEY_SERVER (одинаковые пары).
set -e

base64_url_encode() {
  openssl enc -base64 -A | tr '+/' '-_' | tr -d '='
}

gen_token() {
  payload=$1
  payload_base64=$(printf %s "$payload" | base64_url_encode)
  header_base64=$(printf %s "$header" | base64_url_encode)
  signed_content="${header_base64}.${payload_base64}"
  signature=$(printf %s "$signed_content" | openssl dgst -binary -sha256 -hmac "$jwt_secret" | base64_url_encode)
  printf '%s' "${signed_content}.${signature}"
}

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl не найден" >&2
  exit 1
fi

jwt_secret=${SUPABASE_JWT_SECRET:-}
if [ -z "$jwt_secret" ]; then
  echo "Задайте SUPABASE_JWT_SECRET (значение из .env, без кавычек)." >&2
  exit 1
fi

header='{"alg":"HS256","typ":"JWT"}'
iat=$(date +%s)
exp=$((iat + 5 * 3600 * 24 * 365))

anon_payload="{\"role\":\"anon\",\"iss\":\"supabase\",\"iat\":$iat,\"exp\":$exp}"
service_role_payload="{\"role\":\"service_role\",\"iss\":\"supabase\",\"iat\":$iat,\"exp\":$exp}"

anon_key=$(gen_token "$anon_payload")
service_role_key=$(gen_token "$service_role_payload")

echo "SUPABASE_ANON_KEY=${anon_key}"
echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon_key}"
echo "SUPABASE_SERVICE_ROLE_KEY=${service_role_key}"
echo "SUPABASE_SERVICE_ROLE_KEY_SERVER=${service_role_key}"
