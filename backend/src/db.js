// db.js
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["error"],
  });

// în dev evită multiple instanțe
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// închide conexiunile corect la oprire
const shutdown = async () => {
  try {
    await prisma.$disconnect();
  } catch (e) {
    // ignore
  } finally {
    process.exit(0);
  }
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
