// prisma/seed.mjs

/**
 * Script master de seed:
 *
 * - Rulează toate scripturile de seed care initializează baza de date.
 * - Este punctul unic de intrare pentru seed-uri (planuri, servicii, admin, etc).
 * - Poți adăuga aici pe viitor seed-uri suplimentare.
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 1) Seed pentru tipurile de servicii vendor (rulează la import)
import "./seed-service-types.mjs";

// 2) Seed pentru planurile de abonament
import { seedSubscriptionPlans } from "./seed-subscription-plans.mjs";

async function main() {
  /**
   * Dacă fișierul seed-service-types.mjs rulează singur la import, nu trebuie apelat.
   * Dacă în viitor va expune o funcție, o vei apela aici.
   *
   * Exemplu (dacă ar exista funcția):
   *    await seedServiceTypes();
   */

  // rulăm seed pentru planurile de abonament
  await seedSubscriptionPlans();
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
