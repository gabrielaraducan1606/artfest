import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, requireRole } from "../api/auth.js";

const router = Router();

// GET /api/billing/plans – planuri active pentru UI
router.get("/billing/plans", async (_req, res) => {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { priceCents: "asc" },
  });
  res.json({ items: plans });
});

// GET /api/vendors/me/subscription – abonamentul curent (simplu)
router.get(
  "/vendors/me/subscription",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!vendor) return res.status(404).json({ error: "vendor_profile_missing" });

    const sub = await prisma.vendorSubscription.findFirst({
      where: { vendorId: vendor.id, status: "active" },
      orderBy: { startAt: "desc" },
      include: { plan: true },
    });

    res.json({ subscription: sub || null });
  }
);

// POST /api/billing/checkout?plan=basic|pro|business – minim viabil
// Înlocuiește logica "fake redirect" cu Stripe/Netopia când ești gata.
router.post(
  "/billing/checkout",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (!vendor) return res.status(404).json({ error: "vendor_profile_missing" });

    const code = String(req.query.plan || req.body?.plan || "").trim();
    if (!code) return res.status(400).json({ error: "missing_plan_code" });

    const plan = await prisma.subscriptionPlan.findUnique({ where: { code } });
    if (!plan || !plan.isActive) return res.status(404).json({ error: "plan_not_found" });

    // dezactivăm abonamentele active anterioare (simplu)
    await prisma.vendorSubscription.updateMany({
      where: { vendorId: vendor.id, status: "active" },
      data: { status: "canceled", endAt: new Date() },
    });

    // calcul endAt în funcție de interval (month/year)
    const start = new Date();
    const end = new Date(start);
    if (plan.interval === "year") end.setFullYear(end.getFullYear() + 1);
    else end.setMonth(end.getMonth() + 1);

    const sub = await prisma.vendorSubscription.create({
      data: {
        vendorId: vendor.id,
        planId: plan.id,
        status: "active",          // NOTE: când integrezi gateway-ul, setezi după webhook
        startAt: start,
        endAt: end,
        extRef: null,              // ex: stripe subscription id, când integrezi
        meta: null,
      },
    });

    // „Fake checkout”: UI așteaptă un URL pentru redirect
    // Deocamdată îl trimitem către o pagină de confirmare (o poți crea în frontend).
    return res.json({ url: `/thank-you?subscriptionId=${sub.id}` });
  }
);

export default router;
