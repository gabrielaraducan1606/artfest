// prisma/seed.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// seed-ul tău existent pentru service types
import "./seed-service-types.mjs";

// nou: seed planuri abonament
import { seedSubscriptionPlans } from "./seed-subscription-plans.mjs";

async function main() {
  // dacă seed-service-types.mjs rulează efectiv la import, ok.
  // Altfel, dacă expune o funcție, cheam-o aici (ex: await seedServiceTypes()).
  await seedSubscriptionPlans();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
