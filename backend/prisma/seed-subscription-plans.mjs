export async function seedSubscriptionPlans(prisma) {
  const plans = [
    {
      code: "basic",
      name: "Basic",
      priceCents: 0,
      currency: "RON",
      interval: "month",

      // Nelimitat
      maxProducts: null,

      // Comision produse 12%
      commissionBps: 1200,

      features: [
        "Magazine nelimitate",
        "Produse nelimitate",
        "Chat cu clienții nelimitat",
        "Atașamente nelimitate",
        "CRM complet (note interne, follow-up, atașamente)",
        "Recenzii",
        "Profil public",
        "Badge verificat",
        "Prioritate în listări",
        "Statistici complete",
        "Lead-uri nelimitate",
        "Suport prioritar",
      ],

      entitlements: {
        chat: true,
        attachments: true,
        advancedChat: true,
      },

      meta: {
        limits: {
          stores: -1,
          products: -1,
          leadsPerMonth: -1,
          chatMessagesPerMonth: -1,
          attachmentsPerMonth: -1,
        },

        commissions: {
          productsBps: 1200,
          minFeeCentsPerOrder: 0,
        },

        capabilities: {
          shareLink: true,
          chat: true,
          attachments: true,
          advancedChat: true,

          // Rămâne momentan dezactivată vânzarea de servicii,
          // deoarece și în planurile actuale era false.
          serviceSalesEnabled: false,
        },
      },

      isActive: true,
      popular: true,
      trialDays: null,

      stripeProductId: null,
      stripePriceMonthId: null,
      stripePriceYearId: null,
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
        "Atașamente nelimitate",
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
          attachmentsPerMonth: -1,
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

      // Momentan indisponibil
      isActive: false,

      popular: false,
      trialDays: null,

      stripeProductId: process.env.STRIPE_PRODUCT_PRO || null,
      stripePriceMonthId:
        process.env.STRIPE_PRICE_PRO_MONTH || null,
      stripePriceYearId:
        process.env.STRIPE_PRICE_PRO_YEAR || null,
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
        "Chat nelimitat + CRM complet",
        "Badge verificat",
        "Prioritate în listări",
        "Statistici complete",
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
          attachmentsPerMonth: -1,
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

      // Momentan indisponibil
      isActive: false,

      popular: false,
      trialDays: null,

      stripeProductId:
        process.env.STRIPE_PRODUCT_PREMIUM || null,

      stripePriceMonthId:
        process.env.STRIPE_PRICE_PREMIUM_MONTH || null,

      stripePriceYearId:
        process.env.STRIPE_PRICE_PREMIUM_YEAR || null,
    },
  ];

  /*
   * =========================================================
   * 1. Creăm / actualizăm planurile
   * =========================================================
   */

  for (const p of plans) {
    await prisma.subscriptionPlan.upsert({
      where: {
        code: p.code,
      },

      create: {
        code: p.code,
        name: p.name,
        priceCents: p.priceCents,
        currency: p.currency,
        interval: p.interval,

        maxProducts: p.maxProducts,
        commissionBps: p.commissionBps,

        features: p.features,

        entitlements:
          p.entitlements ?? null,

        meta:
          p.meta ?? null,

        isActive:
          p.isActive,

        popular:
          p.popular ?? false,

        trialDays:
          p.trialDays ?? null,

        stripeProductId:
          p.stripeProductId ?? null,

        stripePriceMonthId:
          p.stripePriceMonthId ?? null,

        stripePriceYearId:
          p.stripePriceYearId ?? null,
      },

      update: {
        name: p.name,
        priceCents: p.priceCents,
        currency: p.currency,
        interval: p.interval,

        maxProducts:
          p.maxProducts ?? null,

        commissionBps:
          p.commissionBps ?? 0,

        features:
          p.features,

        entitlements:
          p.entitlements ?? null,

        meta:
          p.meta ?? null,

        isActive:
          p.isActive,

        popular:
          p.popular ?? false,

        trialDays:
          p.trialDays ?? null,

        stripeProductId:
          p.stripeProductId ?? null,

        stripePriceMonthId:
          p.stripePriceMonthId ?? null,

        stripePriceYearId:
          p.stripePriceYearId ?? null,
      },
    });
  }

  /*
   * =========================================================
   * 2. Luăm planul Basic
   * =========================================================
   */

  const basicPlan =
    await prisma.subscriptionPlan.findUnique({
      where: {
        code: "basic",
      },

      select: {
        id: true,
      },
    });

  if (!basicPlan) {
    throw new Error(
      "Planul Basic nu a putut fi găsit după seed."
    );
  }

  /*
   * =========================================================
   * 3. Pregătim perioada lungă pentru Basic gratuit
   * =========================================================
   *
   * Este important să nu păstrăm vechiul endAt de la
   * Pro/Premium/trial.
   *
   * Altfel un vendor mutat pe Basic ar putea expira
   * după câteva zile sau săptămâni.
   */

  const now = new Date();

  const basicEndAt = new Date(now);

  basicEndAt.setFullYear(
    basicEndAt.getFullYear() + 10
  );

  /*
   * =========================================================
   * 4. Mutăm abonamentele existente Pro/Premium -> Basic
   * =========================================================
   *
   * IMPORTANT:
   *
   * Nu anulăm abonamentul înainte.
   *
   * Modificăm direct planId-ul și păstrăm abonamentul activ,
   * astfel încât vendorul să nu rămână nici măcar temporar
   * fără abonament și magazinul să nu fie dezactivat.
   *
   * Mutăm inclusiv:
   * - active
   * - pending
   * - past_due
   * - unpaid
   * - canceled_at_period_end
   *
   * Pentru că Basic este acum gratuit.
   */

  const migratedSubscriptions =
    await prisma.vendorSubscription.updateMany({
      where: {
        planId: {
          not: basicPlan.id,
        },

        status: {
          in: [
            "active",
            "pending",
            "past_due",
            "unpaid",
            "canceled_at_period_end",
          ],
        },
      },

      data: {
        // Trecem abonamentul direct pe Basic
        planId:
          basicPlan.id,

        // Îl menținem activ
        status:
          "active",

        // Eliminăm orice trial vechi
        trialDays:
          null,

        trialEndsAt:
          null,

        // Basic gratuit pe termen lung
        endAt:
          basicEndAt,
      },
    });

  /*
   * =========================================================
   * 5. Extindem și abonamentele Basic deja existente
   * =========================================================
   *
   * Este posibil să existe deja vendori pe Basic cu un endAt
   * mai apropiat.
   *
   * Cum Basic este acum gratuit, îi menținem și pe aceștia
   * activi pe termen lung.
   */

  const refreshedBasicSubscriptions =
    await prisma.vendorSubscription.updateMany({
      where: {
        planId:
          basicPlan.id,

        status: {
          in: [
            "active",
            "pending",
            "past_due",
            "unpaid",
            "canceled_at_period_end",
          ],
        },
      },

      data: {
        status:
          "active",

        trialDays:
          null,

        trialEndsAt:
          null,

        endAt:
          basicEndAt,
      },
    });

  /*
   * =========================================================
   * Log
   * =========================================================
   */

  console.log(
    "✅ Seeded subscription plans."
  );

  console.log(
    "✅ Basic este planul gratuit activ și include toate funcționalitățile."
  );

  console.log(
    "✅ Pro și Premium sunt indisponibile momentan."
  );

  console.log(
    `✅ ${migratedSubscriptions.count} abonamente Pro/Premium au fost mutate automat pe Basic.`
  );

  console.log(
    `✅ ${refreshedBasicSubscriptions.count} abonamente Basic au fost actualizate ca active pe termen lung.`
  );
}