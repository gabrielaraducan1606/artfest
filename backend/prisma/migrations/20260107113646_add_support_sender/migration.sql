-- AlterEnum
ALTER TYPE "EmailSenderKey" ADD VALUE 'support';

-- CreateTable
CREATE TABLE "product_image_embeddings" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "imageIndex" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_image_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_image_embeddings_product_idx" ON "product_image_embeddings"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "product_image_embeddings_productId_imageIndex_key" ON "product_image_embeddings"("productId", "imageIndex");

-- AddForeignKey
ALTER TABLE "product_image_embeddings" ADD CONSTRAINT "product_image_embeddings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
