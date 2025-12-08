-- CreateTable
CREATE TABLE "CityDictionary" (
    "slug" VARCHAR(64) NOT NULL,
    "canonicalLabel" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CityDictionary_pkey" PRIMARY KEY ("slug")
);
