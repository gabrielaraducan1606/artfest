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

/* ====================== Access guard (cu grace) ===================== */
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
      status: "active",
      OR: [
        { endAt: { gt: now } },
        ...(graceDays > 0 ? [{ endAt: { gt: cutoff } }] : []),
      ],
    },
    orderBy: { startAt: "desc" },
    include: { plan: { select: { id: true, code: true, name: true } } },
  });

  if (!sub)
    return sendError(res, "subscription_required", 402, {
      hint: "Ai nevoie de un abonament activ.",
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
    });
    res.json({ items: plans });
  })
);

/* =================== GET /vendors/me/subscription ================== */
router.get(
  "/vendors/me/subscription",
  authRequired,
  vendorAccessRequired,
  asyncHandler(async (req, res) => {
    const meVendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
    if (!meVendor) return sendError(res, "vendor_profile_missing", 404);

    const sub = await prisma.vendorSubscription.findFirst({
      where: { vendorId: meVendor.id, status: "active", endAt: { gt: new Date() } },
      orderBy: { startAt: "desc" },
      include: { plan: true },
    });

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
    const sub = await prisma.vendorSubscription.findFirst({
      where: { vendorId: meVendor.id, status: "active", endAt: { gt: now } },
      include: { plan: true },
      orderBy: { startAt: "desc" },
    });

    if (!sub)
      return res.json({
        ok: false,
        code: "subscription_required",
        upgradeUrl: "/app/billing",
      });

    res.json({
      ok: true,
      plan: { code: sub.plan.code, name: sub.plan.name },
      endAt: sub.endAt,
    });
  })
);

