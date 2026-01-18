-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "entitySelfDeclaredIp" TEXT,
ADD COLUMN     "entitySelfDeclaredMeta" JSONB,
ADD COLUMN     "entitySelfDeclaredUa" TEXT;
