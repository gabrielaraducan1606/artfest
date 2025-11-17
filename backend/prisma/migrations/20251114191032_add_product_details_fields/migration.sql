-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "careInstructions" TEXT,
ADD COLUMN     "dimensions" VARCHAR(120),
ADD COLUMN     "materialMain" VARCHAR(120),
ADD COLUMN     "occasionTags" TEXT[],
ADD COLUMN     "specialNotes" TEXT,
ADD COLUMN     "styleTags" TEXT[],
ADD COLUMN     "technique" VARCHAR(160);
