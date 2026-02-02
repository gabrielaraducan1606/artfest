// backend/src/routes/subscriptionRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired /*, requireRole*/ } from "../api/auth.js";
import { z } from "zod";

/* orchestrator — alege automat Stripe/Netopia */
import { chooseRail, startPayment } from "../payments/orchestrator.js";

/* guard tolerant (evită 403 în onboarding) */
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";

const router = Router();

/* ============ APP origin (frontend) pentru redirecturi UI ============ */
const APP_ORIGIN =
  process.env.APP_ORIGIN ||
  process.env.FRONTEND_URL ||
  "http://localhost:5173"; // vite default; în prod setează domeniul tău FE

/* ============================== Utils =============================== */
const sendError = (res, code, status = 400, extra = {}) =>
  res.status(status).json({ ok: false, error: code, message: code, ...extra });

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/* ====================== Access guard (cu grace + trial) ===================== */
/**
 * ✅ Permite acces dacă:
 *  - user e ADMIN, sau
 *  - vendor are subscription activ (cu grace optional), sau
 *  - vendor are trial activ (trialEndsAt > now)
 */
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
        // ✅ active subs (cu grace)
        {
          status: "active",
          OR: [
            { endAt: { gt: now } },
            ...(graceDays > 0 ? [{ endAt: { gt: cutoff } }] : []),
          ],
        },
        // ✅ trial activ (indiferent de status, daca trialEndsAt e in viitor)
        { trialEndsAt: { gt: now } },
      ],
    },
    orderBy: [{ startAt: "desc" }],
    // ✅ IMPORTANT: includem entitlements pentru guard-urile de chat/attachments
    include: { plan: { select: { id: true, code: true, name: true, entitlements: true } } },
  });

  if (!sub)
    return sendError(res, "subscription_required", 402, {
      hint: "Ai nevoie de un abonament activ sau de un trial activ.",
    });

  req.subscription = sub;
  next();
});

/* ============================= Schemas ============================= */
const CheckoutQuery = z.object({
  plan: z.string().trim().min(1),
  period: z.enum(["month", "year"]).default("month"),
  // hints pentru orchestrator (opțional)
  applePay: z.string().optional(),
  googlePay: z.string().optional(),
});

/* ======================== GET /billing/plans ======================= */
router.get(
  "/billing/plans",
  asyncHandler(async (_req, res) => {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { priceCents: "asc" },
      // (opțional) explicităm ce întoarcem
      select: {
        code: true,
        name: true,
        priceCents: true,
        currency: true,
        interval: true,
        features: true,
        entitlements: true, // ✅
        popular: true,
        trialDays: true,
        maxProducts: true,
        commissionBps: true,
        isActive: true,
      },
    });
    res.json({ items: plans });
  })
);

/* =================== GET /vendors/me/subscription ================== */
/**
 * ✅ Returnează:
 *  - sub curent (active + endAt>now) SAU trial activ (trialEndsAt>now)
 *  - fallback: ultimul subscription (latest)
 */
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
          OR: [
            { status: "active", endAt: { gt: now } },
            { trialEndsAt: { gt: now } },
          ],
        },
        orderBy: [{ startAt: "desc" }],
        include: { plan: true }, // aici e ok să fie full plan (include entitlements)
      })) ??
      (await prisma.vendorSubscription.findFirst({
        where: { vendorId: meVendor.id },
        orderBy: [{ createdAt: "desc" }],
        include: { plan: true },
      }));

    res.json({ subscription: sub || null });
  })
);

/* ========== GET /vendors/me/subscription/status (pentru UI) ========= */
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
        OR: [
          { status: "active", endAt: { gt: now } },
          { trialEndsAt: { gt: now } },
        ],
      },
      // ✅ includem entitlements pentru UI
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
      plan: current.plan, // {code, name, entitlements}
      endAt: current.endAt ?? null,
      trialEndsAt: current.trialEndsAt ?? null,
      status: current.status,
    });
  })
);

/* ===================== Job opțional: expirare ===================== */
export async function expireSubscriptionsJob() {
  const now = new Date();
  await prisma.vendorSubscription.updateMany({
    where: {
      status: { in: ["active", "pending", "canceled_at_period_end"] },
      endAt: { lte: now },
      // ⚠️ dacă vrei să nu “expiri” ceva ce încă e în trial, decomentează:
      // OR: [{ trialEndsAt: null }, { trialEndsAt: { lte: now } }],
    },
    data: { status: "expired" },
  });
}

/* =================== POST /billing/checkout =================== */
router.post(
  "/billing/checkout",
  authRequired,
  vendorAccessRequired,
  asyncHandler(async (req, res) => {
    // tu trimiți parametrii în query string, deci citim din req.query
    const q = CheckoutQuery.parse(req.query);

    const vendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));

    if (!vendor) return sendError(res, "vendor_profile_missing", 404);

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { code: q.plan },
    });

    if (!plan) return sendError(res, "plan_not_found", 404);
    if (plan.isActive === false) return sendError(res, "plan_inactive", 409);

    // ✅ dacă planul e gratuit: activează direct
    if ((plan.priceCents ?? 0) === 0) {
      const now = new Date();

      // important: guard-urile tale cer status=active și endAt>now (sau trialEndsAt>now)
      // pentru plan gratuit, pune un endAt în viitor (ex: 10 ani)
      const endAt = new Date(now);
      endAt.setFullYear(endAt.getFullYear() + 10);

      const sub = await prisma.vendorSubscription.create({
        data: {
          vendorId: vendor.id,
          planId: plan.id,
          status: "active",
          startAt: now,
          endAt,
          // opțional: meta
          meta: { activatedBy: "free_plan" },
        },
        include: { plan: { select: { code: true, name: true, entitlements: true } } },
      });

      return res.json({
        ok: true,
        kind: "free_activated",
        subscription: sub,
        // trimite un URL de UI (poți ajusta)
        url: "/onboarding/details?tab=plata&activated=1",
      });
    }

    // ✅ altfel (plan plătit): mergi pe orchestrator
    const { applePay, googlePay } = q;
    const rail = chooseRail({ applePay, googlePay, plan, period: q.period });

    const out = await startPayment({
      rail,
      vendorId: vendor.id,
      userId: req.user.sub,
      planCode: plan.code,
      period: q.period,
      appOrigin: APP_ORIGIN,
    });

    return res.json(out);
  })
);

export default router;
