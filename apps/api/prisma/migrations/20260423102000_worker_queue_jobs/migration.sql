-- CreateTable
CREATE TABLE "WorkerQueueJob" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkerQueueJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerQueueJob_jobKey_key" ON "WorkerQueueJob"("jobKey");

-- CreateIndex
CREATE INDEX "WorkerQueueJob_queue_status_runAfter_createdAt_idx" ON "WorkerQueueJob"("queue", "status", "runAfter", "createdAt");

-- CreateIndex
CREATE INDEX "WorkerQueueJob_status_updatedAt_idx" ON "WorkerQueueJob"("status", "updatedAt");

