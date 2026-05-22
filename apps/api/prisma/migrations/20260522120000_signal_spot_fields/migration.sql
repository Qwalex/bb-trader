-- AlterTable
ALTER TABLE "Signal" ADD COLUMN "marketType" TEXT NOT NULL DEFAULT 'linear';
ALTER TABLE "Signal" ADD COLUMN "spotBaseQty" DOUBLE PRECISION;
ALTER TABLE "Signal" ADD COLUMN "spotNotifiedJson" TEXT;
