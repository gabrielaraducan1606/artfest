// src/routes/stripeWebhookRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { stripe } from "../lib/stripe.js";
import {
  computeOrderSplits,
  allocateStripeFee,
  computeVendorPayouts,
} from "../payments/marketplaceCalc.js";

const router = Router();

function stripeTsToDate(value, fallback = new Date()) {
  return value ? new Date(value * 1000) : fallback;
}

function mergeMeta(oldMeta, nextMeta) {
  return {
    ...(oldMeta && typeof oldMeta === "object" ? oldMeta : {}),
    ...nextMeta,
  };
}

function mapStripeSubscriptionStatus(stripeStatus) {
  if (stripeStatus === "trialing") return "active";
  if (stripeStatus === "active") return "active";
  if (stripeStatus === "past_due") return "past_due";
  if (stripeStatus === "unpaid") return "unpaid";
  if (stripeStatus === "canceled") return "canceled";
  if (stripeStatus === "incomplete") return "pending";
  if (stripeStatus === "incomplete_expired") return "expired";
  return "active";
}

function isVendorCommissionInvoicePayment(obj) {
  return (
    obj?.metadata?.purpose === "vendor_commission_invoice" ||
    obj?.metadata?.type === "VENDOR_COMMISSION_INVOICE"
  );
}

function computeConnectStatus(acct) {
  if (acct.payouts_enabled) return "enabled";
  if (acct.requirements?.disabled_reason) return "restricted";
  if (acct.details_submitted || acct.id) return "pending";
  return "not_started";
}

function getRequirementsDue(acct) {
  return [
    ...(acct.requirements?.currently_due || []),
    ...(acct.requirements?.past_due || []),
  ];
}

async function retrieveStripeSubscription(stripeSubscriptionId) {
  return stripe.subscriptions.retrieve(stripeSubscriptionId, {
    expand: ["latest_invoice", "default_payment_method"],
  });
}

async function updateSubscriptionMeta(where, data, metaPatch) {
  const existing = await prisma.vendorSubscription.findFirst({
    where,
    select: { id: true, meta: true },
  });

  if (!existing) return;

  await prisma.vendorSubscription.update({
    where: { id: existing.id },
    data: {
      ...data,
      meta: mergeMeta(existing.meta, metaPatch),
    },
  });
}

async function syncStripeSubscription(stripeSub, extraMeta = {}) {
  const stripeSubscriptionId = String(stripeSub.id || "");
  if (!stripeSubscriptionId) return;

  await updateSubscriptionMeta(
    { stripeSubscriptionId },
    {
      status: mapStripeSubscriptionStatus(stripeSub.status),
      endAt: stripeSub.current_period_end
        ? stripeTsToDate(stripeSub.current_period_end)
        : undefined,
      trialStartsAt: stripeSub.trial_start ? stripeTsToDate(stripeSub.trial_start) : null,
      trialEndsAt: stripeSub.trial_end ? stripeTsToDate(stripeSub.trial_end) : null,
    },
    {
      stripeStatus: stripeSub.status,
      cancelAtPeriodEnd: !!stripeSub.cancel_at_period_end,
      canceledAt: stripeSub.canceled_at
        ? stripeTsToDate(stripeSub.canceled_at).toISOString()
        : null,
      currentPeriodStart: stripeSub.current_period_start
        ? stripeTsToDate(stripeSub.current_period_start).toISOString()
        : null,
      currentPeriodEnd: stripeSub.current_period_end
        ? stripeTsToDate(stripeSub.current_period_end).toISOString()
        : null,
      trialStartsAt: stripeSub.trial_start
        ? stripeTsToDate(stripeSub.trial_start).toISOString()
        : null,
      trialEndsAt: stripeSub.trial_end
        ? stripeTsToDate(stripeSub.trial_end).toISOString()
        : null,
      ...extraMeta,
    }
  );
}

