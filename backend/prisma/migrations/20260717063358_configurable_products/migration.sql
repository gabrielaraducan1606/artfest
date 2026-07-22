-- DropForeignKey
ALTER TABLE "public"."CartItem" DROP CONSTRAINT "CartItem_productId_fkey";

-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "configurationKey" VARCHAR(64) NOT NULL DEFAULT 'default',
ADD COLUMN     "customAnswers" JSONB,
ADD COLUMN     "selectedOptions" JSONB;

-- CreateIndex
CREATE INDEX "CartItem_productId_idx" ON "CartItem"("productId");

-- CreateIndex
CREATE INDEX "CartItem_configurationKey_idx" ON "CartItem"("configurationKey");

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
