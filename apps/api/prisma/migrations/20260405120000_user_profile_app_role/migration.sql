-- Роль пользователя в приложении (дашборд): user | admin
ALTER TABLE "UserProfile" ADD COLUMN "appRole" TEXT NOT NULL DEFAULT 'user';
