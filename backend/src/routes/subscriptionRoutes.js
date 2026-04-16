import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { z } from "zod";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";
import { createSubscriptionCheckoutSession } from "../payments/stripe.subscriptions.js";

const router = Router();

const sendError = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, error: code, message: code, ...extra });

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ===================== Helpers ===================== */

async function getVendorByUserSub(userSub) {
  return prisma.vendor.findUnique({
    where: { userId: userSub },
  });
}

async function getCurrentVendorSubscription(vendorId, { includePlan = true } = {}) {
  const now = new Date();

  return prisma.vendorSubscription.findFirst({
    where: {
      vendorId,
      OR: [
        { status: "active", endAt: { gt: now } },
        { trialEndsAt: { gt: now } },
      ],
    },
    include: includePlan ? { plan: true } : undefined,
    orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
  });
}

async function getLatestVendorSubscription(vendorId, { includePlan = true } = {}) {
  return prisma.vendorSubscription.findFirst({
    where: { vendorId },
    include: includePlan ? { plan: true } : undefined,
    orderBy: [{ createdAt: "desc" }],
  });
}

/* ===================== Subscription Guard ===================== */

export const requireActiveSubscription = asyncHandler(async (req, res, next) => {
  if (req.user?.roles?.includes?.("ADMIN") || req.user?.role === "ADMIN") {
    return next();
  }

  const vendor = await getVendorByUserSub(req.user.sub);

  if (!vendor) {
    return sendError(res, "vendor_profile_missing", 404);
  }

  const now = new Date();
  const graceDays = Number(process.env.SUBS_GRACE_DAYS || 0);
  const graceCutoff = new Date(now);

  if (graceDays > 0) {
    graceCutoff.setDate(graceCutoff.getDate() - graceCutoff.getDate() + now.getDate() - graceDays);
    graceCutoff.setTime(now.getTime());
    graceCutoff.setDate(now.getDate() - graceDays);
  }

  const sub = await prisma.vendorSubscription.findFirst({
    where: {
      vendorId: vendor.id,
      OR: [
        { status: "active", endAt: { gt: now } },
        { trialEndsAt: { gt: now } },
        ...(graceDays > 0
          ? [
              {
                status: { in: ["past_due", "unpaid"] },
                endAt: { gt: graceCutoff },
              },
            ]
          : []),
      ],
    },
    include: {
      plan: {
        select: {
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
          stripePriceMonthId: true,
          stripePriceYearId: true,
        },
      },
    },
    orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
  });

  if (!sub) {
    return sendError(res, "subscription_required", 402, {
      hint: "Ai nevoie de un abonament activ sau de un trial activ.",
    });
  }

  req.meVendor = vendor;
  req.subscription = sub;
  return next();
});

/* ===================== Validation ===================== */

const CheckoutQuery = z.object({
  plan: z.enum(["basic", "pro", "premium"]),
  period: z.enum(["month", "year"]).default("month"),
  applePay: z.string().optional(),
  googlePay: z.string().optional(),
});

/* ===================== Billing Plans ===================== */

router.get(
  "/billing/plans",
  asyncHandler(async (_req, res) => {
    const plans = await prisma.subscriptionPlan.findMany({
      where: {
        code: { in: ["basic", "pro", "premium"] },
      },
      select: {
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
        stripePriceMonthId: true,
        stripePriceYearId: true,
      },
    });

    const order = { basic: 1, pro: 2, premium: 3 };
    plans.sort((a, b) => (order[a.code] || 999) - (order[b.code] || 999));

    return res.json({ items: plans });
  })
);

/* ===================== Current Subscription ===================== */

router.get(
  "/vendors/me/subscription",
  authRequired,
  vendorAccessRequired,
  asyncHandler(async (req, res) => {
    const meVendor = req.meVendor ?? (await getVendorByUserSub(req.user.sub));

    if (!meVendor) {
      return sendError(res, "vendor_profile_missing", 404);
    }

    const current = await getCurrentVendorSubscription(meVendor.id, { includePlan: true });
    const latest = current ?? (await getLatestVendorSubscription(meVendor.id, { includePlan: true }));

    return res.json({ subscription: latest || null });
  })
);

