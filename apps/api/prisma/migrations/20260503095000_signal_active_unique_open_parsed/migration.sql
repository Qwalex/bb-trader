-- Keep one active signal per cabinet+pair+direction across full active lifecycle.
DROP INDEX IF EXISTS "Signal_active_pair_direction_unique";
CREATE UNIQUE INDEX "Signal_active_pair_direction_unique"
ON "Signal"("cabinetId", "pair", "direction")
WHERE "deletedAt" IS NULL
  AND "status" IN ('PENDING', 'ORDERS_PLACED', 'OPEN', 'PARSED');
