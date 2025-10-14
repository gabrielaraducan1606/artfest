// backend/src/db.js
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

// Controlezi logarea query-urilor prin PRISMA_LOG_QUERIES=1 în .env
const wantQueryLogs =
  process.env.PRISMA_LOG_QUERIES === "1" ||
  process.env.DEBUG?.includes("prisma");

const prismaLog =
  process.env.NODE_ENV === "production"
    ? ["error"]
    : wantQueryLogs
    ? ["query", "warn", "error"]
    : ["warn", "error"];

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: prismaLog,
  });

// în dev evită multiple instanțe
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// închide conexiunile corect la oprire
const shutdown = async () => {
  try { await prisma.$disconnect(); } catch {}
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
