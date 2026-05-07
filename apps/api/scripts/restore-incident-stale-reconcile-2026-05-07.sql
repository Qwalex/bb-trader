-- Восстановление сигналов, ошибочно переведённых в CLOSED_MIXED
-- при инциденте "ложно чистая биржа" из-за Forbidden/сбоев Bybit API.
-- Окно инцидента (UTC): 2026-05-06 21:12–21:15 (~00:12 МСК 07.05.2026).
--
-- Перед UPDATE обязательно сверить выборку и состояние на Bybit:
-- SELECT id, pair, direction, status, "closedAt"
-- FROM "Signal"
-- WHERE status = 'CLOSED_MIXED'
--   AND "deletedAt" IS NULL
--   AND "realizedPnl" IS NULL
--   AND "closedAt" >= '2026-05-06 21:12:00'::timestamptz
--   AND "closedAt" <= '2026-05-06 21:15:00'::timestamptz;

BEGIN;

UPDATE "Signal"
SET
  status = 'ORDERS_PLACED',
  "closedAt" = NULL,
  "realizedPnl" = NULL,
  "updatedAt" = NOW()
WHERE
  "deletedAt" IS NULL
  AND status = 'CLOSED_MIXED'
  AND "realizedPnl" IS NULL
  AND "closedAt" IS NOT NULL
  AND "closedAt" >= '2026-05-06 21:12:00'::timestamptz
  AND "closedAt" <= '2026-05-06 21:15:00'::timestamptz;

COMMIT;
