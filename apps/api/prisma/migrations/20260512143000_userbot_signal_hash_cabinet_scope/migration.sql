-- Userbot signal hash dedup is per cabinet (was global by hash only).
DROP TABLE IF EXISTS "TgUserbotSignalHash";

CREATE TABLE "TgUserbotSignalHash" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgUserbotSignalHash_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TgUserbotSignalHash_cabinetId_hash_key" UNIQUE ("cabinetId", "hash"),
    CONSTRAINT "TgUserbotSignalHash_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TgUserbotSignalHash_hash_idx" ON "TgUserbotSignalHash"("hash");
CREATE INDEX "TgUserbotSignalHash_cabinetId_idx" ON "TgUserbotSignalHash"("cabinetId");
