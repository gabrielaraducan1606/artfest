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
        "Profil public de vânzător",
        "Listare produse (max. 25)",
        "Vânzare direct în platformă",
        "Recenzii clienți",
        "Chat cu clienții (mesaje simple)",
        "Notificări comenzi",
        "Suport standard",
        "Curier automat: AWB + ridicare de la adresă (cost per livrare)",
        "Facturare automată: până la 2 comenzi procesate / zi",
      ],
      isActive: true,
      popular: false,
      // redundant la Starter, dar ok pt consistență
      trialDays: 30,
    },

    {
      code: "basic",
      name: "Basic",
      // ✅ aici pui 9900 dacă vrei 99 lei
      priceCents: 9999,
      currency: "RON",
      interval: "month",
      features: [
        "TOT din Starter",
        "Listare produse extinsă (max. 40)",
        "Chat avansat: note interne",
        "Status lead (nou / ofertat / confirmat / livrat)",
        "Notificări avansate",
        "Analytics vizitatori (zi / lună)",
        "Facturare automată: până la 4 comenzi procesate / zi",
        "Curier automat: AWB + ridicare de la adresă (cost per livrare)",
        "Eligibil pentru promovare în campaniile platformei (Meta & Google – selecție ne-garantată)",
        "Suport prioritar (email)",
      ],
      isActive: true,
      popular: true,
      trialDays: 30,
    },

    {
      code: "pro",
      name: "Pro",
      // ✅ aici pui 15000 dacă vrei 150 lei
      priceCents: 14999,
      currency: "RON",
      interval: "month",
      features: [
        "TOT din Basic",
        "Produse nelimitate",
        "Coduri de discount",
        "Boost în listări",
        "SEO îmbunătățit pentru paginile produselor",
        "Chat complet: note interne + status lead",
        "Follow-up reminders",
        "Istoric lead & comandă",
        "Analytics avansat: perioade custom",
        "Top produse vizitate",
        "Facturare avansată: istoric facturi",
        "Storno / corecții",
        "Logo vendor pe factură",
        "Curier avansat: alegere curier",
        "Programare ridicare",
        "Tracking automat trimis clientului",
        "Istoric livrări",
        "Promovare prioritară în campaniile Meta & Google ale platformei",
        "Rotație mai frecventă în ads",
        "Suport prioritar",
      ],
      isActive: true,
      popular: false,
      trialDays: 30,
    },

    // 👇 Business se vede, dar e indisponibil momentan
    {
      code: "business",
      name: "Business",
      priceCents: 19900,
      currency: "RON",
      interval: "month",
      features: [
        "TOT din Pro",
        "Multi-brand / multi-store",
        "Membri extinși (5–10)",
        "Export date (CSV / API)",
        "Facturare completă: serii multiple de facturi",
        "Integrare contabilitate (viitor)",
        "Facturare per brand",
        "Curier premium: tarife negociate mai bune",
        "Ridicare prioritară",
        "Retururi automate",
        "Promovare dedicată: campanii gestionate de platformă",
        "Buget inclus (limită lunară)",
        "Landing dedicat",
        "Raport performanță",
        "Account manager dedicat",
        "Early access la funcții noi",
        "Prioritate în campanii sezoniere (nunți)",
      ],
      isActive: false, // ✅ important
      popular: false,
      trialDays: 30,
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
        trialDays: p.trialDays ?? null,
      },
    });
  }

  console.log("✅ Seeded subscription plans (Starter/Basic/Pro active, Business disabled).");
}

seedSubscriptionPlans()
  .catch((e) => {
    console.error("SEED FAILED:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
