export async function seedSubscriptionPlans(prisma) {
  const plans = [
    {
      code: "basic",
      name: "Basic",
      priceCents: 0,
      currency: "RON",
      interval: "month",
      maxProducts: 15,
      commissionBps: 1200,
      features: [
        "1 magazin inclus",
        "Max. 15 produse",
        "Chat cu clienții (max. 50 mesaje / lună)",
        "Recenzii",
        "Profil public",
        "3 lead-uri / lună",
        "Suport standard",
      ],
      entitlements: {
        chat: true,
        attachments: false,
        advancedChat: false,
      },
      meta: {
        limits: {
          stores: 1,
          products: 15,
          leadsPerMonth: 3,
          chatMessagesPerMonth: 50,
        },
        commissions: {
          productsBps: 1200,
          minFeeCentsPerOrder: 0,
        },
        capabilities: {
          shareLink: true,
          chat: true,
          attachments: false,
          advancedChat: false,
          serviceSalesEnabled: false,
        },
      },
      isActive: true,
      popular: false,
      trialDays: null,
    },

    {
      code: "pro",
      name: "Pro",
      priceCents: 5900,
      currency: "RON",
      interval: "month",
      maxProducts: null,
      commissionBps: 800,
      features: [
        "2 magazine incluse",
        "Produse nelimitate",
        "Chat cu clienții nelimitat",
        "Atașamente",
        "10 lead-uri / lună",
        "Suport prioritar",
      ],
      entitlements: {
        chat: true,
        attachments: true,
        advancedChat: false,
      },
      meta: {
        limits: {
          stores: 2,
          products: -1,
          leadsPerMonth: 10,
          chatMessagesPerMonth: -1,
        },
        commissions: {
          productsBps: 800,
          minFeeCentsPerOrder: 0,
        },
        capabilities: {
          shareLink: true,
          chat: true,
          attachments: true,
          advancedChat: false,
          serviceSalesEnabled: false,
        },
      },
      isActive: true,
      popular: false,
      trialDays: 30,
    },

    {
      code: "premium",
      name: "Premium",
      priceCents: 14900,
      currency: "RON",
      interval: "month",
      maxProducts: null,
      commissionBps: 500,
      features: [
        "3 magazine incluse",
        "Produse nelimitate",
        "Chat nelimitat + CRM complet (note interne, follow-up, atașamente)",
        "Badge verificat",
        "Prioritate în listări",
        "Statistici (vizualizări, lead-uri)",
        "Lead-uri nelimitate",
        "Suport dedicat",
      ],
      entitlements: {
        chat: true,
        attachments: true,
        advancedChat: true,
      },
      meta: {
        limits: {
          stores: 3,
          products: -1,
          leadsPerMonth: -1,
          chatMessagesPerMonth: -1,
        },
        commissions: {
          productsBps: 500,
          minFeeCentsPerOrder: 0,
        },
        capabilities: {
          shareLink: true,
          chat: true,
          attachments: true,
          advancedChat: true,
          serviceSalesEnabled: false,
        },
      },
      isActive: true,
      popular: true,
      trialDays: 30,
    },
  ];

  for (const p of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { code: p.code },
      create: {
        code: p.code,
        name: p.name,
        priceCents: p.priceCents,
        currency: p.currency,
        interval: p.interval,
        maxProducts: p.maxProducts,
        commissionBps: p.commissionBps,
        features: p.features,
        entitlements: p.entitlements ?? null,
        meta: p.meta ?? null,
        isActive: p.isActive,
        popular: p.popular ?? false,
        trialDays: p.trialDays ?? null,
      },
      update: {
        name: p.name,
        priceCents: p.priceCents,
        currency: p.currency,
        interval: p.interval,
        maxProducts: p.maxProducts ?? null,
        commissionBps: p.commissionBps ?? 0,
        features: p.features,
        entitlements: p.entitlements ?? null,
        meta: p.meta ?? null,
        isActive: p.isActive,
        popular: p.popular ?? false,
        trialDays: p.trialDays ?? null,
      },
    });
  }

  console.log("✅ Seeded subscription plans (Basic / Pro / Premium).");
}