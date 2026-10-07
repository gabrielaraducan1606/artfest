-- Titlu separat pentru feed-ul Google Merchant Center (Product.feedTitle).
-- Strict aditiv: 3 coloane nullable, fără backfill; title rămâne neschimbat.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "feedTitle" VARCHAR(100),
ADD COLUMN     "feedTitleGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "feedTitleInputHash" VARCHAR(64);

