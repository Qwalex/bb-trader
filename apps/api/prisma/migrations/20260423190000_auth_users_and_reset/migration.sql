-- CreateTable
CREATE TABLE "AuthUser" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "telegramUserId" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "firstLockUntil" TIMESTAMP(3),
    "manualLock" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthPasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthPasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthUser_login_key" ON "AuthUser"("login");
CREATE INDEX "AuthUser_role_createdAt_idx" ON "AuthUser"("role", "createdAt");
CREATE INDEX "AuthUser_telegramUserId_idx" ON "AuthUser"("telegramUserId");
CREATE INDEX "AuthPasswordReset_userId_createdAt_idx" ON "AuthPasswordReset"("userId", "createdAt");
CREATE INDEX "AuthPasswordReset_expiresAt_consumedAt_idx" ON "AuthPasswordReset"("expiresAt", "consumedAt");

-- AddForeignKey
ALTER TABLE "AuthPasswordReset" ADD CONSTRAINT "AuthPasswordReset_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AuthUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

