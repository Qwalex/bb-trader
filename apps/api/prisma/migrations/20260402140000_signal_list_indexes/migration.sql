-- Ускорение списка сделок: фильтр deletedAt + сортировка по датам
CREATE INDEX IF NOT EXISTS "Signal_deletedAt_createdAt_idx" ON "Signal"("deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Signal_deletedAt_closedAt_idx" ON "Signal"("deletedAt", "closedAt");
