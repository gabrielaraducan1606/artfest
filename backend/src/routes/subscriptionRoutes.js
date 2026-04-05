// backend/src/routes/subscriptionRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { z } from "zod";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";

// ✅ NEW: Stripe subscription checkout
import { createSubscriptionCheckoutSession } from "../payments/stripe.subscriptions.js"; 
// dacă path-ul nu e corect la tine, mută payments în backend/src/payments și importă local.

const router = Router();

const sendError = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, error: code, message: code, ...extra });

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const requireActiveSubscription = asyncHandler(async (req, res, next) => {
  if (req.user?.roles?.includes?.("ADMIN") || req.user?.role === "ADMIN") return next();

  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
  if (!vendor) return sendError(res, "vendor_profile_missing", 404);

  const now = new Date();
  const graceDays = Number(process.env.SUBS_GRACE_DAYS || 0);
  const cutoff = new Date(now);
  if (graceDays > 0) cutoff.setDate(cutoff.getDate() - graceDays);

  const sub = await prisma.vendorSubscription.findFirst({
    where: {
      vendorId: vendor.id,
      OR: [
        {
          status: "active",
          OR: [
            { endAt: { gt: now } },
            ...(graceDays > 0 ? [{ endAt: { gt: cutoff } }] : []),
          ],
        },
        { trialEndsAt: { gt: now } },
      ],
    },
    orderBy: [{ startAt: "desc" }],
    include: { plan: { select: { id: true, code: true, name: true, entitlements: true } } },
  });

  if (!sub)
    return sendError(res, "subscription_required", 402, {
      hint: "Ai nevoie de un abonament activ sau de un trial activ.",
    });

  req.subscription = sub;
  next();
});

const CheckoutQuery = z.object({
  plan: z.string().trim().min(1),
  period: z.enum(["month", "year"]).default("month"),
  applePay: z.string().optional(),
  googlePay: z.string().optional(),
});

router.get(
  "/billing/plans",
  asyncHandler(async (_req, res) => {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { priceCents: "asc" },
      select: {
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

        // useful debug (optional)
        stripePriceMonthId: true,
        stripePriceYearId: true,
      },
    });
    res.json({ items: plans });
  })
);

router.get(
  "/vendors/me/subscription",
  authRequired,
  vendorAccessRequired,
  asyncHandler(async (req, res) => {
    const meVendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
    if (!meVendor) return sendError(res, "vendor_profile_missing", 404);

    const now = new Date();

    const sub =
      (await prisma.vendorSubscription.findFirst({
        where: {
          vendorId: meVendor.id,
          OR: [{ status: "active", endAt: { gt: now } }, { trialEndsAt: { gt: now } }],
        },
        orderBy: [{ startAt: "desc" }],
        include: { plan: true },
      })) ??
      (await prisma.vendorSubscription.findFirst({
        where: { vendorId: meVendor.id },
        orderBy: [{ createdAt: "desc" }],
        include: { plan: true },
      }));

    res.json({ subscription: sub || null });
  })
);

router.get(
  "/vendors/me/subscription/status",
  authRequired,
  vendorAccessRequired,
  asyncHandler(async (req, res) => {
    const meVendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
    if (!meVendor) return sendError(res, "vendor_profile_missing", 404);

    const now = new Date();

    const current = await prisma.vendorSubscription.findFirst({
      where: {
        vendorId: meVendor.id,
        OR: [{ status: "active", endAt: { gt: now } }, { trialEndsAt: { gt: now } }],
      },
      include: { plan: { select: { code: true, name: true, entitlements: true } } },
      orderBy: [{ startAt: "desc" }],
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

router.post(
  "/billing/checkout",
  authRequired,
  vendorAccessRequired,
  asyncHandler(async (req, res) => {
    const q = CheckoutQuery.parse(req.query);

    const vendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));

    if (!vendor) return sendError(res, "vendor_profile_missing", 404);

    const plan = await prisma.subscriptionPlan.findUnique({ where: { code: q.plan } });
    if (!plan) return sendError(res, "plan_not_found", 404);
    if (plan.isActive === false) return sendError(res, "plan_inactive", 409);

    // ✅ plan gratuit: activezi direct (cum aveai)
    if ((plan.priceCents ?? 0) === 0) {
      const now = new Date();
      const endAt = new Date(now);
      endAt.setFullYear(endAt.getFullYear() + 10);

      const sub = await prisma.vendorSubscription.create({
        data: {
          vendorId: vendor.id,
          planId: plan.id,
          status: "active",
          startAt: now,
          endAt,
          meta: { activatedBy: "free_plan" },
        },
        include: { plan: { select: { code: true, name: true, entitlements: true } } },
      });

      return res.json({
        ok: true,
        kind: "free_activated",
        subscription: sub,
        url: "/onboarding/details?tab=plata&activated=1",
      });
    }

    // ✅ plan plătit: Stripe Checkout Subscription
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
