-- CreateTable
CREATE TABLE "Cabinet" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cabinet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CabinetMember" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CabinetMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CabinetSetting" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CabinetSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CabinetTelegramSource" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sourcePriority" INTEGER NOT NULL DEFAULT 0,
    "defaultLeverage" INTEGER,
    "forcedLeverage" INTEGER,
    "leverageRangeMode" TEXT,
    "minLeverage" INTEGER,
    "maxLeverage" INTEGER,
    "defaultEntryUsd" TEXT,
    "minLotBump" BOOLEAN,
    "martingaleMultiplier" DOUBLE PRECISION,
    "tpSlStepStart" TEXT,
    "tpSlStepRange" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CabinetTelegramSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CabinetIngestRoute" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "ingestId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'other',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "error" TEXT,
    "aiRequest" TEXT,
    "aiResponse" TEXT,
    "signalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CabinetIngestRoute_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Signal" ADD COLUMN "cabinetId" TEXT;

-- AlterTable
ALTER TABLE "BalanceSnapshot" ADD COLUMN "cabinetId" TEXT;

-- AlterTable
ALTER TABLE "OpenrouterGenerationCost" ADD COLUMN "cabinetId" TEXT;

-- AlterTable
ALTER TABLE "TgUserbotPublishGroup" ADD COLUMN "cabinetId" TEXT;

-- AlterTable
ALTER TABLE "TgUserbotMirrorMessage" ADD COLUMN "cabinetId" TEXT;

-- Pre-create unique indexes used by ON CONFLICT in backfill inserts
CREATE UNIQUE INDEX "CabinetSetting_cabinetId_key_key" ON "CabinetSetting"("cabinetId", "key");
CREATE UNIQUE INDEX "CabinetTelegramSource_cabinetId_chatId_key" ON "CabinetTelegramSource"("cabinetId", "chatId");
CREATE UNIQUE INDEX "CabinetIngestRoute_cabinetId_ingestId_key" ON "CabinetIngestRoute"("cabinetId", "ingestId");

