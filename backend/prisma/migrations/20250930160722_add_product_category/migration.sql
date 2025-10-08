-- AlterTable
ALTER TABLE "public"."Product" ADD COLUMN     "category" VARCHAR(64);

-- CreateIndex
CREATE INDEX "Product_category_idx" ON "public"."Product"("category");
