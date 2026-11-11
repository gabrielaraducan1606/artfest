-- „Întreabă vânzătorul” din pagina produsului.
-- Doar coloane NOI, opționale (NULL pentru toate conversațiile existente),
-- fără FK spre "Product" (nu blochează tabela Product), fără backfill.

-- AlterTable
ALTER TABLE "MessageThread" ADD COLUMN     "contactReason" VARCHAR(20),
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "safetyEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "supportTicketId" TEXT;

-- CreateIndex
CREATE INDEX "MessageThread_userId_productId_idx" ON "MessageThread"("userId", "productId");

-- CreateIndex
CREATE INDEX "MessageThread_productId_idx" ON "MessageThread"("productId");
