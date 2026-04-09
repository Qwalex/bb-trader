#!/usr/bin/env bash
set -u

TARGET_HOST="${1:-80.76.32.76}"
TARGET_USER="${2:-root}"
INTERVAL_SEC="${3:-5}"
NOTIFY_URL="http://dev.qwalex.ru/notify?text=vps_is_live"

if [[ ! "$INTERVAL_SEC" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_SEC" -lt 1 ]]; then
  echo "INTERVAL_SEC must be a positive integer"
  exit 1
fi

check_ssh() {
  local out rc
  out="$(ssh \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o ConnectTimeout=4 \
    "${TARGET_USER}@${TARGET_HOST}" "exit" 2>&1)"
  rc=$?

  if [[ $rc -eq 0 ]]; then
    printf "UP (auth ok)"
    return
  fi

  if [[ "$out" == *"Permission denied"* ]] || [[ "$out" == *"Authentication failed"* ]]; then
    printf "UP (reachable, auth denied)"
    return
  fi

  printf "DOWN (%s)" "$(echo "$out" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | sed 's/[[:space:]]*$//')"
}

echo "Watching SSH availability for ${TARGET_USER}@${TARGET_HOST} every ${INTERVAL_SEC}s"
last_state="unknown"
while true; do
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  status="$(check_ssh)"
  echo "[${ts}] ${status}"

  if [[ "$status" == UP* ]]; then
    current_state="up"
  else
    current_state="down"
  fi

  # Notify only on transition from DOWN/unknown to UP.
  if [[ "$current_state" == "up" && "$last_state" != "up" ]]; then
    curl -fsS --max-time 10 "$NOTIFY_URL" >/dev/null 2>&1 || true
    echo "[${ts}] Sent notification: vps_is_live"
  fi

  last_state="$current_state"
  sleep "${INTERVAL_SEC}"
done
