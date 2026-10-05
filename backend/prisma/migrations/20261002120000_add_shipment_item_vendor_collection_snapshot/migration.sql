-- Snapshot VendorCollection per ShipmentItem (atribuire request-based PER ITEM).
-- Strict aditiv: două coloane nullable + index, fără FK, fără backfill.
-- Comenzile istorice rămân cu NULL (= neatribuite colecției), deci neschimbate.

-- AlterTable
ALTER TABLE "ShipmentItem" ADD COLUMN "vendorCollectionIdSnapshot" TEXT,
ADD COLUMN "vendorCollectionSlugSnapshot" VARCHAR(180);

-- CreateIndex
CREATE INDEX "ShipmentItem_vendorCollectionIdSnapshot_idx" ON "ShipmentItem"("vendorCollectionIdSnapshot");
