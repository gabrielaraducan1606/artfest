// src/routes/stripeWebhookRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { stripe } from "../lib/stripe.js";
import {
  computeOrderSplits,
  allocateStripeFee,
  computeVendorPayouts,
} from "../payments/marketplaceCalc.js";

import {
  createVendorNotification,
} from "../services/notifications.js";

import {
  sendVendorDepositPaidEmail,
} from "../lib/mailer.js";

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
async function handleDepositCheckoutCompleted(
  session
) {
  const shipmentId =
    session?.metadata
      ?.shipmentId;

  if (!shipmentId) {
    throw new Error(
      "missing_shipmentId_metadata"
    );
  }

  const paymentIntentId =
    session.payment_intent
      ? String(
          session.payment_intent
        )
      : null;

  await prisma.shipment.updateMany({
    where: {
      id:
        shipmentId,

      depositStatus: {
        in: [
          "PENDING",
          "FAILED",
        ],
      },
    },

    data: {
      stripeDepositSessionId:
        String(
          session.id
        ),

      stripeDepositPaymentIntentId:
        paymentIntentId,

      depositPaymentError:
        null,
    },
  });
}

async function handleDepositPaymentIntentSucceeded(
  paymentIntent
) {
  const shipmentId =
    paymentIntent?.metadata?.shipmentId;

  const vendorId =
    paymentIntent?.metadata?.vendorId;

  const orderId =
    paymentIntent?.metadata?.orderId;

  if (!shipmentId) {
    throw new Error(
      "missing_shipmentId_metadata"
    );
  }

  if (!vendorId) {
    throw new Error(
      "missing_vendorId_metadata"
    );
  }

  if (!orderId) {
    throw new Error(
      "missing_orderId_metadata"
    );
  }

  /*
   * Încărcăm shipment-ul împreună
   * cu order-ul și contul Stripe
   * al vendorului.
   */
  const shipment =
    await prisma.shipment.findUnique({
      where: {
        id: shipmentId,
      },

      include: {
        order: true,

       vendor: {
  select: {
    id: true,

    displayName: true,
    email: true,
    userId: true,

    user: {
      select: {
        email: true,
      },
    },

    stripeAccountId: true,
    stripeChargesEnabled: true,
    stripePayoutsEnabled: true,
    stripeDetailsSubmitted: true,
    stripeConnectStatus: true,
  },
},
      },
    });

  if (!shipment) {
    throw new Error(
      "shipment_not_found"
    );
  }

  /*
   * Verificăm că metadata Stripe
   * corespunde shipment-ului real.
   */
  if (
    String(shipment.vendorId) !==
    String(vendorId)
  ) {
    throw new Error(
      "deposit_vendor_mismatch"
    );
  }

  if (
    String(shipment.orderId) !==
    String(orderId)
  ) {
    throw new Error(
      "deposit_order_mismatch"
    );
  }

  /*
   * Dacă avansul a fost deja procesat,
   * nu mai facem nimic.
   *
   * Protecție suplimentară pentru
   * webhook-uri duplicate.
   */
  if (
    shipment.depositStatus ===
    "PAID"
  ) {
    return;
  }

  /*
   * Vendorul trebuie să aibă
   * Stripe Connect complet activ.
   */
  const stripeReady =
    Boolean(
      shipment.vendor
        ?.stripeAccountId
    ) &&
    shipment.vendor
      ?.stripeChargesEnabled ===
      true &&
    shipment.vendor
      ?.stripePayoutsEnabled ===
      true &&
    shipment.vendor
      ?.stripeDetailsSubmitted ===
      true &&
    shipment.vendor
      ?.stripeConnectStatus ===
      "enabled";

  if (!stripeReady) {
    throw new Error(
      "vendor_stripe_not_active"
    );
  }

  /*
   * Obținem charge-ul și taxa Stripe
   * reală aferentă plății.
   */
  const {
    chargeId,
    feeNet,
  } =
    await getPaymentIntentChargeAndFee(
      paymentIntent
    );

  if (!chargeId) {
    throw new Error(
      "deposit_charge_not_found"
    );
  }

  /*
   * Suma efectiv încasată de Stripe.
   */
  const paidAmount =
    Number(
      paymentIntent.amount_received ||
        paymentIntent.amount ||
        0
    ) / 100;

  if (
    !Number.isFinite(
      paidAmount
    ) ||
    paidAmount <= 0
  ) {
    throw new Error(
      "invalid_deposit_paid_amount"
    );
  }

  const requestedAmount =
    Number(
      shipment.depositRequestedAmount ||
        0
    );

  /*
   * Suma plătită trebuie să fie
   * aceeași cu avansul solicitat.
   */
  if (
    !Number.isFinite(
      requestedAmount
    ) ||
    requestedAmount <= 0
  ) {
    throw new Error(
      "invalid_deposit_requested_amount"
    );
  }

  if (
    Math.abs(
      paidAmount -
        requestedAmount
    ) > 0.01
  ) {
    throw new Error(
      "deposit_amount_mismatch"
    );
  }

  /*
   * =====================================================
   * REGULA FINANCIARĂ PENTRU AVANS
   * =====================================================
   *
   * Avansul NU încasează acum
   * comisionul Artfest.
   *
   * Vendorul primește:
   *
   * avans plătit
   * -
   * taxa Stripe
   *
   * Comisionul Artfest rămâne pe
   * fluxul normal COD și se calculează
   * ulterior când comanda este
   * finalizată conform regulilor
   * marketplace-ului.
   */

  const stripeFeeNet =
    Number(
      feeNet || 0
    );

  const vendorTransferNet =
    Math.max(
      0,
      Number(
        (
          paidAmount -
          stripeFeeNet
        ).toFixed(2)
      )
    );

  if (
    vendorTransferNet <= 0
  ) {
    throw new Error(
      "deposit_not_enough_for_transfer"
    );
  }

  /*
   * Verificăm dacă transferul a fost
   * deja creat într-o procesare
   * anterioară.
   */
  const existingMeta =
    shipment.depositMeta &&
    typeof shipment.depositMeta ===
      "object"
      ? shipment.depositMeta
      : {};

  let transferId =
    existingMeta
      ?.stripeTransferId ||
    null;

  /*
   * Dacă nu există transfer,
   * îl trimitem către contul
   * Stripe Connect al vendorului.
   */
  if (!transferId) {
    const amountCents =
      Math.round(
        vendorTransferNet *
          100
      );

    const currency =
      String(
        shipment.order
          ?.currency ||
          "RON"
      ).toLowerCase();

    const transfer =
      await stripe.transfers.create(
        {
          amount:
            amountCents,

          currency,

          destination:
            shipment.vendor
              .stripeAccountId,

          /*
           * Transferul este legat
           * direct de charge-ul
           * acestei plăți.
           */
          source_transaction:
            chargeId,

          transfer_group:
            `deposit_${shipment.id}`,

          metadata: {
            kind:
              "deposit_vendor_transfer",

            orderId:
              String(orderId),

            shipmentId:
              String(
                shipmentId
              ),

            vendorId:
              String(
                vendorId
              ),

            commissionHandling:
              "COD_LEDGER",
          },
        },

        /*
         * Protecție Stripe împotriva
         * transferurilor duplicate.
         */
        {
          idempotencyKey:
            `deposit-transfer-${shipment.id}-${paymentIntent.id}`,
        }
      );

    transferId =
      transfer.id;
  }

  const paidAt =
    new Date();

  /*
   * Salvăm rezultatul plății.
   */
  await prisma.shipment.update({
    where: {
      id: shipment.id,
    },

    data: {
      depositStatus:
        "PAID",

      depositPaidAmount:
        paidAmount,

      depositPaidAt:
        paidAt,

      stripeDepositPaymentIntentId:
        String(
          paymentIntent.id
        ),

      stripeDepositChargeId:
        String(
          chargeId
        ),

      depositPaymentError:
        null,

      depositMeta:
        mergeMeta(
          existingMeta,
          {
            stripeTransferId:
              transferId,

            stripeFeeNet,

            vendorTransferNet,

            /*
             * Foarte important:
             * Artfest nu a încasat
             * comision din avans.
             */
            commissionCollected:
              0,

            commissionHandling:
              "COD_LEDGER",

            paidAmount,

            paymentIntentId:
              String(
                paymentIntent.id
              ),

            chargeId:
              String(
                chargeId
              ),

            paidAt:
              paidAt.toISOString(),
          }
        ),
    },
  });
/*
 * =====================================================
 * NOTIFICARE VENDOR — AVANS ACHITAT
 * =====================================================
 */

const currency =
  String(
    shipment.order?.currency ||
      "RON"
  ).toUpperCase();

const displayNo =
  shipment.order?.orderNumber ||
  shipment.order?.id ||
  orderId;

const remainingCodAmount =
  shipment.remainingCodAmount != null
    ? Number(
        shipment.remainingCodAmount
      )
    : null;

/*
 * Notificare în platformă.
 *
 * createVendorNotification este dedupe-safe,
 * deci nu vom crea notificări duplicate dacă
 * Stripe retrimite același webhook.
 */
try {
  await createVendorNotification(
    vendorId,
    {
      dedupeKey:
        `deposit_paid:${shipment.id}:${paymentIntent.id}`,

      type:
        "system",

      title:
        "Avans achitat ✓",

      body:
        `Clientul a achitat avansul de ${paidAmount.toFixed(
          2
        )} ${currency} pentru comanda #${displayNo}.` +
        (
          remainingCodAmount != null
            ? ` Rest de încasat la livrare: ${remainingCodAmount.toFixed(
                2
              )} ${currency}.`
            : ""
        ) +
        " Poți începe pregătirea comenzii.",

      link:
        `/vendor/orders?order=${encodeURIComponent(
          orderId
        )}`,

      meta: {
        kind:
          "deposit_paid",

        orderId:
          String(orderId),

        orderNumber:
          String(displayNo),

        shipmentId:
          String(shipmentId),

        vendorId:
          String(vendorId),

        depositPaidAmount:
          paidAmount,

        remainingCodAmount,

        stripeFeeNet,

        vendorTransferNet,

        stripeTransferId:
          transferId,

        stripePaymentIntentId:
          String(
            paymentIntent.id
          ),

        stripeChargeId:
          String(
            chargeId
          ),
      },
    }
  );
} catch (notificationError) {
  /*
   * Plata NU trebuie anulată dacă
   * notificarea nu poate fi creată.
   */
  console.error(
    "[deposit] vendor notification failed:",
    notificationError
  );
}

/*
 * Email către vendor.
 */
const vendorEmail =
  shipment.vendor?.email ||
  shipment.vendor?.user?.email ||
  null;

if (vendorEmail) {
  try {
    await sendVendorDepositPaidEmail({
      to:
        vendorEmail,

      userId:
        shipment.vendor?.userId ||
        null,

      vendorName:
        shipment.vendor?.displayName ||
        "Artizan",

      orderId:
        String(orderId),

      orderNumber:
        String(displayNo),

      depositAmount:
        paidAmount,

      remainingCodAmount,

      stripeFeeNet,

      transferredAmount:
        vendorTransferNet,

      currency,
    });
  } catch (mailError) {
    /*
     * La fel: emailul nu trebuie să
     * transforme plata reușită într-un
     * webhook eșuat.
     */
    console.error(
      "[deposit] vendor email failed:",
      mailError
    );
  }
}
  console.log(
    "[deposit] payment processed",
    {
      orderId,
      shipmentId,
      vendorId,

      paidAmount,

      stripeFeeNet,

      vendorTransferNet,

      transferId,
    }
  );
}

