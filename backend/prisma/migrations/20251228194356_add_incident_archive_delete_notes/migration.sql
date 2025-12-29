-- AlterTable
ALTER TABLE "RouteIncident" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedBy" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedBy" TEXT;

-- CreateTable
CREATE TABLE "RouteIncidentNote" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incidentId" TEXT NOT NULL,
    "by" TEXT,
    "note" TEXT NOT NULL,

    CONSTRAINT "RouteIncidentNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteIncidentNote_incidentId_createdAt_idx" ON "RouteIncidentNote"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "RouteIncident_archivedAt_createdAt_idx" ON "RouteIncident"("archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "RouteIncident_deletedAt_createdAt_idx" ON "RouteIncident"("deletedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "RouteIncidentNote" ADD CONSTRAINT "RouteIncidentNote_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "RouteIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
