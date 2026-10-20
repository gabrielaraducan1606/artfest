-- AiUsageDaily: limite AI persistente (per vânzător / global) + cost estimat.
-- Doar ADĂUGARE: un tabel nou, fără modificări la tabelele existente.
-- Generat offline cu: prisma migrate diff --from-schema-datamodel <schema anterioară> --to-schema-datamodel prisma/schema.prisma --script

-- CreateTable
CREATE TABLE "AiUsageDaily" (
    "id" TEXT NOT NULL,
    "feature" VARCHAR(40) NOT NULL,
    "scope" VARCHAR(16) NOT NULL,
    "subjectId" VARCHAR(64) NOT NULL,
    "day" VARCHAR(10) NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageDaily_feature_scope_day_idx" ON "AiUsageDaily"("feature", "scope", "day");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageDaily_feature_scope_subjectId_day_key" ON "AiUsageDaily"("feature", "scope", "subjectId", "day");

