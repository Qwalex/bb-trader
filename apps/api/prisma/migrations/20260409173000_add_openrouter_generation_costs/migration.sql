-- CreateTable
CREATE TABLE "OpenrouterGenerationCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generationId" TEXT NOT NULL,
    "operation" TEXT,
    "chatId" TEXT,
    "source" TEXT,
    "ingestId" TEXT,
    "costUsd" REAL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenrouterGenerationCost_generationId_key" ON "OpenrouterGenerationCost"("generationId");

-- CreateIndex
CREATE INDEX "OpenrouterGenerationCost_status_nextRetryAt_idx" ON "OpenrouterGenerationCost"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "OpenrouterGenerationCost_createdAt_idx" ON "OpenrouterGenerationCost"("createdAt");

-- CreateIndex
CREATE INDEX "OpenrouterGenerationCost_chatId_createdAt_idx" ON "OpenrouterGenerationCost"("chatId", "createdAt");