-- Seed default cabinet
INSERT INTO "Cabinet" ("id", "slug", "name", "isDefault", "createdAt", "updatedAt")
VALUES ('cab_main', 'main', 'Main', true, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- Keep one default cabinet invariant if rerun
UPDATE "Cabinet" SET "isDefault" = CASE WHEN "id" = 'cab_main' THEN true ELSE false END;

-- Backfill cabinet links for existing data
UPDATE "Signal" SET "cabinetId" = 'cab_main' WHERE "cabinetId" IS NULL;
UPDATE "BalanceSnapshot" SET "cabinetId" = 'cab_main' WHERE "cabinetId" IS NULL;
UPDATE "OpenrouterGenerationCost" SET "cabinetId" = 'cab_main' WHERE "cabinetId" IS NULL;
UPDATE "TgUserbotPublishGroup" SET "cabinetId" = 'cab_main' WHERE "cabinetId" IS NULL;
UPDATE "TgUserbotMirrorMessage" SET "cabinetId" = 'cab_main' WHERE "cabinetId" IS NULL;

-- Move current source-level chat settings into default cabinet relation
INSERT INTO "CabinetTelegramSource" (
    "id",
    "cabinetId",
    "chatId",
    "enabled",
    "sourcePriority",
    "defaultLeverage",
    "forcedLeverage",
    "leverageRangeMode",
    "minLeverage",
    "maxLeverage",
    "defaultEntryUsd",
    "minLotBump",
    "createdAt",
    "updatedAt"
)
SELECT
    CONCAT('cts_', "id"),
    'cab_main',
    "chatId",
    "enabled",
    "sourcePriority",
    "defaultLeverage",
    "forcedLeverage",
    "leverageRangeMode",
    "minLeverage",
    "maxLeverage",
    "defaultEntryUsd",
    "minLotBump",
    NOW(),
    NOW()
FROM "TgUserbotChat"
ON CONFLICT ("cabinetId", "chatId") DO NOTHING;

-- Backfill ingest routes for existing history (single default cabinet)
INSERT INTO "CabinetIngestRoute" (
    "id",
    "cabinetId",
    "ingestId",
    "chatId",
    "classification",
    "status",
    "error",
    "aiRequest",
    "aiResponse",
    "createdAt",
    "updatedAt"
)
SELECT
    CONCAT('cir_', "id"),
    'cab_main',
    "id",
    "chatId",
    "classification",
    "status",
    "error",
    "aiRequest",
    "aiResponse",
    NOW(),
    NOW()
FROM "TgUserbotIngest"
ON CONFLICT ("cabinetId", "ingestId") DO NOTHING;

-- Copy existing settings into default cabinet settings (preserve current behavior)
INSERT INTO "CabinetSetting" ("id", "cabinetId", "key", "value", "createdAt", "updatedAt")
SELECT
    CONCAT('cset_', "key"),
    'cab_main',
    "key",
    "value",
    NOW(),
    NOW()
FROM "Setting"
ON CONFLICT ("cabinetId", "key") DO NOTHING;

-- Indexes
CREATE UNIQUE INDEX "Cabinet_slug_key" ON "Cabinet"("slug");
CREATE INDEX "Cabinet_isDefault_idx" ON "Cabinet"("isDefault");

CREATE UNIQUE INDEX "CabinetMember_cabinetId_telegramUserId_key" ON "CabinetMember"("cabinetId", "telegramUserId");
CREATE INDEX "CabinetMember_telegramUserId_isActive_idx" ON "CabinetMember"("telegramUserId", "isActive");

CREATE INDEX "CabinetSetting_cabinetId_updatedAt_idx" ON "CabinetSetting"("cabinetId", "updatedAt");

CREATE INDEX "CabinetTelegramSource_chatId_enabled_idx" ON "CabinetTelegramSource"("chatId", "enabled");

CREATE INDEX "CabinetIngestRoute_ingestId_createdAt_idx" ON "CabinetIngestRoute"("ingestId", "createdAt");
CREATE INDEX "CabinetIngestRoute_cabinetId_createdAt_idx" ON "CabinetIngestRoute"("cabinetId", "createdAt");

CREATE INDEX "Signal_cabinetId_deletedAt_createdAt_idx" ON "Signal"("cabinetId", "deletedAt", "createdAt");
CREATE INDEX "Signal_cabinetId_deletedAt_closedAt_idx" ON "Signal"("cabinetId", "deletedAt", "closedAt");
CREATE INDEX "BalanceSnapshot_cabinetId_createdAt_idx" ON "BalanceSnapshot"("cabinetId", "createdAt");
CREATE INDEX "OpenrouterGenerationCost_cabinetId_createdAt_idx" ON "OpenrouterGenerationCost"("cabinetId", "createdAt");
CREATE INDEX "TgUserbotPublishGroup_cabinetId_enabled_idx" ON "TgUserbotPublishGroup"("cabinetId", "enabled");
CREATE INDEX "TgUserbotMirrorMessage_cabinetId_createdAt_idx" ON "TgUserbotMirrorMessage"("cabinetId", "createdAt");

-- Replace unique chatId scope for publish groups
DROP INDEX "TgUserbotPublishGroup_chatId_key";
CREATE UNIQUE INDEX "TgUserbotPublishGroup_cabinetId_chatId_key"
ON "TgUserbotPublishGroup"("cabinetId", "chatId");

-- Replace global active-signal uniqueness with per-cabinet uniqueness
DROP INDEX "Signal_active_pair_direction_unique";
CREATE UNIQUE INDEX "Signal_active_pair_direction_unique"
ON "Signal"("cabinetId", "pair", "direction")
WHERE "deletedAt" IS NULL
  AND "status" IN ('PENDING', 'ORDERS_PLACED');

-- Foreign keys
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BalanceSnapshot" ADD CONSTRAINT "BalanceSnapshot_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OpenrouterGenerationCost" ADD CONSTRAINT "OpenrouterGenerationCost_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TgUserbotPublishGroup" ADD CONSTRAINT "TgUserbotPublishGroup_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TgUserbotMirrorMessage" ADD CONSTRAINT "TgUserbotMirrorMessage_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CabinetMember" ADD CONSTRAINT "CabinetMember_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CabinetSetting" ADD CONSTRAINT "CabinetSetting_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CabinetTelegramSource" ADD CONSTRAINT "CabinetTelegramSource_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CabinetTelegramSource" ADD CONSTRAINT "CabinetTelegramSource_chatId_fkey"
FOREIGN KEY ("chatId") REFERENCES "TgUserbotChat"("chatId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CabinetIngestRoute" ADD CONSTRAINT "CabinetIngestRoute_cabinetId_fkey"
FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CabinetIngestRoute" ADD CONSTRAINT "CabinetIngestRoute_ingestId_fkey"
FOREIGN KEY ("ingestId") REFERENCES "TgUserbotIngest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
