-- DropIndex
DROP INDEX "public"."RouteIncident_acknowledgedAt_idx";

-- DropIndex
DROP INDEX "public"."RouteIncident_createdAt_idx";

-- DropIndex
DROP INDEX "public"."RouteIncident_path_idx";

-- DropIndex
DROP INDEX "public"."RouteIncident_statusCode_idx";

-- AlterTable
ALTER TABLE "RouteIncident" ADD COLUMN     "reqId" TEXT,
ADD COLUMN     "userAgent" TEXT;
