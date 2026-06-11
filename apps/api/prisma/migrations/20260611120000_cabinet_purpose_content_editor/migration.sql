-- Cabinet purpose (trading | content)
ALTER TABLE "Cabinet" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'trading';

-- Content generation presets and run log
CREATE TABLE "ContentGenerationPreset" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sourceKindsJson" TEXT NOT NULL DEFAULT '["analysis","content","news"]',
    "sourceGroupIdsJson" TEXT NOT NULL DEFAULT '[]',
    "aiInstruction" TEXT NOT NULL DEFAULT '',
    "outputStyle" TEXT,
    "dailyLimit" INTEGER NOT NULL DEFAULT 1,
    "scheduleCron" TEXT,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "targetGroupIdsJson" TEXT NOT NULL DEFAULT '[]',
    "lastRunAt" TIMESTAMP(3),
    "lastPublishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentGenerationPreset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentGenerationRun" (
    "id" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourcePostIdsJson" TEXT NOT NULL DEFAULT '[]',
    "resultPostId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ContentGenerationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentGenerationPreset_cabinetId_enabled_idx" ON "ContentGenerationPreset"("cabinetId", "enabled");
CREATE INDEX "ContentGenerationRun_presetId_createdAt_idx" ON "ContentGenerationRun"("presetId", "createdAt");

ALTER TABLE "ContentGenerationPreset" ADD CONSTRAINT "ContentGenerationPreset_cabinetId_fkey"
    FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentGenerationRun" ADD CONSTRAINT "ContentGenerationRun_presetId_fkey"
    FOREIGN KEY ("presetId") REFERENCES "ContentGenerationPreset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TgUserbotContentPost" ADD COLUMN IF NOT EXISTS "generationPresetId" TEXT;
