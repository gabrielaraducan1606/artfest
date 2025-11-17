// prisma/seed-subscription-plans.mjs
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function seedSubscriptionPlans() {
  const plans = [
    {
      code: "starter",
      name: "Starter",
      priceCents: 0,
      currency: "RON",
      interval: "month",
      features: [
        "25 produse",
        "Link distribuire",
        "Agenda de bază",
        "1 membru, 1 locație",
      ],
      isActive: true,
      popular: false,
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
      popular: true,
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

  for (const p of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { code: p.code },
      create: p,
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

if (import.meta.url === `file://${process.argv[1]}`) {
  seedSubscriptionPlans()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
