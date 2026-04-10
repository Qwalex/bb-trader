-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "pair" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entries" TEXT NOT NULL,
    "entryIsRange" BOOLEAN NOT NULL DEFAULT false,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "takeProfits" TEXT NOT NULL,
    "leverage" INTEGER NOT NULL,
    "orderUsd" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "capitalPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT,
    "sourceChatId" TEXT,
    "sourceMessageId" TEXT,
    "signalExternalId" TEXT,
    "rawMessage" TEXT,
    "status" TEXT NOT NULL,
    "realizedPnl" DOUBLE PRECISION,
    "closedAt" TIMESTAMP(3),
    "tpSlStep" INTEGER NOT NULL DEFAULT -1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecalcClosedPnlJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "limit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "resultJson" TEXT,
    "error" TEXT,

    CONSTRAINT "RecalcClosedPnlJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalEvent" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "bybitOrderId" TEXT,
    "orderKind" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "qty" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "pnl" DOUBLE PRECISION,
    "filledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalUsd" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BalanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppLog" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgUserbotChat" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "username" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sourcePriority" INTEGER NOT NULL DEFAULT 0,
    "defaultLeverage" INTEGER,
    "defaultEntryUsd" TEXT,
    "minLotBump" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgUserbotChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgUserbotIngest" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "dedupMessageKey" TEXT NOT NULL,
    "text" TEXT,
    "aiRequest" TEXT,
    "aiResponse" TEXT,
    "classification" TEXT NOT NULL,
    "signalHash" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgUserbotIngest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgUserbotSignalHash" (
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgUserbotSignalHash_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "TgUserbotFilterExample" (
    "id" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "example" TEXT NOT NULL,
    "requiresQuote" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgUserbotFilterExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgUserbotFilterPattern" (
    "id" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "requiresQuote" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgUserbotFilterPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgUserbotPublishGroup" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "publishEveryN" INTEGER NOT NULL DEFAULT 1,
    "signalCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgUserbotPublishGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgUserbotMirrorMessage" (
    "id" TEXT NOT NULL,
    "publishGroupId" TEXT NOT NULL,
    "ingestId" TEXT NOT NULL,
    "sourceChatId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "rootSourceChatId" TEXT,
    "rootSourceMessageId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "targetChatId" TEXT NOT NULL,
    "targetMessageId" TEXT,
    "replyToTargetMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgUserbotMirrorMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestJson" TEXT,
    "modelsJson" TEXT NOT NULL,
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticCase" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "ingestId" TEXT,
    "signalId" TEXT,
    "chatId" TEXT,
    "messageId" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "traceJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticModelResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "rawResponse" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticModelResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticStepResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "modelResultId" TEXT,
    "stepKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "comment" TEXT,
    "issuesJson" TEXT,
    "evidenceJson" TEXT,
    "missingContextJson" TEXT,
    "recommendedFixesJson" TEXT,
    "payloadJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticStepResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT,
    "modelResultId" TEXT,
    "level" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagnosticLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenrouterGenerationCost" (
    "id" TEXT NOT NULL,
    "generationId" TEXT NOT NULL,
    "operation" TEXT,
    "chatId" TEXT,
    "source" TEXT,
    "ingestId" TEXT,
    "costUsd" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenrouterGenerationCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Signal_sourceChatId_sourceMessageId_idx" ON "Signal"("sourceChatId", "sourceMessageId");

-- CreateIndex
CREATE INDEX "Signal_sourceChatId_signalExternalId_idx" ON "Signal"("sourceChatId", "signalExternalId");

-- CreateIndex
CREATE INDEX "Signal_deletedAt_createdAt_idx" ON "Signal"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Signal_deletedAt_closedAt_idx" ON "Signal"("deletedAt", "closedAt");

-- CreateIndex
CREATE INDEX "RecalcClosedPnlJob_createdAt_idx" ON "RecalcClosedPnlJob"("createdAt");

-- CreateIndex
CREATE INDEX "SignalEvent_signalId_createdAt_idx" ON "SignalEvent"("signalId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_signalId_idx" ON "Order"("signalId");

-- CreateIndex
CREATE INDEX "BalanceSnapshot_createdAt_idx" ON "BalanceSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "AppLog_createdAt_idx" ON "AppLog"("createdAt");

-- CreateIndex
CREATE INDEX "AppLog_category_createdAt_idx" ON "AppLog"("category", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TgUserbotChat_chatId_key" ON "TgUserbotChat"("chatId");

-- CreateIndex
CREATE UNIQUE INDEX "TgUserbotIngest_dedupMessageKey_key" ON "TgUserbotIngest"("dedupMessageKey");

-- CreateIndex
CREATE INDEX "TgUserbotIngest_chatId_messageId_idx" ON "TgUserbotIngest"("chatId", "messageId");

-- CreateIndex
CREATE INDEX "TgUserbotIngest_signalHash_idx" ON "TgUserbotIngest"("signalHash");

-- CreateIndex
CREATE INDEX "TgUserbotIngest_createdAt_idx" ON "TgUserbotIngest"("createdAt");

-- CreateIndex
CREATE INDEX "TgUserbotFilterExample_groupName_kind_enabled_idx" ON "TgUserbotFilterExample"("groupName", "kind", "enabled");

-- CreateIndex
CREATE INDEX "TgUserbotFilterExample_createdAt_idx" ON "TgUserbotFilterExample"("createdAt");

-- CreateIndex
CREATE INDEX "TgUserbotFilterPattern_groupName_kind_enabled_idx" ON "TgUserbotFilterPattern"("groupName", "kind", "enabled");

-- CreateIndex
CREATE INDEX "TgUserbotFilterPattern_createdAt_idx" ON "TgUserbotFilterPattern"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TgUserbotPublishGroup_chatId_key" ON "TgUserbotPublishGroup"("chatId");

-- CreateIndex
CREATE INDEX "TgUserbotMirrorMessage_publishGroupId_sourceChatId_sourceMe_idx" ON "TgUserbotMirrorMessage"("publishGroupId", "sourceChatId", "sourceMessageId", "kind");

-- CreateIndex
CREATE INDEX "TgUserbotMirrorMessage_publishGroupId_rootSourceChatId_root_idx" ON "TgUserbotMirrorMessage"("publishGroupId", "rootSourceChatId", "rootSourceMessageId", "kind");

-- CreateIndex
CREATE INDEX "TgUserbotMirrorMessage_createdAt_idx" ON "TgUserbotMirrorMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TgUserbotMirrorMessage_publishGroupId_ingestId_kind_key" ON "TgUserbotMirrorMessage"("publishGroupId", "ingestId", "kind");

-- CreateIndex
CREATE INDEX "DiagnosticRun_createdAt_idx" ON "DiagnosticRun"("createdAt");

-- CreateIndex
CREATE INDEX "DiagnosticRun_status_createdAt_idx" ON "DiagnosticRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DiagnosticCase_runId_createdAt_idx" ON "DiagnosticCase"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "DiagnosticCase_ingestId_idx" ON "DiagnosticCase"("ingestId");

-- CreateIndex
CREATE INDEX "DiagnosticCase_signalId_idx" ON "DiagnosticCase"("signalId");

-- CreateIndex
CREATE INDEX "DiagnosticModelResult_runId_model_idx" ON "DiagnosticModelResult"("runId", "model");

-- CreateIndex
CREATE INDEX "DiagnosticModelResult_caseId_createdAt_idx" ON "DiagnosticModelResult"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticModelResult_runId_caseId_model_key" ON "DiagnosticModelResult"("runId", "caseId", "model");

-- CreateIndex
CREATE INDEX "DiagnosticStepResult_runId_caseId_createdAt_idx" ON "DiagnosticStepResult"("runId", "caseId", "createdAt");

-- CreateIndex
CREATE INDEX "DiagnosticStepResult_modelResultId_stepKey_idx" ON "DiagnosticStepResult"("modelResultId", "stepKey");

-- CreateIndex
CREATE INDEX "DiagnosticLog_runId_createdAt_idx" ON "DiagnosticLog"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "DiagnosticLog_caseId_createdAt_idx" ON "DiagnosticLog"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpenrouterGenerationCost_generationId_key" ON "OpenrouterGenerationCost"("generationId");

-- CreateIndex
CREATE INDEX "OpenrouterGenerationCost_status_nextRetryAt_idx" ON "OpenrouterGenerationCost"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "OpenrouterGenerationCost_createdAt_idx" ON "OpenrouterGenerationCost"("createdAt");

-- CreateIndex
CREATE INDEX "OpenrouterGenerationCost_chatId_createdAt_idx" ON "OpenrouterGenerationCost"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "SignalEvent" ADD CONSTRAINT "SignalEvent_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticCase" ADD CONSTRAINT "DiagnosticCase_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiagnosticRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticModelResult" ADD CONSTRAINT "DiagnosticModelResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiagnosticRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticModelResult" ADD CONSTRAINT "DiagnosticModelResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DiagnosticCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticStepResult" ADD CONSTRAINT "DiagnosticStepResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiagnosticRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticStepResult" ADD CONSTRAINT "DiagnosticStepResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DiagnosticCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticStepResult" ADD CONSTRAINT "DiagnosticStepResult_modelResultId_fkey" FOREIGN KEY ("modelResultId") REFERENCES "DiagnosticModelResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticLog" ADD CONSTRAINT "DiagnosticLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DiagnosticRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticLog" ADD CONSTRAINT "DiagnosticLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DiagnosticCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticLog" ADD CONSTRAINT "DiagnosticLog_modelResultId_fkey" FOREIGN KEY ("modelResultId") REFERENCES "DiagnosticModelResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Partial unique: один активный сигнал на пару+направление (PostgreSQL)
CREATE UNIQUE INDEX "Signal_active_pair_direction_unique"
ON "Signal"("pair", "direction")
WHERE "deletedAt" IS NULL
  AND "status" IN ('PENDING', 'ORDERS_PLACED');
