-- Глобальный UNIQUE на chatId мешал upsert по (workspaceId, chatId): строка (NULL|другой WS, chatId)
-- уже существовала, Prisma шёл в create и получал конфликт / P2025.
ALTER TABLE "TgUserbotChat" DROP CONSTRAINT IF EXISTS "TgUserbotChat_chatId_key";
