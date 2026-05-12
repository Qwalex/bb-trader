-- Per-cabinet balance threshold alerts (CRITICAL_NOTIFY / equity totalUsd).
CREATE TABLE "CabinetBalanceAlertRule" (
    "id" TEXT NOT NULL,
    "cabinetId" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "thresholdUsd" DOUBLE PRECISION NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSatisfied" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CabinetBalanceAlertRule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CabinetBalanceAlertRule_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "Cabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CabinetBalanceAlertRule_cabinetId_enabled_idx" ON "CabinetBalanceAlertRule"("cabinetId", "enabled");
