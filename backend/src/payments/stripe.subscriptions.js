// src/payments/stripe.subscriptions.js
import { stripe } from "../lib/stripe.js";
import { prisma } from "../db.js";

const APP_ORIGIN =
  process.env.APP_ORIGIN ||
  process.env.FRONTEND_URL ||
  "http://localhost:5173";

const TRIAL_DEFAULT_DAYS = Number(process.env.TRIAL_DEFAULT_DAYS || 30);

function getPriceId(plan, period) {
  if (period === "year") return plan.stripePriceYearId;
  return plan.stripePriceMonthId;
}

function makeError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function ensureCustomerForVendor({ vendorId, email }) {
  const lastWithCustomer = await prisma.vendorSubscription.findFirst({
    where: {
      vendorId,
      stripeCustomerId: { not: null },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  if (lastWithCustomer?.stripeCustomerId) {
    return lastWithCustomer.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: email || undefined,
    metadata: {
      vendorId,
    },
  });

  return customer.id;
}

function getTrialDays(plan) {
  if (typeof plan.trialDays === "number" && plan.trialDays > 0) {
    return plan.trialDays;
  }

  if (Number.isFinite(TRIAL_DEFAULT_DAYS) && TRIAL_DEFAULT_DAYS > 0) {
    return TRIAL_DEFAULT_DAYS;
  }

  return null;
}

async function vendorHadTrial(vendorId) {
  const existing = await prisma.vendorSubscription.findFirst({
    where: {
      vendorId,
      OR: [
        { trialEndsAt: { not: null } },
        { trialDays: { gt: 0 } },
        {
          meta: {
            path: ["trialDays"],
            not: null,
          },
        },
      ],
    },
    select: { id: true },
  });

  return !!existing;
}

export async function createSubscriptionCheckoutSession({
  vendorId,
  userId,
  planCode,
  period = "month",
}) {
  const plan = await prisma.subscriptionPlan.findUnique({
    where: {
      code: planCode,
    },
  });

  if (!plan) {
    throw makeError("plan_not_found", 404);
  }

  if (plan.isActive === false) {
    throw makeError("plan_inactive", 409);
  }

  const amount = plan.priceCents ?? 0;

  if (amount === 0) {
    throw makeError("free_plan", 400);
  }

  const priceId = getPriceId(plan, period);

  if (!priceId) {
    throw makeError("stripe_price_missing", 409);
  }

  const vendor = await prisma.vendor.findUnique({
    where: {
      id: vendorId,
    },
    include: {
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!vendor) {
    throw makeError("vendor_not_found", 404);
  }

  const customerId = await ensureCustomerForVendor({
    vendorId,
    email: vendor.email || vendor.user?.email,
  });

  const now = new Date();

  const hadTrial = await vendorHadTrial(vendorId);
  const trialDays = hadTrial ? null : getTrialDays(plan);

  await prisma.vendorSubscription.updateMany({
    where: {
      vendorId,
      status: "pending",
    },
    data: {
      status: "expired",
      endAt: now,
    },
  });

  const pending = await prisma.vendorSubscription.create({
    data: {
      vendorId,
      planId: plan.id,
      status: "pending",
      startAt: now,
      endAt: new Date(Date.now() + 30 * 60 * 1000),
      trialDays,
      meta: {
        createdBy: "stripe_checkout",
        planCode,
        period,
        trialDays,
        hadTrial,
      },
      stripeCustomerId: customerId,
    },
  });

  const successUrl = `${APP_ORIGIN}/setari?tab=subscription&subscription=success&session_id={CHECKOUT_SESSION_ID}`;
const cancelUrl = `${APP_ORIGIN}/setari?tab=subscription&subscription=cancelled`;

  const metadata = {
    vendorId,
    userId,
    planCode,
    period,
    pendingVendorSubscriptionId: pending.id,
  };

  const subscriptionData = {
    metadata,
  };

  if (trialDays) {
    subscriptionData.trial_period_days = trialDays;
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,

    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],

    payment_method_types: ["card"],
    payment_method_collection: "always",

    allow_promotion_codes: false,

    subscription_data: subscriptionData,

    metadata,

    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  await prisma.vendorSubscription.update({
    where: {
      id: pending.id,
    },
    data: {
      stripeCheckoutSessionId: session.id,
      meta: {
        ...(pending.meta || {}),
        stripeCheckoutSessionId: session.id,
        stripeCustomerId: customerId,
        stripeSessionMode: "subscription",
        stripePaymentMethodCollection: "always",
      },
    },
  });

  return {
    url: session.url,
    sessionId: session.id,
  };
}