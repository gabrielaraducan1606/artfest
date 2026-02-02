export async function seedSubscriptionPlans(prisma) {
  const plans = [
    {
      code: "starter-lite",
      name: "Starter Lite",
      priceCents: 0,
      currency: "RON",
      interval: "month",
      maxProducts: 10,
      commissionBps: 1200, // 12%
      features: [
        "Profil public de vânzător",
        "Listare produse (max. 10)",
        "Vânzare direct în platformă",
        "Recenzii clienți",
        "Chat cu clienții (mesaje simple)",
        "Notificări comenzi",
        "Curier: AWB + ridicare de la adresă (cost per livrare)",
        "Facturare automată: max. 1 comandă / zi",
        "Suport standard",
      ],
      // ✅ drepturi reale (folosite de requireChatEntitlement)
      entitlements: {
        chat: true,
        attachments: false,
        advancedChat: false,
      },
      isActive: true,
      popular: false,
      trialDays: 30,
    },

    {
      code: "starter", // ✅ planul 2
      name: "Starter",
      priceCents: 9999,
      currency: "RON",
      interval: "month",
      maxProducts: 25,
      commissionBps: 1000, // 10%
      features: [
        "TOT din Starter Lite",
        "Listare produse (max. 25)",
        "Curier: AWB + ridicare de la adresă (cost per livrare)",
        "Facturare automată: până la 2 comenzi / zi",
        "Notificări comenzi avansate",
        "Chat cu atașamente", // (doar text UI, optional)
      ],
      entitlements: {
        chat: true,
        attachments: true,   // ✅ AICI ai cerința ta
        advancedChat: false,
      },
      isActive: true,
      popular: true,
      trialDays: 30,
    },

    {
      code: "basic",
      name: "Basic",
      priceCents: 14999,
      currency: "RON",
      interval: "month",
      maxProducts: 40,
      commissionBps: 800, // 8%
      features: [
        "TOT din Starter",
        "Listare produse extinsă (max. 40)",
        "Chat avansat: note interne",
        "Status lead (nou / ofertat / confirmat / livrat)",
        "Analytics vizitatori (zi / lună)",
        "Facturare automată: până la 4 comenzi / zi",
        "Eligibil pentru promovare în campaniile platformei",
        "Suport prioritar (email)",
      ],
      entitlements: {
        chat: true,
        attachments: true,
        advancedChat: true,
      },
      isActive: true,
      popular: false,
      trialDays: 30,
    },

    {
      code: "pro",
      name: "Pro",
      priceCents: 19999,
      currency: "RON",
      interval: "month",
      maxProducts: null, // nelimitat
      commissionBps: 600, // 6%
      features: [
        "TOT din Basic",
        "Produse nelimitate",
        "Coduri de discount",
        "Boost în listări",
        "SEO îmbunătățit",
        "Analytics avansat",
        "Facturare avansată + storno",
        "Logo vendor pe factură",
        "Curier avansat: alegere curier",
        "Promovare prioritară în campaniile platformei",
        "Suport prioritar",
      ],
      entitlements: {
        chat: true,
        attachments: true,
        advancedChat: true,
      },
      isActive: true,
      popular: false,
      trialDays: 30,
    },

    {
      code: "business",
      name: "Business",
      priceCents: 0, // custom pricing / contract
      currency: "RON",
      interval: "month",
      maxProducts: null,
      commissionBps: 500, // 5% (negociabil)
      features: [
        "TOT din Pro",
        "Multi-brand / multi-store",
        "Membri extinși",
        "Export date (CSV / API)",
        "Integrare contabilitate",
        "Account manager dedicat",
      ],
      entitlements: {
        chat: true,
        attachments: true,
        advancedChat: true,
      },
      isActive: false,
      popular: false,
      trialDays: null,
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
        entitlements: p.entitlements ?? null, // ✅ IMPORTANT
        isActive: p.isActive,
        popular: p.popular ?? false,
        trialDays: p.trialDays ?? null,
        maxProducts: p.maxProducts ?? null,
        commissionBps: p.commissionBps ?? 0,
      },
    });
  }

  console.log("✅ Seeded subscription plans + entitlements.");
}
