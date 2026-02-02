// prisma/seed.mjs

/**
 * Script master de seed:
 *
 * - Rulează toate scripturile de seed care initializează baza de date.
 * - Este punctul unic de intrare pentru seed-uri (planuri, servicii, admin, etc).
 * - Poți adăuga aici pe viitor seed-uri suplimentare.
 *
 * IMPORTANT:
 * - seed-service-types.mjs rulează singur la import (side-effect).
 * - seed-subscription-plans.mjs trebuie să exporte funcția seedSubscriptionPlans(prisma)
 *   (fără PrismaClient intern și fără auto-run).
 */

import { PrismaClient } from "@prisma/client";
import { seedSubscriptionPlans } from "./seed-subscription-plans.mjs";

// 1) Seed pentru tipurile de servicii vendor (rulează la import)
import "./seed-service-types.mjs";

const prisma = new PrismaClient();

async function main() {
  // 2) Seed pentru planurile de abonament
  await seedSubscriptionPlans(prisma);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
