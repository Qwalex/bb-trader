-- Prevent duplicate active signals per pair+direction.
-- SQLite supports partial unique indexes.
CREATE UNIQUE INDEX "Signal_active_pair_direction_unique"
ON "Signal"("pair", "direction")
WHERE "deletedAt" IS NULL
  AND "status" IN ('PENDING', 'ORDERS_PLACED');
