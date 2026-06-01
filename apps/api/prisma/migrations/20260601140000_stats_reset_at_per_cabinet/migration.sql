-- Перенос legacy global STATS_RESET_AT в CabinetSetting по каждому кабинету (один раз).
INSERT INTO "CabinetSetting" ("id", "cabinetId", "key", "value", "createdAt", "updatedAt")
SELECT
  'csr_' || substr(md5(c."id" || ':' || s."value" || ':' || random()::text), 1, 22),
  c."id",
  'STATS_RESET_AT',
  s."value",
  NOW(),
  NOW()
FROM "Cabinet" c
CROSS JOIN "Setting" s
WHERE s."key" = 'STATS_RESET_AT'
  AND s."value" IS NOT NULL
  AND trim(s."value") <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM "CabinetSetting" cs
    WHERE cs."cabinetId" = c."id" AND cs."key" = 'STATS_RESET_AT'
  );