async function persistConnectAccountStatus(acct) {
  if (!acct?.id) return;

  const vendors = await prisma.vendor.findMany({
    where: { stripeAccountId: acct.id },
    select: { id: true, stripeOnboardedAt: true },
  });

  for (const vendor of vendors) {
    await prisma.vendor.update({
      where: { id: vendor.id },
      data: {
        stripeChargesEnabled: !!acct.charges_enabled,
        stripePayoutsEnabled: !!acct.payouts_enabled,
        stripeDetailsSubmitted: !!acct.details_submitted,
        stripeConnectStatus: computeConnectStatus(acct),
        stripeRequirementsDue: getRequirementsDue(acct),
        stripeDisabledReason: acct.requirements?.disabled_reason || null,
        stripeOnboardedAt: acct.details_submitted
          ? vendor.stripeOnboardedAt || new Date()
          : vendor.stripeOnboardedAt,
      },
    });
  }
}

async function handleConnectAccountDeauthorized(acct) {
  if (!acct?.id) return;

  await prisma.vendor.updateMany({
    where: { stripeAccountId: acct.id },
    data: {
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false,
      stripeConnectStatus: "restricted",
      stripeDisabledReason: "account.application.deauthorized",
    },
  });
}

async function getPaymentIntentChargeAndFee(pi) {
  let paymentIntent = pi;

  if (!paymentIntent?.charges?.data && pi?.id) {
    paymentIntent = await stripe.paymentIntents.retrieve(pi.id, {
      expand: ["latest_charge.balance_transaction", "charges.data.balance_transaction"],
    });
  }

  const charge =
    paymentIntent?.charges?.data?.[0] ||
    (typeof paymentIntent?.latest_charge === "object"
      ? paymentIntent.latest_charge
      : null);

  const chargeId = charge?.id || null;
  let feeNet = 0;

  const balanceTransaction =
    typeof charge?.balance_transaction === "object"
      ? charge.balance_transaction
      : null;

  if (balanceTransaction?.fee != null) {
    feeNet = Math.abs(Number(balanceTransaction.fee || 0) / 100);
  } else if (charge?.balance_transaction) {
    const bt = await stripe.balanceTransactions.retrieve(String(charge.balance_transaction));
    feeNet = Math.abs(Number(bt.fee || 0) / 100);
  }

  return { paymentIntent, charge, chargeId, feeNet };
}

async function handleSubscriptionCheckoutCompleted(session) {
  const vendorId = session?.metadata?.vendorId;
  const planCode = session?.metadata?.planCode;
  const period = session?.metadata?.period || "month";
  const pendingId = session?.metadata?.pendingVendorSubscriptionId || null;
  const stripeSubscriptionId = String(session.subscription || "");
  const stripeCustomerId = String(session.customer || "");

  if (!vendorId) throw new Error("missing_vendorId_metadata");
  if (!planCode) throw new Error("missing_planCode_metadata");
  if (!stripeSubscriptionId) throw new Error("missing_stripe_subscription_id");

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { code: planCode },
  });

  if (!plan) throw new Error("subscription_plan_not_found");

  const stripeSub = await retrieveStripeSubscription(stripeSubscriptionId);

  const startAt = stripeTsToDate(
    stripeSub.start_date || stripeSub.current_period_start,
    new Date()
  );

  const trialStartsAt = stripeSub.trial_start ? stripeTsToDate(stripeSub.trial_start) : null;
  const trialEndsAt = stripeSub.trial_end ? stripeTsToDate(stripeSub.trial_end) : null;

  const endAt = stripeTsToDate(
    stripeSub.current_period_end || stripeSub.trial_end,
    trialEndsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  );

  const status = mapStripeSubscriptionStatus(stripeSub.status);

  await prisma.vendorSubscription.updateMany({
    where: {
      vendorId,
      status: { in: ["active", "pending", "past_due", "unpaid"] },
      ...(pendingId ? { id: { not: pendingId } } : {}),
    },
    data: {
      status: "canceled",
      endAt: new Date(),
    },
  });

  const existingPending = pendingId
    ? await prisma.vendorSubscription.findUnique({
        where: { id: pendingId },
      })
    : null;

  const data = {
    vendorId,
    planId: plan.id,
    status,
    startAt,
    endAt,
    trialDays: existingPending?.trialDays ?? plan.trialDays ?? null,
    trialStartsAt,
    trialEndsAt,
    stripeCustomerId,
    stripeSubscriptionId,
    stripeCheckoutSessionId: String(session.id),
    meta: mergeMeta(existingPending?.meta, {
      activatedBy: "stripe_checkout_completed",
      planCode,
      period,
      stripeStatus: stripeSub.status,
      checkoutPaymentStatus: session.payment_status || null,
      checkoutStatus: session.status || null,
      stripeCheckoutSessionId: String(session.id),
      stripeSubscriptionId,
      stripeCustomerId,
      cancelAtPeriodEnd: !!stripeSub.cancel_at_period_end,
      trialStartsAt: trialStartsAt?.toISOString?.() || null,
      trialEndsAt: trialEndsAt?.toISOString?.() || null,
      currentPeriodStart: stripeSub.current_period_start
        ? stripeTsToDate(stripeSub.current_period_start).toISOString()
        : null,
      currentPeriodEnd: stripeSub.current_period_end
        ? stripeTsToDate(stripeSub.current_period_end).toISOString()
        : null,
    }),
  };

  if (pendingId) {
    await prisma.vendorSubscription.update({
      where: { id: pendingId },
      data,
    });
  } else {
    await prisma.vendorSubscription.create({ data });
  }
}

