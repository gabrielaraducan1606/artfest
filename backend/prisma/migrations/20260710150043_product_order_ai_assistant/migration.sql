-- CreateEnum
CREATE TYPE "ProductOrderMode" AS ENUM ('DIRECT', 'OPTIONS', 'QUOTE_ONLY');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "aiAnalysisVersion" VARCHAR(80),
ADD COLUMN     "aiAnalyzedAt" TIMESTAMP(3),
ADD COLUMN     "aiConfidence" DOUBLE PRECISION,
ADD COLUMN     "aiGeneratedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "aiManuallyEdited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiOrderAnalysis" JSONB,
ADD COLUMN     "aiSourceImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "aiVisionAnalysis" JSONB,
ADD COLUMN     "customSchema" JSONB,
ADD COLUMN     "optionsSchema" JSONB,
ADD COLUMN     "orderMode" "ProductOrderMode" NOT NULL DEFAULT 'DIRECT',
ADD COLUMN     "quoteSchema" JSONB;

-- CreateIndex
CREATE INDEX "product_orderMode_idx" ON "Product"("orderMode");

-- CreateIndex
CREATE INDEX "product_aiAnalyzedAt_idx" ON "Product"("aiAnalyzedAt");
