// src/routes/subscriptionRoutes.js

import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { z } from "zod";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";

const router = Router();

const BILLING_ACTIVATION_AT = new Date(
  process.env.BILLING_ACTIVATION_AT ||
    "2026-05-17T00:00:00.000Z"
);

const PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  priceCents: true,
  currency: true,
  interval: true,
  features: true,
  entitlements: true,
  popular: true,
  trialDays: true,
  maxProducts: true,
  commissionBps: true,
  isActive: true,
  meta: true,
};

const PLAN_SELECT_INTERNAL = {
  ...PLAN_SELECT,
  stripePriceMonthId: true,
  stripePriceYearId: true,
};

const sendError = (
  res,
  code,
  status = 400,
  extra = {}
) =>
  res.status(status).json({
    ok: false,
    error: code,
    message: code,
    ...extra,
  });

const asyncHandler =
  (fn) =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function isBillingLocked(now = new Date()) {
  return now < BILLING_ACTIVATION_AT;
}

async function getVendorByUserSub(userSub) {
  return prisma.vendor.findUnique({
    where: {
      userId: userSub,
    },
  });
}

/*
 * =========================================================
 * Abonamentul activ curent
 * =========================================================
 */

async function getCurrentVendorSubscription(
  vendorId,
  { includePlan = true } = {}
) {
  const now = new Date();

  return prisma.vendorSubscription.findFirst({
    where: {
      vendorId,

      OR: [
        {
          status: "active",
          endAt: {
            gt: now,
          },
        },

        {
          trialEndsAt: {
            gt: now,
          },
        },
      ],
    },

    include: includePlan
      ? {
          plan: true,
        }
      : undefined,

    orderBy: [
      {
        startAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });
}

/*
 * =========================================================
 * Ultimul abonament
 * =========================================================
 */

async function getLatestVendorSubscription(
  vendorId,
  { includePlan = true } = {}
) {
  return prisma.vendorSubscription.findFirst({
    where: {
      vendorId,
    },

    include: includePlan
      ? {
          plan: true,
        }
      : undefined,

    orderBy: [
      {
        createdAt: "desc",
      },
    ],
  });
}

/*
 * =========================================================
 * Creează automat Basic pentru vendor
 * =========================================================
 */

export async function ensureBasicSubscriptionForVendor(
  vendorId
) {
  if (!vendorId) {
    return null;
  }

  /*
   * Dacă există deja un abonament activ,
   * nu mai creăm altul.
   */
  const existing =
    await getCurrentVendorSubscription(
      vendorId,
      {
        includePlan: true,
      }
    );

  if (existing) {
    return existing;
  }

  /*
   * Luăm Basic.
   */
  const basicPlan =
    await prisma.subscriptionPlan.findUnique({
      where: {
        code: "basic",
      },
    });

  if (
    !basicPlan ||
    basicPlan.isActive === false
  ) {
    return null;
  }

  const now = new Date();

  const endAt = new Date(now);

  /*
   * Basic gratuit valabil pe termen lung.
   */
  endAt.setFullYear(
    endAt.getFullYear() + 10
  );

  /*
   * Închidem eventualele abonamente vechi
   * care nu mai sunt active.
   *
   * Nu afectează magazinele deoarece imediat
   * după aceea creăm Basic activ.
   */
  await prisma.vendorSubscription.updateMany({
    where: {
      vendorId,

      status: {
        in: [
          "pending",
          "past_due",
          "unpaid",
          "canceled_at_period_end",
        ],
      },
    },

    data: {
      status: "canceled",
      endAt: now,
    },
  });

  return prisma.vendorSubscription.create({
    data: {
      vendorId,

      planId:
        basicPlan.id,

      status:
        "active",

      startAt:
        now,

      endAt,

      trialDays:
        null,

      trialEndsAt:
        null,

      meta: {
        activatedBy:
          "auto_basic",
      },
    },

    include: {
      plan: {
        select:
          PLAN_SELECT_INTERNAL,
      },
    },
  });
}

/*
 * =========================================================
 * Middleware — abonament activ
 * =========================================================
 */

export const requireActiveSubscription =
  asyncHandler(
    async (req, res, next) => {
      /*
       * Adminul trece direct.
       */
      if (
        req.user?.roles?.includes?.(
          "ADMIN"
        ) ||
        req.user?.role === "ADMIN"
      ) {
        return next();
      }

      const vendor =
        await getVendorByUserSub(
          req.user.sub
        );

      if (!vendor) {
        return sendError(
          res,
          "vendor_profile_missing",
          404
        );
      }

      const now = new Date();

      const sub =
        await prisma.vendorSubscription.findFirst(
          {
            where: {
              vendorId:
                vendor.id,

              status:
                "active",

              endAt: {
                gt: now,
              },
            },

            include: {
              plan: {
                select:
                  PLAN_SELECT_INTERNAL,
              },
            },

            orderBy: [
              {
                startAt:
                  "desc",
              },
              {
                createdAt:
                  "desc",
              },
            ],
          }
        );

      /*
       * IMPORTANT:
       *
       * Dacă vendorul nu are un abonament activ,
       * îi dăm automat Basic.
       *
       * Astfel nu rămâne fără acces și magazinele
       * nu sunt dezactivate din cauza abonamentului.
       */
      if (!sub) {
        const autoSub =
          await ensureBasicSubscriptionForVendor(
            vendor.id
          );

        if (!autoSub) {
          return sendError(
            res,
            "subscription_required",
            402,
            {
              hint:
                "Planul Basic gratuit nu a putut fi activat automat.",
            }
          );
        }

        req.meVendor =
          vendor;

        req.subscription =
          autoSub;

        return next();
      }

      req.meVendor =
        vendor;

      req.subscription =
        sub;

      return next();
    }
  );

/*
 * =========================================================
 * Checkout
 * =========================================================
 *
 * Momentan acceptăm doar Basic.
 */

const CheckoutQuery = z.object({
  plan: z.literal("basic"),

  period: z
    .enum(["month", "year"])
    .default("month"),

  applePay:
    z.string().optional(),

  googlePay:
    z.string().optional(),
});

/*
 * =========================================================
 * Lista planurilor
 * =========================================================
 *
 * Returnăm și Pro/Premium pentru ca frontend-ul
 * să le poată afișa ca "Indisponibil momentan".
 */

router.get(
  "/billing/plans",

  asyncHandler(
    async (_req, res) => {
      const plans =
        await prisma.subscriptionPlan.findMany(
          {
            where: {
              code: {
                in: [
                  "basic",
                  "pro",
                  "premium",
                ],
              },
            },

            select:
              PLAN_SELECT,
          }
        );

      const order = {
        basic: 1,
        pro: 2,
        premium: 3,
      };

      plans.sort(
        (a, b) =>
          (order[a.code] || 999) -
          (order[b.code] || 999)
      );

      return res.json({
        items:
          plans,

        billing: {
          locked:
            isBillingLocked(),

          activationAt:
            BILLING_ACTIVATION_AT.toISOString(),
        },
      });
    }
  )
);

/*
 * =========================================================
 * Abonamentul vendorului
 * =========================================================
 */

router.get(
  "/vendors/me/subscription",

  authRequired,
  vendorAccessRequired,

  asyncHandler(
    async (req, res) => {
      const meVendor =
        req.meVendor ??
        (await getVendorByUserSub(
          req.user.sub
        ));

      if (!meVendor) {
        return sendError(
          res,
          "vendor_profile_missing",
          404
        );
      }

      /*
       * Încercăm mai întâi abonamentul activ.
       */
      let current =
        await getCurrentVendorSubscription(
          meVendor.id,
          {
            includePlan: true,
          }
        );

      /*
       * Dacă nu există, activăm automat Basic.
       */
      if (!current) {
        current =
          await ensureBasicSubscriptionForVendor(
            meVendor.id
          );
      }

      /*
       * Fallback doar dacă Basic nu s-a putut crea.
       */
      const latest =
        current ??
        (await getLatestVendorSubscription(
          meVendor.id,
          {
            includePlan: true,
          }
        ));

      return res.json({
        subscription:
          latest || null,

        billing: {
          locked:
            isBillingLocked(),

          activationAt:
            BILLING_ACTIVATION_AT.toISOString(),
        },
      });
    }
  )
);

/*
 * =========================================================
 * Status abonament vendor
 * =========================================================
 */

router.get(
  "/vendors/me/subscription/status",

  authRequired,
  vendorAccessRequired,

  asyncHandler(
    async (req, res) => {
      const meVendor =
        req.meVendor ??
        (await getVendorByUserSub(
          req.user.sub
        ));

      if (!meVendor) {
        return sendError(
          res,
          "vendor_profile_missing",
          404
        );
      }

      const now =
        new Date();

      let current =
        await prisma.vendorSubscription.findFirst(
          {
            where: {
              vendorId:
                meVendor.id,

              status:
                "active",

              endAt: {
                gt: now,
              },
            },

            include: {
              plan: {
                select: {
                  code:
                    true,

                  name:
                    true,

                  priceCents:
                    true,

                  entitlements:
                    true,

                  meta:
                    true,

                  maxProducts:
                    true,

                  commissionBps:
                    true,

                  trialDays:
                    true,

                  isActive:
                    true,
                },
              },
            },

            orderBy: [
              {
                startAt:
                  "desc",
              },

              {
                createdAt:
                  "desc",
              },
            ],
          }
        );

      /*
       * Dacă nu există niciun abonament activ,
       * activăm automat Basic.
       */
      if (!current) {
        current =
          await ensureBasicSubscriptionForVendor(
            meVendor.id
          );
      }

      if (!current) {
        return res.json({
          ok:
            false,

          code:
            "subscription_required",

          upgradeUrl:
            "/setari?tab=subscription",

          billingLocked:
            isBillingLocked(),

          billingActivationAt:
            BILLING_ACTIVATION_AT.toISOString(),
        });
      }

      const isFreeBasic =
        current.plan?.code ===
        "basic";

      return res.json({
        ok:
          true,

        kind:
          isFreeBasic
            ? "free_basic"
            : "paid",

        plan:
          current.plan,

        endAt:
          current.endAt ??
          null,

        trialEndsAt:
          null,

        status:
          current.status,

        billingLocked:
          isBillingLocked(),

        billingActivationAt:
          BILLING_ACTIVATION_AT.toISOString(),
      });
    }
  )
);

/*
 * =========================================================
 * Job expirare abonamente
 * =========================================================
 *
 * Basic are endAt la +10 ani, deci în mod normal
 * nu va fi afectat.
 */

export async function expireSubscriptionsJob() {
  const now =
    new Date();

  await prisma.vendorSubscription.updateMany({
    where: {
      status: {
        in: [
          "active",
          "pending",
          "canceled_at_period_end",
        ],
      },

      endAt: {
        lte: now,
      },
    },

    data: {
      status:
        "expired",
    },
  });
}

/*
 * =========================================================
 * Trial
 * =========================================================
 *
 * Dezactivat momentan deoarece Basic este gratuit
 * și oferă toate funcționalitățile.
 */

router.post(
  "/vendors/me/subscription/trial-select",

  authRequired,
  vendorAccessRequired,

  asyncHandler(
    async (_req, res) => {
      return sendError(
        res,
        "trial_temporarily_unavailable",
        409,
        {
          message:
            "Trial-ul nu este disponibil momentan. Planul Basic este gratuit și include toate funcționalitățile.",
        }
      );
    }
  )
);

/*
 * =========================================================
 * Activare Basic gratuit
 * =========================================================
 */

router.post(
  "/billing/checkout",

  authRequired,
  vendorAccessRequired,

  asyncHandler(
    async (req, res) => {
      const q =
        CheckoutQuery.parse(
          req.query
        );

      const vendor =
        req.meVendor ??
        (await getVendorByUserSub(
          req.user.sub
        ));

      if (!vendor) {
        return sendError(
          res,
          "vendor_profile_missing",
          404
        );
      }

      const plan =
        await prisma.subscriptionPlan.findUnique(
          {
            where: {
              code:
                q.plan,
            },
          }
        );

      if (!plan) {
        return sendError(
          res,
          "plan_not_found",
          404
        );
      }

      if (
        plan.isActive ===
        false
      ) {
        return sendError(
          res,
          "plan_inactive",
          409
        );
      }

      /*
       * În perioada aceasta checkout-ul este permis
       * doar pentru planul Basic gratuit.
       */
      if (
        plan.code !==
        "basic"
      ) {
        return sendError(
          res,
          "plan_inactive",
          409,
          {
            message:
              "Planul selectat nu este disponibil momentan.",
          }
        );
      }

      /*
       * Dacă vendorul are deja Basic activ,
       * nu mai creăm încă un abonament.
       */
      const existing =
        await getCurrentVendorSubscription(
          vendor.id,
          {
            includePlan: true,
          }
        );

      if (
        existing?.plan?.code ===
          "basic" &&
        existing?.status ===
          "active"
      ) {
        return res.json({
          ok:
            true,

          kind:
            "free_already_active",

          subscription:
            existing,

          url:
            "/setari?tab=subscription&subscription=success",
        });
      }

      /*
       * Activăm automat Basic.
       */
      const sub =
        await ensureBasicSubscriptionForVendor(
          vendor.id
        );

      if (!sub) {
        return sendError(
          res,
          "basic_activation_failed",
          500,
          {
            message:
              "Planul Basic gratuit nu a putut fi activat.",
          }
        );
      }

      return res.json({
        ok:
          true,

        kind:
          "free_activated",

        subscription:
          sub,

        url:
          "/setari?tab=subscription&subscription=success",
      });
    }
  )
);

/*
 * =========================================================
 * Anulare abonament
 * =========================================================
 *
 * Basic nu poate fi anulat deoarece este planul
 * gratuit implicit al platformei.
 */

router.post(
  "/vendors/me/subscription/cancel",

  authRequired,
  vendorAccessRequired,

  asyncHandler(
    async (req, res) => {
      const vendor =
        req.meVendor ??
        (await getVendorByUserSub(
          req.user.sub
        ));

      if (!vendor) {
        return sendError(
          res,
          "vendor_profile_missing",
          404
        );
      }

      const sub =
        await prisma.vendorSubscription.findFirst(
          {
            where: {
              vendorId:
                vendor.id,

              status: {
                in: [
                  "active",
                  "pending",
                  "past_due",
                  "unpaid",
                ],
              },
            },

            include: {
              plan: {
                select:
                  PLAN_SELECT_INTERNAL,
              },
            },

            orderBy: [
              {
                startAt:
                  "desc",
              },

              {
                createdAt:
                  "desc",
              },
            ],
          }
        );

      if (!sub) {
        /*
         * Dacă nu există abonament, îl reparăm
         * automat cu Basic.
         */
        const autoSub =
          await ensureBasicSubscriptionForVendor(
            vendor.id
          );

        if (autoSub) {
          return sendError(
            res,
            "free_plan_cannot_be_canceled",
            409,
            {
              message:
                "Planul Basic este planul gratuit implicit și nu necesită anulare.",
            }
          );
        }

        return sendError(
          res,
          "subscription_not_found",
          404
        );
      }

      /*
       * Basic gratuit nu poate fi anulat.
       */
      if (
        sub.plan?.code ===
        "basic"
      ) {
        return sendError(
          res,
          "free_plan_cannot_be_canceled",
          409,
          {
            message:
              "Planul Basic este planul gratuit implicit și nu necesită anulare.",
          }
        );
      }

      /*
       * În mod normal nu ar mai trebui să ajungem aici
       * deoarece Pro/Premium sunt inactive.
       *
       * Păstrăm însă protecția pentru eventuale date
       * vechi din DB.
       */

      const now =
        new Date();

      await prisma.vendorSubscription.update({
        where: {
          id:
            sub.id,
        },

        data: {
          status:
            "canceled",

          endAt:
            now,

          meta: {
            ...(sub.meta &&
            typeof sub.meta ===
              "object"
              ? sub.meta
              : {}),

            canceledBy:
              "vendor",

            canceledAt:
              now.toISOString(),
          },
        },
      });

      /*
       * După anularea unui eventual plan vechi,
       * îi activăm imediat Basic.
       */
      const basicSub =
        await ensureBasicSubscriptionForVendor(
          vendor.id
        );

      return res.json({
        ok:
          true,

        kind:
          "moved_to_basic",

        subscription:
          basicSub,
      });
    }
  )
);

export default router;