async function handleCheckoutSessionExpired(session) {
  const pendingId = session?.metadata?.pendingVendorSubscriptionId;

  if (!pendingId) return;

  await updateSubscriptionMeta(
    { id: pendingId, status: "pending" },
    {
      status: "expired",
      endAt: new Date(),
    },
    {
      checkoutExpiredAt: new Date().toISOString(),
      stripeCheckoutSessionId: String(session.id),
      checkoutStatus: session.status || "expired",
    }
  );
}

async function handleOrderCheckoutCompleted(session) {
  const orderId = session?.metadata?.orderId;
  if (!orderId) throw new Error("missing_orderId_metadata");

  if (session.payment_intent) {
    await prisma.order.update({
      where: { id: orderId },
      data: { stripePaymentIntentId: String(session.payment_intent) },
    });
  }
}

async function handleCommissionInvoiceCheckoutCompleted(session) {
  const invoiceId = session?.metadata?.invoiceId;
  const vendorId = session?.metadata?.vendorId;
  const piId = session?.payment_intent ? String(session.payment_intent) : null;

  if (!invoiceId) throw new Error("missing_invoiceId_metadata");

  const existing = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      ...(vendorId ? { vendorId } : {}),
      direction: "PLATFORM_TO_VENDOR",
    },
    select: { meta: true },
  });

  await prisma.invoice.updateMany({
    where: {
      id: invoiceId,
      ...(vendorId ? { vendorId } : {}),
      direction: "PLATFORM_TO_VENDOR",
      status: { not: "PAID" },
    },
    data: {
      externalId: piId,
      stripeCheckoutSessionId: String(session.id),
      stripePaymentIntentId: piId,
      stripePaymentStatus: session.payment_status || "checkout_completed",
      meta: mergeMeta(existing?.meta, {
        stripeCheckoutSessionId: String(session.id),
        stripePaymentIntentId: piId,
        stripeCustomerId: session.customer ? String(session.customer) : null,
        stripePaymentStatus: session.payment_status || null,
        stripeCheckoutStatus: session.status || null,
        purpose: "vendor_commission_invoice",
      }),
    },
  });
}

