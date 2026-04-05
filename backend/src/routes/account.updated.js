// src/routes/stripe.webhook.js
import express from "express";
import { stripe } from "../lib/stripe.js";
import { prisma } from "../lib/prisma.js";
import {
  computeOrderSplits,
  allocateStripeFee,
  computeVendorPayouts,
} from "../payments/marketplaceCalc.js";

export const webhookRouter = express.Router();

function mapStripeSubStatus(stripeStatus, cancelAtPeriodEnd) {
  // Stripe: trialing, active, past_due, unpaid, canceled, incomplete, incomplete_expired
  if (
    cancelAtPeriodEnd &&
    (stripeStatus === "active" || stripeStatus === "trialing")
  ) {
    return "canceled_at_period_end";
  }
  if (stripeStatus === "trialing" || stripeStatus === "active") return "active";
  if (stripeStatus === "past_due") return "past_due";
  if (stripeStatus === "unpaid") return "unpaid";
  if (stripeStatus === "canceled") return "canceled";
  if (stripeStatus === "incomplete" || stripeStatus === "incomplete_expired")
    return "pending";
  return "pending";
}

async function upsertVendorSubscriptionFromStripe({
  subscription,
  metadataFallback = {},
}) {
  const meta = subscription.metadata || {};
  const vendorId = meta.vendorId || metadataFallback.vendorId;
  const planCode = meta.planCode || metadataFallback.planCode;
  const period = meta.period || metadataFallback.period;
  const pendingId =
    meta.pendingVendorSubscriptionId ||
    metadataFallback.pendingVendorSubscriptionId;

  if (!vendorId || !planCode) {
    // nu avem enough data — nu putem lega de vendor/plan
    throw new Error("missing_metadata_vendor_or_plan");
  }

  const plan = await prisma.subscriptionPlan.findUnique({
    where: { code: planCode },
  });
  if (!plan) throw new Error("plan_not_found_in_webhook");

  const status = mapStripeSubStatus(
    subscription.status,
    subscription.cancel_at_period_end
  );
  const endAt = new Date(
    (subscription.current_period_end || Math.floor(Date.now() / 1000)) * 1000
  );

  const trialStartsAt = subscription.trial_start
    ? new Date(subscription.trial_start * 1000)
    : null;
  const trialEndsAt = subscription.trial_end
    ? new Date(subscription.trial_end * 1000)
    : null;

  const stripeCustomerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;
  const stripeSubscriptionId = subscription.id;

  // Dacă avem un pendingVendorSubscriptionId, îl updatăm pe acela; altfel upsert by stripeSubscriptionId
  if (pendingId) {
    const existing = await prisma.vendorSubscription
      .findUnique({ where: { id: pendingId } })
      .catch(() => null);
    if (existing) {
      return prisma.vendorSubscription.update({
        where: { id: pendingId },
        data: {
          vendorId,
          planId: plan.id,
          status,
          stripeCustomerId: stripeCustomerId || existing.stripeCustomerId,
          stripeSubscriptionId,
          trialStartsAt,
          trialEndsAt,
          trialDays: plan.trialDays ?? existing.trialDays ?? null,
          endAt,
          meta: {
            ...(existing.meta || {}),
            stripe: { lastEvent: "subscription_sync" },
            period,
          },
        },
      });
    }
  }

  // fallback: upsert după stripeSubscriptionId
  const found = await prisma.vendorSubscription.findFirst({
    where: { stripeSubscriptionId },
  });

  if (found) {
    return prisma.vendorSubscription.update({
      where: { id: found.id },
      data: {
        vendorId,
        planId: plan.id,
        status,
        stripeCustomerId: stripeCustomerId || found.stripeCustomerId,
        trialStartsAt,
        trialEndsAt,
        trialDays: plan.trialDays ?? found.trialDays ?? null,
        endAt,
        meta: {
          ...(found.meta || {}),
          stripe: { lastEvent: "subscription_sync" },
          period,
        },
      },
    });
  }

  return prisma.vendorSubscription.create({
    data: {
      vendorId,
      planId: plan.id,
      status,
      startAt: new Date(),
      endAt,
      trialStartsAt,
      trialEndsAt,
      trialDays: plan.trialDays ?? null,
      stripeCustomerId: stripeCustomerId || null,
      stripeSubscriptionId,
      meta: { createdBy: "webhook", period },
    },
  });
}

