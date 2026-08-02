-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE');

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "providerEmail" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");

-- CreateIndex
CREATE INDEX "AuthAccount_providerEmail_idx" ON "AuthAccount"("providerEmail");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAccount_provider_providerAccountId_key" ON "AuthAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAccount_userId_provider_key" ON "AuthAccount"("userId", "provider");

-- AddForeignKey
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
