// src/routes/adminVendorPlans.routes.js
import { Router } from "express";
import Stripe from "stripe";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { z } from "zod";

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const sendError = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, error: code, message: code, ...extra });

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const adminRequired = (req, res, next) => {
  if (req.user?.role === "ADMIN") return next();
  return sendError(res, "forbidden_admin", 403);
};

function iso(d) {
  return d ? new Date(d).toISOString() : null;
}

function daysUntil(date) {
  if (!date) return null;
  return Math.ceil((new Date(date) - new Date()) / (1000 * 60 * 60 * 24));
}

function getMeta(obj) {
  return obj && typeof obj === "object" ? obj : {};
}

function mapStripeStatusToLocal(stripeStatus, cancelAtPeriodEnd) {
  if (stripeStatus === "active") {
    return cancelAtPeriodEnd ? "canceled_at_period_end" : "active";
  }

  if (stripeStatus === "trialing") {
    return cancelAtPeriodEnd ? "canceled_at_period_end" : "active";
  }

  if (stripeStatus === "canceled") return "canceled";
  if (stripeStatus === "past_due") return "past_due";
  if (stripeStatus === "unpaid") return "unpaid";
  if (stripeStatus === "incomplete") return "pending";
  if (stripeStatus === "incomplete_expired") return "expired";

  return "pending";
}

function getBillingState(sub, now = new Date()) {
  if (!sub) return "none";

  if (sub.status === "active" && sub.trialEndsAt && sub.trialEndsAt > now) {
    return "trial";
  }

  if (sub.status === "active" && sub.endAt && sub.endAt > now) {
    return "paid";
  }

  if (sub.status === "past_due") return "past_due";
  if (sub.status === "unpaid") return "unpaid";
  if (sub.status === "canceled_at_period_end") return "canceling";
  if (sub.status === "canceled") return "canceled";
  if (sub.status === "expired") return "expired";
  if (sub.status === "pending") return "pending";

  return sub.status || "unknown";
}

function publicSubscription(sub, now = new Date()) {
  if (!sub) return null;

  const meta = getMeta(sub.meta);
  const state = getBillingState(sub, now);

  return {
    id: sub.id,
    vendorId: sub.vendorId,
    status: sub.status,
    billingState: state,
    startAt: iso(sub.startAt),
    endAt: iso(sub.endAt),
    trialDays: sub.trialDays ?? null,
    trialStartsAt: iso(sub.trialStartsAt),
    trialEndsAt: iso(sub.trialEndsAt),
    daysLeft: daysUntil(sub.endAt),
    trialDaysLeft: daysUntil(sub.trialEndsAt),
    stripeCustomerId: sub.stripeCustomerId || null,
    stripeSubscriptionId: sub.stripeSubscriptionId || null,
    stripeCheckoutSessionId: sub.stripeCheckoutSessionId || null,
    stripeStatus: meta.stripeStatus || null,
    cancelAtPeriodEnd: !!meta.cancelAtPeriodEnd,
    createdAt: iso(sub.createdAt),
    updatedAt: iso(sub.updatedAt),
    plan: sub.plan
      ? {
          id: sub.plan.id,
          code: sub.plan.code,
          name: sub.plan.name,
          priceCents: sub.plan.priceCents,
          currency: sub.plan.currency,
          interval: sub.plan.interval,
          trialDays: sub.plan.trialDays,
          isActive: sub.plan.isActive,
          popular: sub.plan.popular,
          maxProducts: sub.plan.maxProducts,
          maxStores: sub.plan.maxStores,
          commissionBps: sub.plan.commissionBps,
          meta: sub.plan.meta,
        }
      : null,
  };
}

/**
 * GET /api/admin/vendors/plans
 */
const Query = z.object({
  q: z.string().optional(),
  status: z
    .enum([
      "pending",
      "active",
      "canceled",
      "canceled_at_period_end",
      "past_due",
      "unpaid",
      "expired",
    ])
    .optional(),
  billingState: z
    .enum([
      "none",
      "trial",
      "paid",
      "past_due",
      "unpaid",
      "canceling",
      "canceled",
      "expired",
      "pending",
    ])
    .optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  onlyWithSubscription: z.string().optional(),
});

