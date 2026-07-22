-- AlterTable
ALTER TABLE "ShipmentItem" ADD COLUMN     "configurationKey" VARCHAR(64) NOT NULL DEFAULT 'default',
ADD COLUMN     "customAnswers" JSONB,
ADD COLUMN     "selectedOptions" JSONB;

-- CreateIndex
CREATE INDEX "ShipmentItem_configurationKey_idx" ON "ShipmentItem"("configurationKey");
