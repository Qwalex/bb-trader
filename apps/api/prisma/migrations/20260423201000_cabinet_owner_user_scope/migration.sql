ALTER TABLE "Cabinet"
ADD COLUMN "ownerUserId" TEXT;

CREATE INDEX "Cabinet_ownerUserId_createdAt_idx"
ON "Cabinet"("ownerUserId", "createdAt");

ALTER TABLE "Cabinet"
ADD CONSTRAINT "Cabinet_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "AuthUser"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