router.get(
  "/vendors/me/subscription/status",
  authRequired,
  vendorAccessRequired,
  asyncHandler(async (req, res) => {
    const meVendor = req.meVendor ?? (await getVendorByUserSub(req.user.sub));

    if (!meVendor) {
      return sendError(res, "vendor_profile_missing", 404);
    }

    const now = new Date();

    const current = await prisma.vendorSubscription.findFirst({
      where: {
        vendorId: meVendor.id,
        OR: [
          { status: "active", endAt: { gt: now } },
          { trialEndsAt: { gt: now } },
        ],
      },
      include: {
        plan: {
          select: {
            code: true,
            name: true,
            entitlements: true,
            meta: true,
            maxProducts: true,
            commissionBps: true,
            trialDays: true,
          },
        },
      },
      orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
    });

    if (!current) {
      return res.json({
        ok: false,
        code: "subscription_required",
        upgradeUrl: "/onboarding/details?tab=plata&solo=1",
      });
    }

    const isTrial = !!(current.trialEndsAt && current.trialEndsAt > now);

    return res.json({
      ok: true,
      kind: isTrial ? "trial" : "paid",
      plan: current.plan,
      endAt: current.endAt ?? null,
      trialEndsAt: current.trialEndsAt ?? null,
      status: current.status,
    });
  })
);

/* ===================== Expire Job ===================== */

export async function expireSubscriptionsJob() {
  const now = new Date();

  await prisma.vendorSubscription.updateMany({
    where: {
      status: { in: ["active", "pending", "canceled_at_period_end"] },
      endAt: { lte: now },
    },
    data: { status: "expired" },
  });
}

/* ===================== Checkout ===================== */

router.post(
  "/billing/checkout",
  authRequired,
  vendorAccessRequired,
  asyncHandler(async (req, res) => {
    const q = CheckoutQuery.parse(req.query);

    const vendor = req.meVendor ?? (await getVendorByUserSub(req.user.sub));

    if (!vendor) {
      return sendError(res, "vendor_profile_missing", 404);
    }

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { code: q.plan },
    });

    if (!plan) {
      return sendError(res, "plan_not_found", 404);
    }

    if (plan.isActive === false) {
      return sendError(res, "plan_inactive", 409);
    }

    // Activare plan gratuit
    if ((plan.priceCents ?? 0) === 0) {
      const now = new Date();
      const endAt = new Date(now);
      endAt.setFullYear(endAt.getFullYear() + 10);

      await prisma.vendorSubscription.updateMany({
        where: {
          vendorId: vendor.id,
          status: { in: ["active", "pending", "past_due", "unpaid"] },
        },
        data: {
          status: "canceled",
          endAt: now,
        },
      });

      const sub = await prisma.vendorSubscription.create({
        data: {
          vendorId: vendor.id,
          planId: plan.id,
          status: "active",
          startAt: now,
          endAt,
          meta: {
            activatedBy: "free_plan",
          },
        },
        include: {
          plan: {
            select: {
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
              stripePriceMonthId: true,
              stripePriceYearId: true,
            },
          },
        },
      });

      return res.json({
        ok: true,
        kind: "free_activated",
        subscription: sub,
        url: "/onboarding/details?tab=plata&activated=1",
      });
    }

    try {
      const out = await createSubscriptionCheckoutSession({
        vendorId: vendor.id,
        userId: req.user.sub,
        planCode: plan.code,
        period: q.period,
      });

      return res.json({
        ok: true,
        kind: "provider_redirect",
        provider: "stripe",
        url: out.url,
      });
    } catch (e) {
      const code = e?.message || "checkout_failed";
      const status = e?.status || 400;
      return sendError(res, code, status);
    }
  })
);

export default router;