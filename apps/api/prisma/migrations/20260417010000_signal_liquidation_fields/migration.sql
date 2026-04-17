-- AlterTable
ALTER TABLE "Signal"
ADD COLUMN "liquidation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "liquidationLeverage" INTEGER;
