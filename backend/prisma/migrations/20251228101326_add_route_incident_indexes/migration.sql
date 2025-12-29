-- CreateIndex
CREATE INDEX "RouteIncident_createdAt_idx" ON "RouteIncident"("createdAt");

-- CreateIndex
CREATE INDEX "RouteIncident_statusCode_createdAt_idx" ON "RouteIncident"("statusCode", "createdAt");

-- CreateIndex
CREATE INDEX "RouteIncident_path_idx" ON "RouteIncident"("path");

-- CreateIndex
CREATE INDEX "RouteIncident_acknowledgedAt_createdAt_idx" ON "RouteIncident"("acknowledgedAt", "createdAt");

-- CreateIndex
CREATE INDEX "RouteIncident_reqId_idx" ON "RouteIncident"("reqId");
