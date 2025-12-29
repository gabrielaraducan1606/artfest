-- CreateTable
CREATE TABLE "RouteIncident" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "query" JSONB,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "message" TEXT,
    "stack" TEXT,
    "code" TEXT,
    "ip" TEXT,
    "userId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedBy" TEXT,

    CONSTRAINT "RouteIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteIncident_createdAt_idx" ON "RouteIncident"("createdAt");

-- CreateIndex
CREATE INDEX "RouteIncident_statusCode_idx" ON "RouteIncident"("statusCode");

-- CreateIndex
CREATE INDEX "RouteIncident_path_idx" ON "RouteIncident"("path");

-- CreateIndex
CREATE INDEX "RouteIncident_acknowledgedAt_idx" ON "RouteIncident"("acknowledgedAt");
