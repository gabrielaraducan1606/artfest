// prisma/seed-subscription-plans.mjs

/**
 * Script de seed pentru planurile de abonament din platformă.
 *
 * - Rulează o dată (sau ori de câte ori ai nevoie)
 * - Folosește upsert => dacă planul există, îl actualizează, dacă nu există, îl creează.
 * - Nu creează duplicate.
 */

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

/**
 * Funcția principală care inserează/actualizează planurile de abonament
 */
export async function seedSubscriptionPlans() {
  // Lista planurilor disponibile în platformă
  const plans = [
    {
      code: "starter",      // identificator intern stabil
      name: "Starter",      
      priceCents: 0,        // preț în bani (0 = gratuit)
      currency: "RON",
      interval: "month",    // lunar
      features: [
        "25 produse",
        "Link distribuire",
        "Agenda de bază",
        "1 membru, 1 locație",
      ],
      isActive: true,       // apare pe site
      popular: false,       // nu este promovat ca plan principal
    },
    {
      code: "basic",
      name: "Basic",
      priceCents: 4900,
      currency: "RON",
      interval: "month",
      features: [
        "150 produse, variante & stoc",
        "Discount codes, UTM",
        "Agenda extinsă, avans",
        "2 membri, 2 locații",
      ],
      isActive: true,
      popular: false,
    },
    {
      code: "pro",
      name: "Pro",
      priceCents: 9900,
      currency: "RON",
      interval: "month",
      features: [
        "Produse nelimitate, SEO",
        "Boosturi în listări",
        "Agenda Pro + SMS",
        "3 membri, multi-locație",
      ],
      isActive: true,
      popular: true,       // planul recomandat
    },
    {
      code: "business",
      name: "Business",
      priceCents: 19900,
      currency: "RON",
      interval: "month",
      features: [
        "Multi-brand/store",
        "API & Webhooks",
        "Seats extins",
        "Suport prioritar",
      ],
      isActive: true,
      popular: false,
    },
  ];

  // Pentru fiecare plan facem UPSERT:
  // - dacă există un plan cu același code → îl actualizăm
  // - dacă nu există → îl creăm
  for (const p of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { code: p.code },
      create: p, // dacă nu există planul, îl adăugăm
      update: {
        name: p.name,
        priceCents: p.priceCents,
        currency: p.currency,
        interval: p.interval,
        features: p.features,
        isActive: p.isActive,
        popular: p.popular ?? false,
      },
    });
  }

  console.log("✅ Seeded subscription plans.");
}

// Dacă scriptul este executat direct (node prisma/seed-subscription-plans.mjs)
// atunci rulăm funcția automat.
if (import.meta.url === `file://${process.argv[1]}`) {
  seedSubscriptionPlans()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
