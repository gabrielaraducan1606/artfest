/*
  Warnings:

  - You are about to drop the `product_image_embeddings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."product_image_embeddings" DROP CONSTRAINT "product_image_embeddings_product_id_fkey";

-- DropTable
DROP TABLE "public"."product_image_embeddings";
