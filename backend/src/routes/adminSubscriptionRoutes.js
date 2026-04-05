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

function mapStripeStatusToLocal(stripeStatus, cancelAtPeriodEnd) {
  // adaptează dacă ai enum-uri diferite în DB
  if (stripeStatus === "active") return cancelAtPeriodEnd ? "canceled_at_period_end" : "active";
  if (stripeStatus === "trialing") return cancelAtPeriodEnd ? "canceled_at_period_end" : "active";
  if (stripeStatus === "canceled") return "canceled";
  if (stripeStatus === "past_due") return "past_due";
  if (stripeStatus === "unpaid") return "unpaid";
  if (stripeStatus === "incomplete" || stripeStatus === "incomplete_expired") return "pending";
  return "pending";
}

/**
 * GET /api/admin/vendors/plans
 */
const Query = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
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
    if (!parsed.success)
      return sendError(res, "invalid_query", 400, { issues: parsed.error.issues });

    const { q, status, take, skip, onlyWithSubscription } = parsed.data;

    const vendorWhere = q?.trim()
      ? {
          OR: [
            { displayName: { contains: q.trim(), mode: "insensitive" } },
            { user: { email: { contains: q.trim(), mode: "insensitive" } } },
            { user: { firstName: { contains: q.trim(), mode: "insensitive" } } },
            { user: { lastName: { contains: q.trim(), mode: "insensitive" } } },
            { user: { name: { contains: q.trim(), mode: "insensitive" } } },
          ],
        }
      : undefined;

    const where = {
      ...(vendorWhere || {}),
      ...(onlyWithSubscription === "1" ? { subscriptions: { some: {} } } : {}),
    };

    const now = new Date();

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
            ...(status ? { where: { status } } : {}),
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
            ],
          },
          orderBy: [{ startAt: "desc" }],
          include: { plan: true },
        })
      : [];

    const currentByVendor = new Map();
    for (const s of currentSubs) {
      if (!currentByVendor.has(s.vendorId)) currentByVendor.set(s.vendorId, s);
    }

    const items = vendors.map((v) => ({
      vendorId: v.id,
      displayName: v.displayName,
      vendorEmail: v.email,
      vendorPhone: v.phone,
      isActive: v.isActive,
      createdAt: v.createdAt,
      user: v.user,
      latestSubscription: v.subscriptions?.[0] || null,
      currentSubscription: currentByVendor.get(v.id) || null,
    }));

    res.json({ total, take, skip, items });
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
    if (!vendorId) return sendError(res, "missing_vendor_id", 400);

    const parsed = TrialBody.safeParse(req.body);
    if (!parsed.success)
      return sendError(res, "invalid_body", 400, { issues: parsed.error.issues });

    const { trialDays } = parsed.data;
    const now = new Date();

    const current = await prisma.vendorSubscription.findFirst({
      where: {
        vendorId,
        OR: [{ status: "active", endAt: { gt: now } }, { trialEndsAt: { gt: now } }],
      },
      orderBy: { startAt: "desc" },
    });

    const target =
      current ??
      (await prisma.vendorSubscription.findFirst({
        where: { vendorId },
        orderBy: { createdAt: "desc" },
      }));

    if (!target) return sendError(res, "subscription_not_found", 404);

    const trialStartsAt = trialDays > 0 ? now : null;
    const trialEndsAt =
      trialDays > 0 ? new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000) : null;

    const updated = await prisma.vendorSubscription.update({
      where: { id: target.id },
      data: {
        trialDays: trialDays > 0 ? trialDays : null,
        trialStartsAt,
        trialEndsAt,
      },
      include: { plan: true },
    });

    res.json({
      ok: true,
      subscription: updated,
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
    if (!vendorId) return sendError(res, "missing_vendor_id", 400);
    if (!process.env.STRIPE_SECRET_KEY) return sendError(res, "stripe_missing_key", 500);

    const sub = await prisma.vendorSubscription.findFirst({
      where: { vendorId, stripeSubscriptionId: { not: null } },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    });

    if (!sub) return sendError(res, "stripe_subscription_missing", 404);

    const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);

    const currentPeriodEnd = s.current_period_end ? new Date(s.current_period_end * 1000) : null;
    const trialStart = s.trial_start ? new Date(s.trial_start * 1000) : null;
    const trialEnd = s.trial_end ? new Date(s.trial_end * 1000) : null;

    const localStatus = mapStripeStatusToLocal(s.status, !!s.cancel_at_period_end);

    const updated = await prisma.vendorSubscription.update({
      where: { id: sub.id },
      data: {
        status: localStatus,
        endAt: currentPeriodEnd || sub.endAt,
        trialStartsAt: trialStart,
        trialEndsAt: trialEnd,
        stripeCustomerId: typeof s.customer === "string" ? s.customer : sub.stripeCustomerId,
        meta: {
          ...(sub.meta || {}),
          stripeStatus: s.status,
          cancelAtPeriodEnd: !!s.cancel_at_period_end,
          syncedAt: new Date().toISOString(),
        },
      },
      include: { plan: true },
    });

    res.json({ ok: true, subscription: updated });
  })
);

/**
 * POST /api/admin/vendors/:vendorId/subscription/stripe/cancel
 * cancel_at_period_end = true
 */
router.post(
  "/vendors/:vendorId/subscription/stripe/cancel",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const vendorId = String(req.params.vendorId || "");
    if (!vendorId) return sendError(res, "missing_vendor_id", 400);
    if (!process.env.STRIPE_SECRET_KEY) return sendError(res, "stripe_missing_key", 500);

    const sub = await prisma.vendorSubscription.findFirst({
      where: { vendorId, stripeSubscriptionId: { not: null } },
      orderBy: { createdAt: "desc" },
    });

    if (!sub) return sendError(res, "stripe_subscription_missing", 404);

    const s = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await prisma.vendorSubscription.update({
      where: { id: sub.id },
      data: {
        status: "canceled_at_period_end",
        meta: { ...(sub.meta || {}), cancelAtPeriodEnd: true, stripeStatus: s.status },
      },
    });

    res.json({ ok: true });
  })
);

/**
 * POST /api/admin/vendors/:vendorId/subscription/stripe/resume
 * cancel_at_period_end = false
 */
router.post(
  "/vendors/:vendorId/subscription/stripe/resume",
  authRequired,
  adminRequired,
  asyncHandler(async (req, res) => {
    const vendorId = String(req.params.vendorId || "");
    if (!vendorId) return sendError(res, "missing_vendor_id", 400);
    if (!process.env.STRIPE_SECRET_KEY) return sendError(res, "stripe_missing_key", 500);

    const sub = await prisma.vendorSubscription.findFirst({
      where: { vendorId, stripeSubscriptionId: { not: null } },
      orderBy: { createdAt: "desc" },
    });

    if (!sub) return sendError(res, "stripe_subscription_missing", 404);

    const s = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await prisma.vendorSubscription.update({
      where: { id: sub.id },
      data: {
        status: "active",
        meta: { ...(sub.meta || {}), cancelAtPeriodEnd: false, stripeStatus: s.status },
      },
    });

    res.json({ ok: true });
  })
);

export default router;