router.get(
  "/vendors/plans",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const parsed = Query.safeParse(req.query);

    if (!parsed.success) {
      return sendError(res, "invalid_query", 400, {
        issues: parsed.error.issues,
      });
    }

    const { q, status, billingState, take, skip, onlyWithSubscription } = parsed.data;
    const now = new Date();

    const vendorWhere = q?.trim()
      ? {
          OR: [
            { displayName: { contains: q.trim(), mode: "insensitive" } },
            { email: { contains: q.trim(), mode: "insensitive" } },
            { phone: { contains: q.trim(), mode: "insensitive" } },
            { user: { email: { contains: q.trim(), mode: "insensitive" } } },
            { user: { firstName: { contains: q.trim(), mode: "insensitive" } } },
            { user: { lastName: { contains: q.trim(), mode: "insensitive" } } },
            { user: { name: { contains: q.trim(), mode: "insensitive" } } },
          ],
        }
      : {};

    const subscriptionWhere =
      status || onlyWithSubscription === "1"
        ? {
            subscriptions: {
              some: {
                ...(status ? { status } : {}),
              },
            },
          }
        : {};

    const billingStateWhere =
      billingState === "none"
        ? {
            subscriptions: {
              none: {},
            },
          }
        : billingState === "trial"
          ? {
              subscriptions: {
                some: {
                  status: "active",
                  trialEndsAt: { gt: now },
                },
              },
            }
          : billingState === "paid"
            ? {
                subscriptions: {
                  some: {
                    status: "active",
                    endAt: { gt: now },
                    OR: [{ trialEndsAt: null }, { trialEndsAt: { lte: now } }],
                  },
                },
              }
            : billingState === "past_due"
              ? { subscriptions: { some: { status: "past_due" } } }
              : billingState === "unpaid"
                ? { subscriptions: { some: { status: "unpaid" } } }
                : billingState === "canceling"
                  ? { subscriptions: { some: { status: "canceled_at_period_end" } } }
                  : billingState === "canceled"
                    ? { subscriptions: { some: { status: "canceled" } } }
                    : billingState === "expired"
                      ? { subscriptions: { some: { status: "expired" } } }
                      : billingState === "pending"
                        ? { subscriptions: { some: { status: "pending" } } }
                        : {};

    const where = {
      ...vendorWhere,
      ...subscriptionWhere,
      ...billingStateWhere,
    };

    const [total, vendors] = await Promise.all([
      prisma.vendor.count({ where }),
      prisma.vendor.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              name: true,
              phone: true,
              role: true,
              status: true,
              createdAt: true,
            },
          },
          subscriptions: {
            orderBy: [{ createdAt: "desc" }],
            take: 1,
            include: { plan: true },
          },
        },
      }),
    ]);

    const vendorIds = vendors.map((v) => v.id);

    const currentSubs = vendorIds.length
      ? await prisma.vendorSubscription.findMany({
          where: {
            vendorId: { in: vendorIds },
            OR: [
              { status: "active", endAt: { gt: now } },
              { trialEndsAt: { gt: now } },
              { status: { in: ["past_due", "unpaid", "canceled_at_period_end"] } },
            ],
          },
          orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
          include: { plan: true },
        })
      : [];

    const currentByVendor = new Map();

    for (const s of currentSubs) {
      if (!currentByVendor.has(s.vendorId)) {
        currentByVendor.set(s.vendorId, s);
      }
    }

    const items = vendors.map((v) => {
      const latest = v.subscriptions?.[0] || null;
      const current = currentByVendor.get(v.id) || null;
      const displaySub = current || latest;
      const state = getBillingState(displaySub, now);

      return {
        vendorId: v.id,
        displayName: v.displayName,
        vendorEmail: v.email,
        vendorPhone: v.phone,
        isActive: v.isActive,
        createdAt: iso(v.createdAt),
        user: v.user,

        billing: {
          state,
          isPaid: state === "paid",
          isTrial: state === "trial",
          isPastDue: state === "past_due",
          isUnpaid: state === "unpaid",
          isCanceling: state === "canceling",
          isCanceled: state === "canceled",
          isExpired: state === "expired",
          isPending: state === "pending",
          isBlocked: ["none", "unpaid", "canceled", "expired"].includes(state),
          daysLeft: daysUntil(displaySub?.endAt),
          trialDaysLeft: daysUntil(displaySub?.trialEndsAt),
          cancelAtPeriodEnd: !!getMeta(displaySub?.meta).cancelAtPeriodEnd,
          stripeStatus: getMeta(displaySub?.meta).stripeStatus || null,
          hasStripeSubscription: !!displaySub?.stripeSubscriptionId,
        },

        latestSubscription: publicSubscription(latest, now),
        currentSubscription: publicSubscription(current, now),
      };
    });

    res.json({
      total,
      take,
      skip,
      items,
      filters: {
        q: q || null,
        status: status || null,
        billingState: billingState || null,
        onlyWithSubscription: onlyWithSubscription === "1",
      },
    });
  })
);

/**
 * PATCH /api/admin/vendors/:vendorId/subscription/trial
 */
const TrialBody = z.object({
  trialDays: z.coerce.number().int().min(0).max(365).default(0),
});