async function handleOrderPaymentIntentSucceeded(pi) {
  const orderId = pi?.metadata?.orderId;
  if (!orderId) throw new Error("missing_orderId_metadata");

  const { chargeId, feeNet } = await getPaymentIntentChargeAndFee(pi);

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("order_not_found");

  if (order.status !== "PAID") {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "PAID",
        paidAt: new Date(),
        stripeChargeId: chargeId ? String(chargeId) : null,
      },
    });
  }

  const splits = await computeOrderSplits({ orderId });
  const vendorsWithFee = allocateStripeFee({
    vendors: splits.vendors,
    feeNet,
  });
  const payouts = computeVendorPayouts({ vendors: vendorsWithFee });

  const vendors = await prisma.vendor.findMany({
    where: { id: { in: payouts.map((p) => p.vendorId) } },
    select: { id: true, stripeAccountId: true },
  });

  const stripeByVendor = new Map(vendors.map((v) => [v.id, v.stripeAccountId || null]));

  for (const p of payouts) {
    const acct = stripeByVendor.get(p.vendorId);

    if (!acct) {
      console.warn("[payout] vendor has no stripeAccountId:", p.vendorId);
      continue;
    }

    const amountCents = Math.round(Number(p.vendorPayoutNet || 0) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) continue;

    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: (splits.order.currency || "RON").toLowerCase(),
      destination: acct,
      transfer_group: `order_${orderId}`,
      metadata: {
        orderId,
        vendorId: p.vendorId,
      },
    });

    await prisma.vendorEarningEntry.create({
      data: {
        vendorId: p.vendorId,
        orderId,
        type: "SALE",
        currency: splits.order.currency || "RON",
        itemsNet: p.itemsNet,
        commissionNet: p.commissionNet,
        vendorNet: p.vendorPayoutNet,
        stripeTransferId: transfer.id,
        meta: {
          stripeFeeAllocated: p.stripeFeeAllocated,
          shippingNet: p.shippingNet,
          commissionBps: p.commissionBps,
          planCode: p.planCode,
        },
      },
    });
  }
}

async function handleVendorCommissionInvoicePaymentSucceeded(pi) {
  const invoiceId = pi?.metadata?.invoiceId;
  const vendorId = pi?.metadata?.vendorId || null;

  if (!invoiceId) throw new Error("missing_invoiceId_metadata");

  const { chargeId, feeNet } = await getPaymentIntentChargeAndFee(pi);

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      ...(vendorId ? { vendorId } : {}),
      direction: "PLATFORM_TO_VENDOR",
    },
    include: { vendorPayout: true },
  });

  if (!invoice) throw new Error("commission_invoice_not_found");
  if (invoice.status === "PAID") return;

  const paidAt = new Date();

  const enableAutoPay =
    pi.metadata?.enableAutoPay === "1" || pi.metadata?.autoPay === "true";

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        status: "PAID",
        paidAt,
        externalId: String(pi.id),
        stripePaymentIntentId: String(pi.id),
        stripePaymentStatus: "PAID",
        stripeAutoCharge: enableAutoPay,
        stripeLastPaymentError: null,
        meta: mergeMeta(invoice.meta, {
          paidVia: "stripe",
          purpose: "vendor_commission_invoice",
          stripePaymentIntentId: String(pi.id),
          stripeChargeId: chargeId ? String(chargeId) : null,
          stripeCustomerId: pi.customer ? String(pi.customer) : null,
          stripePaymentMethodId: pi.payment_method ? String(pi.payment_method) : null,
          stripeFeeNet: feeNet,
          autoPay: enableAutoPay,
          paidAt: paidAt.toISOString(),
        }),
      },
    });

    if (enableAutoPay && pi.customer && pi.payment_method) {
      await tx.vendorBilling.update({
        where: { vendorId: invoice.vendorId },
        data: {
          stripeCustomerId: String(pi.customer),
          stripeDefaultPaymentMethodId: String(pi.payment_method),
          autoBillingEnabled: true,
          autoBillingEnabledAt: paidAt,
          autoBillingDisabledAt: null,
        },
      });
    }

    if (invoice.vendorPayout) {
      await tx.vendorPayout.update({
        where: { id: invoice.vendorPayout.id },
        data: {
          status: "PAID",
          paidAt,
        },
      });
    }
  });
}

