-- CreateTable
CREATE TABLE "RecalcClosedPnlJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "limit" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "resultJson" TEXT,
    "error" TEXT
);

-- CreateIndex
CREATE INDEX "RecalcClosedPnlJob_createdAt_idx" ON "RecalcClosedPnlJob"("createdAt");