/**
 * Marketplace order payout:
 * - Stripe fee se aplică o singură dată (pe charge)
 * - o alocăm proporțional la vendori (după gross)
 * - comisionul tău rămâne la tine (nu transferăm comisionul)
 * - transferăm către fiecare vendor: gross - comision - fee_alloc
 */
async function handleOrderPaymentIntentSucceeded(pi) {
  if (pi?.metadata?.kind !== "order_payment") return;

  const orderId = pi?.metadata?.orderId;
  if (!orderId) throw new Error("missing_orderId_metadata");

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      currency: true,
      stripePaymentIntentId: true,
      stripeChargeId: true,
    },
  });
  if (!order) throw new Error("order_not_found");

  // idempotent: dacă deja e PAID, nu mai refacem transfers
  if (order.status === "PAID") return;

  const charge = (pi.charges?.data || [])[0] || null;
  const chargeId = charge?.id ? String(charge.id) : null;

  // fee real Stripe (o singură dată) -> luăm balance_transaction
  let feeNet = 0;
  if (charge?.balance_transaction) {
    const bt = await stripe.balanceTransactions.retrieve(
      String(charge.balance_transaction)
    );
    feeNet = Math.abs((bt.fee || 0) / 100);
  }

  // Mark order paid
  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "PAID",
      paidAt: new Date(),
      stripePaymentIntentId: order.stripePaymentIntentId || String(pi.id),
      stripeChargeId: chargeId || null,
    },
  });

  // calc splits
  const splits = await computeOrderSplits(orderId);
  let vendors = allocateStripeFee(splits.vendors, feeNet);
  vendors = computeVendorPayouts(vendors);

  // load vendors stripeAccountId
  const vendorIds = vendors.map((v) => v.vendorId);
  const vendorRows = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
    select: {
      id: true,
      stripeAccountId: true,
      stripePayoutsEnabled: true,
      stripeConnectStatus: true,
    },
  });
  const vendorById = new Map(vendorRows.map((v) => [v.id, v]));

  // create transfers + earning entries
  for (const v of vendors) {
    const vendor = vendorById.get(v.vendorId);

    // tu zici că nu publici magazinul fără Stripe activ,
    // dar păstrăm safety net:
    if (
      !vendor?.stripeAccountId ||
      vendor.stripeConnectStatus !== "enabled" ||
      !vendor.stripePayoutsEnabled
    ) {
      console.warn(
        "[order payout] vendor not eligible for transfer:",
        v.vendorId
      );
      continue;
    }

    const amountCents = Math.round(Number(v.vendorPayoutNet || 0) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) continue;

    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: String(splits.order.currency || "RON").toLowerCase(),
      destination: vendor.stripeAccountId,
      transfer_group: `order_${orderId}`,
      metadata: {
        kind: "order_payout",
        orderId,
        vendorId: v.vendorId,
      },
    });

    // log în DB (per vendor)
    await prisma.vendorEarningEntry.create({
      data: {
        vendorId: v.vendorId,
        orderId,
        type: "SALE",
        currency: splits.order.currency || "RON",
        itemsNet: v.itemsNet,
        commissionNet: v.commissionNet,
        vendorNet: v.vendorPayoutNet,
        stripeTransferId: transfer.id,
        meta: {
          shippingNet: v.shippingNet,
          gross: v.gross,
          stripeFeeAllocated: v.stripeFeeAllocated,
          commissionBps: v.commissionBps,
          planCode: v.planCode,
          stripeFeeTotal: feeNet,
          paymentIntentId: String(pi.id),
          chargeId,
        },
      },
    });
  }
}

