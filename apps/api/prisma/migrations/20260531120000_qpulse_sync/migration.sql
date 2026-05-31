-- AlterTable
ALTER TABLE "TgUserbotPublishGroup" ADD COLUMN "linkedToApp" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SignalExternalSync" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "qpulseId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignalExternalSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignalExternalSync_cabinetId_signalId_key" ON "SignalExternalSync"("cabinetId", "signalId");

-- CreateIndex
CREATE INDEX "SignalExternalSync_signalId_idx" ON "SignalExternalSync"("signalId");

-- AddForeignKey
ALTER TABLE "SignalExternalSync" ADD CONSTRAINT "SignalExternalSync_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignalExternalSync" ADD CONSTRAINT "SignalExternalSync_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