router.patch(
  "/vendors/:vendorId/subscription/trial",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const vendorId = String(req.params.vendorId || "");

    if (!vendorId) {
      return sendError(res, "missing_vendor_id", 400);
    }

    const parsed = TrialBody.safeParse(req.body);

    if (!parsed.success) {
      return sendError(res, "invalid_body", 400, {
        issues: parsed.error.issues,
      });
    }

    const { trialDays } = parsed.data;
    const now = new Date();

    const current = await prisma.vendorSubscription.findFirst({
      where: {
        vendorId,
        OR: [{ status: "active", endAt: { gt: now } }, { trialEndsAt: { gt: now } }],
      },
      orderBy: { startAt: "desc" },
      include: { plan: true },
    });

    const target =
      current ??
      (await prisma.vendorSubscription.findFirst({
        where: { vendorId },
        orderBy: { createdAt: "desc" },
        include: { plan: true },
      }));

    if (!target) {
      return sendError(res, "subscription_not_found", 404);
    }

    const trialStartsAt = trialDays > 0 ? now : null;
    const trialEndsAt =
      trialDays > 0 ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null;

    const updated = await prisma.vendorSubscription.update({
      where: { id: target.id },
      data: {
        trialDays: trialDays > 0 ? trialDays : null,
        trialStartsAt,
        trialEndsAt,
        endAt: trialEndsAt || target.endAt,
        meta: {
          ...getMeta(target.meta),
          adminTrialOverrideAt: now.toISOString(),
          adminTrialDays: trialDays,
        },
      },
      include: { plan: true },
    });

    res.json({
      ok: true,
      subscription: publicSubscription(updated, now),
      trial: {
        trialDays: trialDays > 0 ? trialDays : 0,
        trialStartsAt: iso(trialStartsAt),
        trialEndsAt: iso(trialEndsAt),
      },
    });
  })
);

/**
 * POST /api/admin/vendors/:vendorId/subscription/stripe/sync
 */
router.post(
  "/vendors/:vendorId/subscription/stripe/sync",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const vendorId = String(req.params.vendorId || "");

    if (!vendorId) {
      return sendError(res, "missing_vendor_id", 400);
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return sendError(res, "stripe_missing_key", 500);
    }

    const sub = await prisma.vendorSubscription.findFirst({
      where: { vendorId, stripeSubscriptionId: { not: null } },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    });

    if (!sub) {
      return sendError(res, "stripe_subscription_missing", 404);
    }

    const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);

    const currentPeriodEnd = s.current_period_end
      ? new Date(s.current_period_end * 1000)
      : null;

    const trialStart = s.trial_start ? new Date(s.trial_start * 1000) : null;
    const trialEnd = s.trial_end ? new Date(s.trial_end * 1000) : null;
    const localStatus = mapStripeStatusToLocal(s.status, !!s.cancel_at_period_end);

    const updated = await prisma.vendorSubscription.update({
      where: { id: sub.id },
      data: {
        status: localStatus,
        endAt: currentPeriodEnd || trialEnd || sub.endAt,
        trialStartsAt: trialStart,
        trialEndsAt: trialEnd,
        stripeCustomerId: typeof s.customer === "string" ? s.customer : sub.stripeCustomerId,
        meta: {
          ...getMeta(sub.meta),
          stripeStatus: s.status,
          cancelAtPeriodEnd: !!s.cancel_at_period_end,
          currentPeriodStart: s.current_period_start
            ? new Date(s.current_period_start * 1000).toISOString()
            : null,
          currentPeriodEnd: currentPeriodEnd?.toISOString?.() || null,
          syncedAt: new Date().toISOString(),
        },
      },
      include: { plan: true },
    });

    res.json({
      ok: true,
      subscription: publicSubscription(updated),
    });
  })
);

/**
 * POST /api/admin/vendors/:vendorId/subscription/stripe/cancel
 */
router.post(
  "/vendors/:vendorId/subscription/stripe/cancel",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const vendorId = String(req.params.vendorId || "");

    if (!vendorId) {
      return sendError(res, "missing_vendor_id", 400);
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return sendError(res, "stripe_missing_key", 500);
    }

    const sub = await prisma.vendorSubscription.findFirst({
      where: { vendorId, stripeSubscriptionId: { not: null } },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    });

    if (!sub) {
      return sendError(res, "stripe_subscription_missing", 404);
    }

    const s = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    const updated = await prisma.vendorSubscription.update({
      where: { id: sub.id },
      data: {
        status: "canceled_at_period_end",
        meta: {
          ...getMeta(sub.meta),
          cancelAtPeriodEnd: true,
          stripeStatus: s.status,
          adminCanceledAtPeriodEndAt: new Date().toISOString(),
        },
      },
      include: { plan: true },
    });

    res.json({
      ok: true,
      subscription: publicSubscription(updated),
    });
  })
);

/**
 * POST /api/admin/vendors/:vendorId/subscription/stripe/resume
 */
router.post(
  "/vendors/:vendorId/subscription/stripe/resume",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const vendorId = String(req.params.vendorId || "");

    if (!vendorId) {
      return sendError(res, "missing_vendor_id", 400);
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return sendError(res, "stripe_missing_key", 500);
    }

    const sub = await prisma.vendorSubscription.findFirst({
      where: { vendorId, stripeSubscriptionId: { not: null } },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    });

    if (!sub) {
      return sendError(res, "stripe_subscription_missing", 404);
    }

    const s = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    const localStatus = mapStripeStatusToLocal(s.status, false);

    const updated = await prisma.vendorSubscription.update({
      where: { id: sub.id },
      data: {
        status: localStatus,
        meta: {
          ...getMeta(sub.meta),
          cancelAtPeriodEnd: false,
          stripeStatus: s.status,
          adminResumedAt: new Date().toISOString(),
        },
      },
      include: { plan: true },
    });

    res.json({
      ok: true,
      subscription: publicSubscription(updated),
    });
  })
);

export default router;