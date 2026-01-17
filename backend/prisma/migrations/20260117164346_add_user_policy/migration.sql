/*
  Warnings:

  - You are about to drop the `PolicyDocument` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PolicyNotification` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserAcceptance` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "public"."PolicyDocument";

-- DropTable
DROP TABLE "public"."PolicyNotification";

-- DropTable
DROP TABLE "public"."UserAcceptance";

-- DropEnum
DROP TYPE "public"."PolicyKey";

-- DropEnum
DROP TYPE "public"."PolicyScope";

-- CreateTable
CREATE TABLE "UserPolicy" (
    "id" TEXT NOT NULL,
    "document" "ConsentDoc" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "checksum" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserPolicy_document_isActive_idx" ON "UserPolicy"("document", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserPolicy_document_version_key" ON "UserPolicy"("document", "version");
