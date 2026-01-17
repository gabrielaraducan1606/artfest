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
  // Lista planurilor disponibile în platformă (aliniată cu descrierea finală)
  const plans = [
    {
      code: "starter",
      name: "Starter",
      priceCents: 0, // 0 RON / lună
      currency: "RON",
      interval: "month",
      features: [
        "Profil public de vânzător",
        "Listare produse (max. 25)",
        "Vânzare direct în platformă",
        "Recenzii clienți",
        "Chat cu clienții (mesaje simple)",
        "Notificări comenzi",
        "1 membru",
        "1 locație",
        "Suport standard",
      ],
      isActive: true,
      popular: false,
    },
    {
      code: "basic",
      name: "Basic",
      priceCents: 4900, // 49 RON / lună
      currency: "RON",
      interval: "month",
      features: [
        "TOT din Starter",
        "Listare produse extinsă (max. 150)",
        "Discount codes",
        "Chat avansat: note interne",
        "Status lead (nou / ofertat / confirmat / livrat)",
        "Notificări avansate",
        "Analytics vizitatori (zi / lună)",
        "Facturare automată: factură PDF trimisă clientului",
        "TVA corect (plătitor / neplătitor)",
        "Curier automat: AWB + ridicare de la adresă (cost per livrare)",
        "Eligibil pentru promovare în campaniile platformei (Meta & Google – selecție ne-garantată)",
        "2 membri",
        "2 locații",
        "Suport prioritar (email)",
      ],
      isActive: true,
      popular: true, // planul cel mai ales
    },
    {
      code: "pro",
      name: "Pro",
      priceCents: 9900, // 99 RON / lună
      currency: "RON",
      interval: "month",
      features: [
        "TOT din Basic",
        "Produse nelimitate",
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
        "3 membri",
        "Multi-locație",
        "Suport prioritar + SLA",
      ],
      isActive: true,
      popular: false,
    },
    {
      code: "business",
      name: "Business",
      priceCents: 19900, // 199 RON / lună
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

// Dacă scriptul este executat direct (node prisma/seed-subscription-plans.mjs)
// atunci rulăm funcția automat.
// Rulează întotdeauna când fișierul e executat cu `node prisma/seed-subscription-plans.mjs`
seedSubscriptionPlans()
  .catch((e) => {
    console.error("SEED FAILED:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
