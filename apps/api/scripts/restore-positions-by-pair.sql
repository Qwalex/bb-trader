-- Восстановление ORDERS_PLACED по списку пар (после ложного stale reconcile).
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
  AND pair IN (
    'DOTUSDT',
    'AVAXUSDT',
    'ADAUSDT',
    'UNIUSDT',
    'NEARUSDT',
    'LINKUSDT',
    'BCHUSDT',
    'ICPUSDT',
    'TAOUSDT',
    'ASTERUSDT',
    'JUPUSDT'
  );
