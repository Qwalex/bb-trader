-- Redefinable: bump entry notional to exchange min qty (per chat); null = use global BUMP_TO_MIN_EXCHANGE_LOT
ALTER TABLE "TgUserbotChat" ADD COLUMN "minLotBump" BOOLEAN;
