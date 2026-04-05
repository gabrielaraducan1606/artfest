// backend/src/scripts/syncStripePlans.js
import "dotenv/config";
import { prisma } from "../db.js";
import { stripe } from "../lib/stripe.js";

// 2 luni discount pe an (ca în FE-ul tău)
const YEAR_DISCOUNT = 2 / 12;

function assertEnv() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");
}

async function ensureProduct(plan) {
  if (plan.stripeProductId) {
    await stripe.products.update(plan.stripeProductId, { name: plan.name });
    return plan.stripeProductId;
  }

  const product = await stripe.products.create({
    name: plan.name,
    metadata: { planCode: plan.code },
  });

  await prisma.subscriptionPlan.update({
    where: { id: plan.id },
    data: { stripeProductId: product.id },
  });

  return product.id;
}

async function ensurePrice(plan, productId, interval) {
  const currency = (plan.currency || "RON").toLowerCase();

  let unitAmount = Number(plan.priceCents || 0);

  if (interval === "year") {
    unitAmount = Math.round(unitAmount * 12 * (1 - YEAR_DISCOUNT));
  }

  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });

  const existing = prices.data.find((p) => {
    return (
      p.type === "recurring" &&
      p.currency === currency &&
      p.unit_amount === unitAmount &&
      p.recurring?.interval === interval
    );
  });

  if (existing) return existing.id;

  const created = await stripe.prices.create({
    product: productId,
    currency,
    unit_amount: unitAmount,
    recurring: { interval },
    metadata: { planCode: plan.code, period: interval },
  });

  return created.id;
}

async function main() {
  assertEnv();

  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { priceCents: "asc" },
  });

  for (const plan of plans) {
    if ((plan.priceCents ?? 0) === 0) {
      console.log(`ℹ️ ${plan.code} is free => skipping Stripe prices`);
      continue;
    }

    const productId = await ensureProduct(plan);
    const monthId = await ensurePrice(plan, productId, "month");
    const yearId = await ensurePrice(plan, productId, "year");

    await prisma.subscriptionPlan.update({
      where: { id: plan.id },
      data: {
        stripeProductId: productId,
        stripePriceMonthId: monthId,
        stripePriceYearId: yearId,
      },
    });

    console.log(`✅ ${plan.code}: product=${productId} month=${monthId} year=${yearId}`);
  }

  console.log("DONE.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