async function handleSubscriptionInvoiceSucceeded(invoice) {
  const stripeSubscriptionId = String(invoice.subscription || "");
  if (!stripeSubscriptionId) return;

  const stripeSub = await retrieveStripeSubscription(stripeSubscriptionId);

  await syncStripeSubscription(stripeSub, {
    lastInvoiceId: invoice.id,
    lastPaymentAt: new Date().toISOString(),
    billingReason: invoice.billing_reason || null,
  });
}

async function handleSubscriptionInvoiceFailed(invoice) {
  const stripeSubscriptionId = String(invoice.subscription || "");
  if (!stripeSubscriptionId) return;

  await updateSubscriptionMeta(
    { stripeSubscriptionId },
    { status: "past_due" },
    {
      lastInvoiceId: invoice.id,
      lastPaymentFailedAt: new Date().toISOString(),
      billingReason: invoice.billing_reason || null,
    }
  );
}

async function handleSubscriptionUpdated(stripeSub) {
  await syncStripeSubscription(stripeSub, {
    subscriptionUpdatedAt: new Date().toISOString(),
  });
}

async function handleSubscriptionDeleted(stripeSub) {
  await updateSubscriptionMeta(
    { stripeSubscriptionId: String(stripeSub.id) },
    {
      status: "canceled",
      endAt: new Date(),
    },
    {
      stripeStatus: stripeSub.status,
      canceledAt: new Date().toISOString(),
      cancelAtPeriodEnd: !!stripeSub.cancel_at_period_end,
    }
  );
}

router.post("/", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    return res.status(500).json({ error: "stripe_webhook_secret_missing" });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error("[stripe webhook] signature fail:", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    await prisma.stripeEvent.create({
      data: {
        eventId: event.id,
        type: event.type,
        livemode: !!event.livemode,
        payload: event.data?.object ?? {},
      },
    });
  } catch {
    return res.json({ received: true, duplicate: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      if (session.mode === "subscription") {
        await handleSubscriptionCheckoutCompleted(session);
      } else if (isVendorCommissionInvoicePayment(session)) {
        await handleCommissionInvoiceCheckoutCompleted(session);
      } else if (session?.metadata?.orderId) {
        await handleOrderCheckoutCompleted(session);
      }
    }

    if (event.type === "checkout.session.expired") {
      await handleCheckoutSessionExpired(event.data.object);
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;

      if (isVendorCommissionInvoicePayment(pi)) {
        await handleVendorCommissionInvoicePaymentSucceeded(pi);
      } else if (pi?.metadata?.orderId) {
        await handleOrderPaymentIntentSucceeded(pi);
      }
    }

    if (event.type === "invoice.payment_succeeded") {
      await handleSubscriptionInvoiceSucceeded(event.data.object);
    }

    if (event.type === "invoice.payment_failed") {
      await handleSubscriptionInvoiceFailed(event.data.object);
    }

    if (event.type === "customer.subscription.updated") {
      await handleSubscriptionUpdated(event.data.object);
    }

    if (event.type === "customer.subscription.deleted") {
      await handleSubscriptionDeleted(event.data.object);
    }

    if (event.type === "account.updated") {
      await persistConnectAccountStatus(event.data.object);
    }

    if (event.type === "account.application.deauthorized") {
      await handleConnectAccountDeauthorized(event.data.object);
    }

    await prisma.stripeEvent.updateMany({
      where: { eventId: event.id },
      data: { processedAt: new Date() },
    });

    return res.json({ received: true });
  } catch (e) {
    console.error("[stripe webhook] handler error:", e);

    await prisma.stripeEvent.updateMany({
      where: { eventId: event.id },
      data: {
        error: String(e?.message || e),
        processedAt: new Date(),
      },
    });

    return res.status(500).json({ error: "webhook_handler_failed" });
  }
});

export default router;