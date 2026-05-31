-- AlterTable
ALTER TABLE "TgUserbotPublishGroup" ADD COLUMN "contentPublishEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TgUserbotContentPost" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "ingestId" TEXT NOT NULL,
    "sourceChatId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "sourceTitle" TEXT,
    "classification" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "editedText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TgUserbotContentPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TgUserbotContentPublication" (
    "id" TEXT NOT NULL,
    "contentPostId" TEXT NOT NULL,
    "publishGroupId" TEXT NOT NULL,
    "targetChatId" TEXT NOT NULL,
    "targetMessageId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TgUserbotContentPublication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TgUserbotContentPost_ingestId_key" ON "TgUserbotContentPost"("ingestId");

-- CreateIndex
CREATE INDEX "TgUserbotContentPost_cabinetId_createdAt_idx" ON "TgUserbotContentPost"("cabinetId", "createdAt");

-- CreateIndex
CREATE INDEX "TgUserbotContentPost_cabinetId_status_idx" ON "TgUserbotContentPost"("cabinetId", "status");

-- CreateIndex
CREATE INDEX "TgUserbotContentPost_classification_createdAt_idx" ON "TgUserbotContentPost"("classification", "createdAt");

-- CreateIndex
CREATE INDEX "TgUserbotContentPublication_contentPostId_createdAt_idx" ON "TgUserbotContentPublication"("contentPostId", "createdAt");

-- CreateIndex
CREATE INDEX "TgUserbotContentPublication_publishGroupId_createdAt_idx" ON "TgUserbotContentPublication"("publishGroupId", "createdAt");

-- AddForeignKey
ALTER TABLE "TgUserbotContentPost" ADD CONSTRAINT "TgUserbotContentPost_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TgUserbotContentPublication" ADD CONSTRAINT "TgUserbotContentPublication_contentPostId_fkey" FOREIGN KEY ("contentPostId") REFERENCES "TgUserbotContentPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