/* ===================== POST /billing/checkout ====================== */
/* - gratuit: activează instant                                        */
/* - plătit: creează subs pending + REDIRECT prin orchestrator         */
router.post(
  "/billing/checkout",
  authRequired,
  vendorAccessRequired,
  asyncHandler(async (req, res) => {
    const meVendor =
      req.meVendor ??
      (await prisma.vendor.findUnique({ where: { userId: req.user.sub } }));
    if (!meVendor) return sendError(res, "vendor_profile_missing", 404);

    const parsed = CheckoutQuery.safeParse({
      plan: String(req.query.plan ?? req.body?.plan ?? ""),
      period: String(req.query.period ?? req.body?.period ?? "month"),
      applePay: String(req.query.applePay ?? req.body?.applePay ?? ""),
      googlePay: String(req.query.googlePay ?? req.body?.googlePay ?? ""),
    });
    if (!parsed.success)
      return sendError(res, "invalid_checkout_params", 400, {
        issues: parsed.error.issues,
      });

    const { plan: code, period, applePay, googlePay } = parsed.data;
    const plan = await prisma.subscriptionPlan.findUnique({ where: { code } });
    if (!plan || !plan.isActive) return sendError(res, "plan_not_found", 404);

    // === FREE plan => activare imediată
    const isFree = (plan.priceCents ?? 0) === 0;
    if (isFree) {
      const sub = await prisma.$transaction(async (tx) => {
        const now = new Date();

        const active = await tx.vendorSubscription.findFirst({
          where: { vendorId: meVendor.id, status: "active", endAt: { gt: now } },
          orderBy: { endAt: "desc" },
        });
        if (active) {
          await tx.vendorSubscription.update({
            where: { id: active.id },
            data: { status: "canceled_at_period_end" },
          });
        }

        const startAt = now;
        const endAt = new Date(startAt);
        period === "year"
          ? endAt.setFullYear(endAt.getFullYear() + 1)
          : endAt.setMonth(endAt.getMonth() + 1);

        return tx.vendorSubscription.create({
          data: {
            vendorId: meVendor.id,
            planId: plan.id,
            status: "active",
            startAt,
            endAt,
            meta: { interval: period, activation: "free" },
          },
        });
      });

      return res.json({
        kind: "free_activated",
        url: `${APP_ORIGIN}/thank-you?subscriptionId=${sub.id}`,
      });
    }

    // === PAID plan => subs pending + rail automat
    const today = new Date().toISOString().slice(0, 10);
    const idemKey = `chk_${meVendor.id}_${code}_${period}_${today}`;

    const sub = await prisma.$transaction(async (tx) => {
      const existing = await tx.vendorSubscription.findFirst({
        where: { vendorId: meVendor.id, extRef: idemKey },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return existing;

      const now = new Date();
      const active = await tx.vendorSubscription.findFirst({
        where: { vendorId: meVendor.id, status: "active", endAt: { gt: now } },
        orderBy: { endAt: "desc" },
      });

      let startAt = now;
      if (active) {
        const samePlan =
          active.planId === plan.id &&
          (active.meta?.interval ?? "month") === period;
        if (samePlan) startAt = new Date(active.endAt);
        else {
          await tx.vendorSubscription.update({
            where: { id: active.id },
            data: { status: "canceled_at_period_end" },
          });
        }
      }

      const endAt = new Date(startAt);
      period === "year"
        ? endAt.setFullYear(endAt.getFullYear() + 1)
        : endAt.setMonth(endAt.getMonth() + 1);

      return tx.vendorSubscription.create({
        data: {
          vendorId: meVendor.id,
          planId: plan.id,
          status: "pending",
          startAt,
          endAt,
          extRef: idemKey,
          meta: { interval: period },
        },
      });
    });

    // sumă (dacă ai alte reguli, ajustează aici)
    const baseRON = plan.priceCents / 100;
    const amountRON =
      period === "year"
        ? Math.round(baseRON * 12 * (1 - 0.2) * 100) / 100 // exemplu reducere 20%
        : baseRON;
    const description = `Abonament ${plan.name} (${period})`;

    // semnale pentru orchestrator
    const userCountry =
      req.user?.country || req.headers["x-geo-country"] || "RO";
    const currency = plan.currency || "RON";
    const vendorPrefs = {
      prefer: meVendor?.meta?.paymentsPreference || null,
    };
    const walletHints = {
      applePay: applePay === "1",
      googlePay: googlePay === "1",
    };

    const rail = await chooseRail({
      userCountry,
      currency,
      vendorPrefs,
      walletHints,
    });
    const { url, provider } = await startPayment({
      rail,
      plan,
      period,
      vendor: meVendor,
      user: req.user,
      subscription: sub,
      amountRON,
      description,
    });

    return res.json({
      kind: "provider_redirect",
      provider,
      url,
      subscriptionId: sub.id,
    });
  })
);

/* ====== GET /billing/checkout/netopia/start — (fallback / demo) ====== */
router.get(
  "/billing/checkout/netopia/start",
  asyncHandler(async (req, res) => {
    const subId = String(req.query.subId || "");
    if (!subId) return sendError(res, "missing_sub_id", 400);

    // în integrarea reală, generezi redirecția către Netopia aici.
    res.redirect(
      302,
      `${APP_ORIGIN}/payment/redirecting?subscriptionId=${encodeURIComponent(
        subId
      )}`
    );
  })
);

/* === POST /billing/checkout/netopia/form — POST auto-submit (opțional) === */
router.post(
  "/billing/checkout/netopia/form",
  asyncHandler(async (req, res) => {
    const { subId } = req.body || {};
    if (!subId) return sendError(res, "missing_sub_id", 400);

    const actionUrl = "https://secure.mobilpay.ro"; // placeholder
    const fields = {
      amount: "0.00",
      currency: "RON",
      orderId: subId,
      signature: "SIGN_HERE",
    };

    const inputs = Object.entries(fields)
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${String(v)}" />`)
      .join("");

    const html = `<!doctype html>
<html><body onload="document.forms[0].submit()">
  <form action="${actionUrl}" method="POST">
    ${inputs}
    <noscript><button type="submit">Continuă plata</button></noscript>
  </form>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  })
);

/* =================== Webhook provider (schelet generic) =================== */
router.post(
  "/billing/webhooks/provider",
  asyncHandler(async (req, res) => {
    const payload = req.body; // dacă providerul cere RAW, setează raw pe ruta asta în server
    switch (payload?.type) {
      case "invoice.paid":
      case "subscription.activated": {
        const subscriptionId =
          payload?.data?.subscriptionId || payload?.data?.localId;
        if (subscriptionId) {
          await prisma.vendorSubscription.updateMany({
            where: { id: subscriptionId },
            data: { status: "active" },
          });
        }
        break;
      }
      case "invoice.payment_failed":
      case "subscription.canceled": {
        const subscriptionId =
          payload?.data?.subscriptionId || payload?.data?.localId;
        if (subscriptionId) {
          await prisma.vendorSubscription.updateMany({
            where: { id: subscriptionId },
            data: { status: "canceled" },
          });
        }
        break;
      }
      default:
        break;
    }
    res.json({ ok: true });
  })
);

/* ===================== Job opțional: expirare ===================== */
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

export default router;
