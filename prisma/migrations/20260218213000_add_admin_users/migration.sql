-- CreateTable
CREATE TABLE IF NOT EXISTS "admin-users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "admin-users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "admin-users_username_key" ON "admin-users"("username");
CREATE INDEX IF NOT EXISTS "admin-users_isActive_idx" ON "admin-users"("isActive");
