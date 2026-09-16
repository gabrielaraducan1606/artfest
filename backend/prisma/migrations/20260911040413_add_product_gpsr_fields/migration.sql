-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isForChildren" BOOLEAN,
ADD COLUMN     "isOwnManufacturer" BOOLEAN,
ADD COLUMN     "manufacturerAddress" TEXT,
ADD COLUMN     "manufacturerEmail" TEXT,
ADD COLUMN     "manufacturerInEU" BOOLEAN,
ADD COLUMN     "manufacturerName" TEXT,
ADD COLUMN     "responsiblePersonAddress" TEXT,
ADD COLUMN     "responsiblePersonEmail" TEXT,
ADD COLUMN     "responsiblePersonName" TEXT,
ADD COLUMN     "safetyWarnings" TEXT;
