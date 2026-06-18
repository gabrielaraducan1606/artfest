-- CreateTable
CREATE TABLE "AmbassadorSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ambassadorMin" INTEGER NOT NULL DEFAULT 3,
    "goldMin" INTEGER NOT NULL DEFAULT 10,
    "eliteMin" INTEGER NOT NULL DEFAULT 25,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmbassadorSettings_pkey" PRIMARY KEY ("id")
);
