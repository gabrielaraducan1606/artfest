// src/payments/stripeSubscriptions.js
import { stripe } from "../lib/stripe.js";
import { prisma } from "../db.js";

const APP_ORIGIN = process.env.APP_ORIGIN || process.env.FRONTEND_URL || "http://localhost:5173";

/**
 * Returnează priceId în funcție de period.
 */
function getPriceId(plan, period) {
  if (period === "year") return plan.stripePriceYearId;
  return plan.stripePriceMonthId;
}

/**
 * Creează un Stripe Customer dacă nu există încă pentru vendor-ul curent
 * (salvat în VendorSubscription.stripeCustomerId pentru vendor).
 */
async function ensureCustomerForVendor({ vendorId, email }) {
  // luăm ultimul subscription care are customerId
  const lastWithCustomer = await prisma.vendorSubscription.findFirst({
    where: { vendorId, stripeCustomerId: { not: null } },
    orderBy: { createdAt: "desc" },
  });

  if (lastWithCustomer?.stripeCustomerId) return lastWithCustomer.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: { vendorId },
  });

  return customer.id;
}

/**
 * Create Stripe Checkout Session (subscription)
 */
export async function createSubscriptionCheckoutSession({
  vendorId,
  userId,
  planCode,
  period = "month",
}) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { code: planCode } });
  if (!plan) {
    const err = new Error("plan_not_found");
    err.status = 404;
    throw err;
  }
  if (plan.isActive === false) {
    const err = new Error("plan_inactive");
    err.status = 409;
    throw err;
  }

  const amount = plan.priceCents ?? 0;
  if (amount === 0) {
    // plan gratuit îl tratezi separat în route (deja faci)
    const err = new Error("free_plan");
    err.status = 400;
    throw err;
  }

  const priceId = getPriceId(plan, period);
  if (!priceId) {
    const err = new Error("stripe_price_missing");
    err.status = 409;
    throw err;
  }

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) {
    const err = new Error("vendor_not_found");
    err.status = 404;
    throw err;
  }

  const customerId = await ensureCustomerForVendor({ vendorId, email: vendor.email });

  // (opțional) creezi un row pending înainte de redirect (bun pentru tracking)
  const pending = await prisma.vendorSubscription.create({
    data: {
      vendorId,
      planId: plan.id,
      status: "pending",
      startAt: new Date(),
      endAt: new Date(Date.now() + 5 * 60 * 1000), // placeholder 5 min
      trialDays: plan.trialDays ?? null,
      meta: {
        createdBy: "stripe_checkout",
        planCode,
        period,
      },
      stripeCustomerId: customerId,
    },
  });

  const successUrl = `${APP_ORIGIN}/onboarding/details?tab=plata&success=1&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${APP_ORIGIN}/onboarding/details?tab=plata&canceled=1`;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: false,

    // important: setări subscription
    subscription_data: {
      // trial din plan
      ...(plan.trialDays ? { trial_period_days: plan.trialDays } : {}),
      metadata: {
        vendorId,
        userId,
        planCode,
        period,
        pendingVendorSubscriptionId: pending.id,
      },
    },

    metadata: {
      vendorId,
      userId,
      planCode,
      period,
      pendingVendorSubscriptionId: pending.id,
    },

    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  await prisma.vendorSubscription.update({
    where: { id: pending.id },
    data: {
      stripeCheckoutSessionId: session.id,
      meta: {
        ...(pending.meta || {}),
        stripeCheckoutSessionId: session.id,
      },
    },
  });

  return { url: session.url, sessionId: session.id };
}