// IMPORTANT: raw body doar pe ruta asta
webhookRouter.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // idempotency
    const exists = await prisma.stripeEvent.findUnique({
      where: { eventId: event.id },
    });
    if (exists) return res.json({ received: true });

    await prisma.stripeEvent.create({
      data: {
        eventId: event.id,
        type: event.type,
        livemode: event.livemode,
        payload: event.data,
      },
    });

    try {
      // ===================== CONNECT (păstrat) =====================
      if (event.type === "account.updated") {
        const acct = event.data.object;

        const vendor = await prisma.vendor.findFirst({
          where: { stripeAccountId: acct.id },
        });

        if (vendor) {
          const due = [
            ...(acct.requirements?.currently_due || []),
            ...(acct.requirements?.past_due || []),
          ];

          await prisma.vendor.update({
            where: { id: vendor.id },
            data: {
              stripeChargesEnabled: !!acct.charges_enabled,
              stripePayoutsEnabled: !!acct.payouts_enabled,
              stripeDetailsSubmitted: !!acct.details_submitted,
              stripeOnboardedAt: acct.details_submitted
                ? new Date()
                : vendor.stripeOnboardedAt,
              stripeConnectStatus: acct.payouts_enabled ? "enabled" : "pending",
              stripeRequirementsDue: due,
              stripeDisabledReason: acct.requirements?.disabled_reason || null,
            },
          });
        }
      }

      // ===================== CHECKOUT SESSION COMPLETED =====================
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        // (A) subscription checkout (păstrat)
        if (session.mode === "subscription" && session.subscription) {
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id;
          const subscription = await stripe.subscriptions.retrieve(
            subscriptionId
          );

          await upsertVendorSubscriptionFromStripe({
            subscription,
            metadataFallback: session.metadata || {},
          });

          // leagă și checkoutSessionId dacă există pending
          const pendingId = session.metadata?.pendingVendorSubscriptionId;
          if (pendingId) {
            await prisma.vendorSubscription
              .update({
                where: { id: pendingId },
                data: {
                  stripeCheckoutSessionId: session.id,
                },
              })
              .catch(() => {});
          }
        }

        // (B) order payment checkout (NEW)
        if (session.mode === "payment") {
          const orderId = session.metadata?.orderId;
          if (orderId) {
            await prisma.order
              .update({
                where: { id: orderId },
                data: {
                  stripeCheckoutSessionId: session.id,
                  stripePaymentIntentId: session.payment_intent
                    ? String(session.payment_intent)
                    : null,
                },
              })
              .catch(() => {});
          }
        }
      }

      // ===================== SUBSCRIPTIONS =====================
      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated"
      ) {
        const subscription = event.data.object;
        await upsertVendorSubscriptionFromStripe({ subscription });
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;
        const stripeSubscriptionId = subscription.id;

        const found = await prisma.vendorSubscription.findFirst({
          where: { stripeSubscriptionId },
        });
        if (found) {
          await prisma.vendorSubscription.update({
            where: { id: found.id },
            data: {
              status: "canceled",
              endAt: new Date(),
            },
          });
        }
      }

      if (event.type === "invoice.paid") {
        const invoice = event.data.object;
        const subId = invoice.subscription;

        if (subId) {
          const subscription = await stripe.subscriptions.retrieve(subId);
          await upsertVendorSubscriptionFromStripe({
            subscription,
            metadataFallback: subscription.metadata || {},
          });
        }
      }

      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object;
        const subId = invoice.subscription;

        if (subId) {
          const found = await prisma.vendorSubscription.findFirst({
            where: { stripeSubscriptionId: subId },
          });

          if (found) {
            await prisma.vendorSubscription.update({
              where: { id: found.id },
              data: { status: "past_due" },
            });
          }
        }
      }

      // ===================== ORDER PAYMENTS (NEW) =====================
      // recomand să procesezi succesul pe payment_intent.succeeded
      // (este cel mai robust "paid" signal)
      if (event.type === "payment_intent.succeeded") {
        const pi = event.data.object;
        await handleOrderPaymentIntentSucceeded(pi);
      }

      await prisma.stripeEvent.update({
        where: { eventId: event.id },
        data: { processedAt: new Date() },
      });

      return res.json({ received: true });
    } catch (e) {
      await prisma.stripeEvent.update({
        where: { eventId: event.id },
        data: { error: String(e?.message || e) },
      });
      return res.status(500).json({
        message: "Webhook handler error",
        error: String(e?.message || e),
      });
    }
  }
);
