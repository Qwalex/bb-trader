ALTER TABLE "AppLog"
ADD COLUMN "cabinetId" TEXT;

CREATE INDEX "AppLog_cabinetId_createdAt_idx"
ON "AppLog"("cabinetId", "createdAt");

ALTER TABLE "AppLog"
ADD CONSTRAINT "AppLog_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

