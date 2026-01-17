-- AlterTable
ALTER TABLE "VendorAcceptance" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "ua" TEXT;

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
