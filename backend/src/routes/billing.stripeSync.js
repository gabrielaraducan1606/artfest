// src/routes/billing.stripeSync.js
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { stripe } from "../lib/stripe.js";
import { authRequired } from "../api/auth.js"; // adaptează importul dacă la tine e alt path

const router = Router();

/**
 * ⚠️ Recomandat: protejează ruta cu ADMIN-only.
 * Eu pun doar authRequired ca exemplu.
 */
router.post("/billing/stripe/sync", authRequired, async (req, res) => {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true, priceCents: { gt: 0 } },
    orderBy: { priceCents: "asc" },
  });

  const out = [];

  for (const p of plans) {
    // 1) Product
    let productId = p.stripeProductId;
    if (!productId) {
      const product = await stripe.products.create({
        name: p.name,
        metadata: { planCode: p.code },
      });
      productId = product.id;
    } else {
      await stripe.products.update(productId, {
        name: p.name,
        metadata: { planCode: p.code },
      }).catch(() => {});
    }

    // 2) Monthly Price (dacă nu există)
    let monthPriceId = p.stripePriceMonthId;
    if (!monthPriceId) {
      const price = await stripe.prices.create({
        product: productId,
        currency: (p.currency || "RON").toLowerCase(),
        unit_amount: p.priceCents,
        recurring: { interval: "month" },
        metadata: { planCode: p.code, period: "month" },
      });
      monthPriceId = price.id;
    }

    // 3) Yearly Price (dacă nu există) – tu în UI ai discount, aici îl aplici la nivel de price
    let yearPriceId = p.stripePriceYearId;
    if (!yearPriceId) {
      // exemplu: 2 luni gratis => 10/12 din total
      const yearlyAmount = Math.round(p.priceCents * 12 * (10 / 12));
      const price = await stripe.prices.create({
        product: productId,
        currency: (p.currency || "RON").toLowerCase(),
        unit_amount: yearlyAmount,
        recurring: { interval: "year" },
        metadata: { planCode: p.code, period: "year" },
      });
      yearPriceId = price.id;
    }

    await prisma.subscriptionPlan.update({
      where: { id: p.id },
      data: {
        stripeProductId: productId,
        stripePriceMonthId: monthPriceId,
        stripePriceYearId: yearPriceId,
      },
    });

    out.push({
      plan: p.code,
      productId,
      monthPriceId,
      yearPriceId,
    });
  }

  res.json({ ok: true, updated: out.length, items: out });
});

export default router;
