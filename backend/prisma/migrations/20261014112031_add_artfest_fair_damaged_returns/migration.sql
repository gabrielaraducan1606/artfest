-- AlterEnum
ALTER TYPE "ArtfestStockMovementType" ADD VALUE 'DAMAGED_RETURNED_TO_VENDOR';

-- AlterTable
ALTER TABLE "ArtfestFairInventoryItem" ADD COLUMN     "damagedReturnedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ArtfestFairReturnLine" ADD COLUMN     "qtyDamaged" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vendorReceivedDamagedQty" INTEGER;