async function handleDepositCheckoutExpired(
  session
) {
  const shipmentId =
    session?.metadata
      ?.shipmentId;

  if (!shipmentId) {
    return;
  }

  await prisma.shipment.updateMany({
    where: {
      id:
        shipmentId,

      depositStatus:
        "PENDING",
    },

    data: {
      depositStatus:
        "EXPIRED",

      depositPaymentError:
        "checkout_session_expired",
    },
  });
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

async function handleOrderPaymentIntentSucceeded(
  pi
) {
  const orderId =
    pi?.metadata?.orderId;

  if (!orderId) {
    throw new Error(
      "missing_orderId_metadata"
    );
  }

  /*
   * ==========================================
   * CHARGE + TAXA STRIPE
   * ==========================================
   */
  const {
    chargeId,
    feeNet,
  } =
    await getPaymentIntentChargeAndFee(
      pi
    );

  if (!chargeId) {
    throw new Error(
      "order_charge_not_found"
    );
  }

  const amountReceived =
    Number(
      pi?.amount_received ||
        pi?.amount ||
        0
    ) / 100;

  if (
    !Number.isFinite(
      amountReceived
    ) ||
    amountReceived <= 0
  ) {
    throw new Error(
      "invalid_order_paid_amount"
    );
  }

  /*
   * ==========================================
   * COMANDA
   * ==========================================
   */
  const order =
    await prisma.order.findUnique({
      where: {
        id:
          orderId,
      },
    });

  if (!order) {
    throw new Error(
      "order_not_found"
    );
  }

  /*
   * Confirmăm plata în DB.
   */
  if (
    order.status !== "PAID" ||
    !order.stripeChargeId
  ) {
    await prisma.order.update({
      where: {
        id:
          orderId,
      },

      data: {
        status:
          "PAID",

        paidAt:
          order.paidAt ||
          new Date(),

        stripeChargeId:
          String(
            chargeId
          ),
      },
    });
  }

  /*
   * ==========================================
   * CALCUL MARKETPLACE
   * ==========================================
   *
   * Pentru fiecare vendor:
   *
   * produse + transport
   * - comision Artfest
   * - taxa Stripe alocată
   * = transfer vendor
   */
  const splits =
    await computeOrderSplits(
      orderId
    );

  const splitGross =
    Number(
      splits?.order
        ?.totalGross ||
        0
    );

  if (
    !Number.isFinite(
      splitGross
    ) ||
    splitGross <= 0
  ) {
    throw new Error(
      "invalid_order_split_total"
    );
  }

  /*
   * Nu transferăm mai mult decât
   * clientul a plătit efectiv.
   */
  if (
    splitGross -
      amountReceived >
    0.01
  ) {
    throw new Error(
      "order_payment_amount_mismatch"
    );
  }

  const vendorsWithFee =
    allocateStripeFee({
      vendors:
        splits.vendors,

      feeNet:
        Number(
          feeNet ||
            0
        ),
    });

  const payouts =
    computeVendorPayouts({
      vendors:
        vendorsWithFee,
    });

  if (
    !Array.isArray(
      payouts
    ) ||
    payouts.length === 0
  ) {
    throw new Error(
      "order_has_no_vendor_payouts"
    );
  }

  /*
   * Protecție suplimentară:
   *
   * totalul transferurilor către vendori
   * nu trebuie să depășească suma plătită
   * minus taxa Stripe.
   */
  const totalVendorPayout =
    payouts.reduce(
      (
        total,
        payout
      ) =>
        total +
        Number(
          payout
            ?.vendorPayoutNet ||
            0
        ),
      0
    );

  const maxTransferable =
    Math.max(
      0,

      Number(
        (
          amountReceived -
          Number(
            feeNet ||
              0
          )
        ).toFixed(2)
      )
    );

  if (
    Number(
      totalVendorPayout.toFixed(
        2
      )
    ) -
      maxTransferable >
    0.01
  ) {
    throw new Error(
      "vendor_payout_exceeds_charge_net"
    );
  }

  /*
   * ==========================================
   * CONTURI STRIPE CONNECT
   * ==========================================
   */
  const vendorIds =
    payouts.map(
      (payout) =>
        String(
          payout.vendorId
        )
    );

  const vendors =
    await prisma.vendor.findMany({
      where: {
        id: {
          in:
            vendorIds,
        },
      },

      select: {
        id:
          true,

        stripeAccountId:
          true,

        stripeChargesEnabled:
          true,

        stripePayoutsEnabled:
          true,

        stripeDetailsSubmitted:
          true,

        stripeConnectStatus:
          true,
      },
    });

  const vendorById =
    new Map(
      vendors.map(
        (vendor) => [
          String(
            vendor.id
          ),
          vendor,
        ]
      )
    );

  const currency =
    String(
      pi?.currency ||
        splits?.order
          ?.currency ||
        order.currency ||
        "RON"
    ).toLowerCase();

  /*
   * ==========================================
   * TRANSFER FIECĂRUI VENDOR
   * ==========================================
   */
  for (
    const payout of
    payouts
  ) {
    const vendorId =
      String(
        payout.vendorId
      );

    const vendor =
      vendorById.get(
        vendorId
      );

    if (!vendor) {
      throw new Error(
        `vendor_not_found:${vendorId}`
      );
    }

    const stripeReady =
      Boolean(
        vendor
          .stripeAccountId
      ) &&
      vendor
        .stripeChargesEnabled ===
        true &&
      vendor
        .stripePayoutsEnabled ===
        true &&
      vendor
        .stripeDetailsSubmitted ===
        true &&
      vendor
        .stripeConnectStatus ===
        "enabled";

    if (!stripeReady) {
      throw new Error(
        `vendor_stripe_not_active:${vendorId}`
      );
    }

    const amountCents =
      Math.round(
        Number(
          payout
            .vendorPayoutNet ||
            0
        ) *
          100
      );

    if (
      !Number.isFinite(
        amountCents
      ) ||
      amountCents <= 0
    ) {
      throw new Error(
        `invalid_vendor_payout:${vendorId}`
      );
    }

    /*
     * Stripe Connect transfer.
     *
     * source_transaction leagă
     * transferul de plata clientului.
     *
     * idempotencyKey previne
     * transferul dublu dacă Stripe
     * retrimite webhook-ul.
     */
    const transfer =
      await stripe.transfers.create(
        {
          amount:
            amountCents,

          currency,

          destination:
            vendor
              .stripeAccountId,

          source_transaction:
            chargeId,

          transfer_group:
            `order_${orderId}`,

          metadata: {
            kind:
              "order_vendor_transfer",

            orderId:
              String(
                orderId
              ),

            vendorId,

            paymentIntentId:
              String(
                pi.id
              ),

            commissionBps:
              String(
                payout
                  .commissionBps ||
                  0
              ),
          },
        },

        {
          idempotencyKey:
            `order-transfer-${orderId}-${vendorId}-${pi.id}`,
        }
      );

    /*
     * ==========================================
     * LEDGER ARTFEST
     * ==========================================
     *
     * Nu vrem duplicate în
     * VendorEarningEntry.
     */
    const existingEntry =
      await prisma.vendorEarningEntry.findFirst({
        where: {
          stripeTransferId:
            String(
              transfer.id
            ),
        },

        select: {
          id:
            true,
        },
      });

    if (!existingEntry) {
      await prisma.vendorEarningEntry.create({
        data: {
          vendorId,

          orderId:
            String(
              orderId
            ),

          type:
            "SALE",

          currency:
            String(
              splits?.order
                ?.currency ||
                order.currency ||
                "RON"
            ).toUpperCase(),

          /*
           * Net produse fără TVA.
           */
          itemsNet:
            Number(
              payout
                .itemsNetExVat ||
                0
            ),

          commissionNet:
            Number(
              payout
                .commissionNet ||
                0
            ),

          vendorNet:
            Number(
              payout
                .vendorPayoutNet ||
                0
            ),

          stripeTransferId:
            String(
              transfer.id
            ),

          meta: {
            kind:
              "online_order_vendor_transfer",

            paymentIntentId:
              String(
                pi.id
              ),

            chargeId:
              String(
                chargeId
              ),

            transferGroup:
              `order_${orderId}`,

            gross:
              Number(
                payout.gross ||
                  0
              ),

            itemsGross:
              Number(
                payout
                  .itemsGross ||
                  0
              ),

            itemsNetExVat:
              Number(
                payout
                  .itemsNetExVat ||
                  0
              ),

            itemsVat:
              Number(
                payout
                  .itemsVat ||
                  0
              ),

            shippingGross:
              Number(
                payout
                  .shippingGross ||
                  0
              ),

            shippingNetExVat:
              Number(
                payout
                  .shippingNetExVat ||
                  0
              ),

            shippingVat:
              Number(
                payout
                  .shippingVat ||
                  0
              ),

            stripeFeeAllocated:
              Number(
                payout
                  .stripeFeeAllocated ||
                  0
              ),

            commissionBps:
              Number(
                payout
                  .commissionBps ||
                  0
              ),

            planCode:
              payout
                .planCode ||
                null,

            planName:
              payout
                .planName ||
                null,
          },
        },
      });
    }

    console.log(
      "[order payment] vendor transfer processed",
      {
        orderId,

        vendorId,

        transferId:
          transfer.id,

        vendorPayoutNet:
          Number(
            payout
              .vendorPayoutNet ||
              0
          ),

        commissionNet:
          Number(
            payout
              .commissionNet ||
              0
          ),

        stripeFeeAllocated:
          Number(
            payout
              .stripeFeeAllocated ||
              0
          ),
      }
    );
  }

  console.log(
    "[order payment] payment + vendor splits processed",
    {
      orderId,

      paymentIntentId:
        pi?.id ||
        null,

      chargeId:
        String(
          chargeId
        ),

      amountReceived,

      stripeFeeNet:
        Number(
          feeNet ||
            0
        ),

      totalVendorPayout:
        Number(
          totalVendorPayout.toFixed(
            2
          )
        ),

      platformCommissionNet:
        Number(
          splits?.order
            ?.totalCommissionNet ||
            0
        ),

      currency:
        currency.toUpperCase(),
    }
  );
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

  const sub = await prisma.vendorSubscription.findFirst({
    where: { stripeSubscriptionId },
    include: {
      plan: true,
      vendor: {
        include: {
          billing: true,
        },
      },
    },
  });

  if (!sub) return;

  const amountGross = Number(invoice.amount_paid || 0) / 100;
  const currency = String(invoice.currency || "ron").toUpperCase();
  const paidAt = invoice.status_transitions?.paid_at
    ? stripeTsToDate(invoice.status_transitions.paid_at)
    : new Date();

  await prisma.invoice.upsert({
    where: {
      provider_providerInvoiceId: {
        provider: "STRIPE",
        providerInvoiceId: String(invoice.id),
      },
    },
    update: {
      status: "PAID",
      paidAt,
      providerStatus: invoice.status || "paid",
      providerPdfUrl: invoice.invoice_pdf || null,
      paymentUrl: invoice.hosted_invoice_url || null,
      stripePaymentIntentId: invoice.payment_intent
        ? String(invoice.payment_intent)
        : null,
      stripePaymentStatus: invoice.status || "paid",
      providerPayload: invoice,
      providerSyncedAt: new Date(),
      meta: {
        stripeSubscriptionId,
        billingReason: invoice.billing_reason || null,
      },
    },
    create: {
      vendorId: sub.vendorId,
      direction: "PLATFORM_TO_VENDOR",
      type: "SUBSCRIPTION",

      provider: "STRIPE",
      providerInvoiceId: String(invoice.id),
      providerStatus: invoice.status || "paid",
      providerPdfUrl: invoice.invoice_pdf || null,
      providerPayload: invoice,
      providerSyncedAt: new Date(),

      number: invoice.number || String(invoice.id),
      issueDate: invoice.created ? stripeTsToDate(invoice.created) : paidAt,
      dueDate: invoice.due_date ? stripeTsToDate(invoice.due_date) : null,

      currency,
      totalNet: amountGross,
      totalVat: 0,
      totalGross: amountGross,

      status: "PAID",
      paidAt,

      paymentUrl: invoice.hosted_invoice_url || null,
      stripePaymentIntentId: invoice.payment_intent
        ? String(invoice.payment_intent)
        : null,
      stripePaymentStatus: invoice.status || "paid",

      clientName:
        sub.vendor.billing?.companyName ||
        sub.vendor.billing?.vendorName ||
        sub.vendor.displayName ||
        null,
      clientEmail: sub.vendor.billing?.email || sub.vendor.email || null,
      clientPhone: sub.vendor.billing?.phone || sub.vendor.phone || null,
      clientAddress: sub.vendor.billing?.address || sub.vendor.address || null,

      meta: {
        stripeSubscriptionId,
        stripeCustomerId: invoice.customer ? String(invoice.customer) : null,
        billingReason: invoice.billing_reason || null,
        planCode: sub.plan?.code || null,
        planName: sub.plan?.name || null,
      },

      lines: {
        create: [
          {
            type: "SUBSCRIPTION",
            description: `Abonament ${sub.plan?.name || sub.plan?.code || ""}`,
            quantity: 1,
            unitNet: amountGross,
            vatRate: 0,
            totalNet: amountGross,
            totalVat: 0,
            totalGross: amountGross,
            vendorId: sub.vendorId,
          },
        ],
      },
    },
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
    if (
  event.type ===
  "checkout.session.completed"
) {
  const session =
    event.data.object;

  if (
    session?.metadata
      ?.kind ===
    "deposit_payment"
  ) {
    await handleDepositCheckoutCompleted(
      session
    );
  } else if (
    session.mode ===
    "subscription"
  ) {
    await handleSubscriptionCheckoutCompleted(
      session
    );
  } else if (
    isVendorCommissionInvoicePayment(
      session
    )
  ) {
    await handleCommissionInvoiceCheckoutCompleted(
      session
    );
  } else if (
    session?.metadata
      ?.orderId
  ) {
    await handleOrderCheckoutCompleted(
      session
    );
  }
}

   if (
  event.type ===
  "checkout.session.expired"
) {
  const session =
    event.data.object;

  if (
    session?.metadata
      ?.kind ===
    "deposit_payment"
  ) {
    await handleDepositCheckoutExpired(
      session
    );
  } else {
    await handleCheckoutSessionExpired(
      session
    );
  }
}

    if (
  event.type ===
  "payment_intent.succeeded"
) {
  const pi =
    event.data.object;

  if (
    pi?.metadata?.kind ===
    "deposit_payment"
  ) {
    await handleDepositPaymentIntentSucceeded(
      pi
    );
  } else if (
    isVendorCommissionInvoicePayment(
      pi
    )
  ) {
    await handleVendorCommissionInvoicePaymentSucceeded(
      pi
    );
  } else if (
    pi?.metadata?.orderId
  ) {
    await handleOrderPaymentIntentSucceeded(
      pi
    );
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