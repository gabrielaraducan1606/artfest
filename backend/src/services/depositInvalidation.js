// src/services/depositInvalidation.js
//
// Avansul COD (Stripe Checkout) pe comenzi anulate.
//
// 1) expirePendingDepositsForOrder - la anularea comenzii, avansurile
//    încă PENDING devin EXPIRED (DB întâi, ca rutele/webhook-urile să le
//    vadă imediat) și sesiunea Stripe Checkout deja creată (linkul trimis
//    Clientului) e expirată în Stripe, ca plata să nu mai fie posibilă.
//    Idempotent: actualizarea e condiționată de depositStatus = PENDING.
//
// 2) refundDepositForBlockedOrder - plasă de siguranță pentru cursa în care
//    avansul a fost plătit efectiv (sesiune deschisă înainte de anulare):
//    NU transferăm banii vendorului și NU marcăm PAID; refundăm integral
//    PaymentIntent-ul (nu există transfer de reversat) și marcăm REFUNDED.
//    Cheie de idempotență per PaymentIntent.
//
// Nicio schimbare de schemă: depositStatus (EXPIRED/REFUNDED),
// depositPaymentError și depositMeta există deja.

import { prisma as defaultPrisma } from "../db.js";
import { stripe as defaultStripe } from "../lib/stripe.js";

export async function expirePendingDepositsForOrder({
  orderId,
  // opțional: doar avansul acestui shipment (anulare de către vendor a
  // unei singure livrări dintr-o comandă multi-vendor)
  shipmentId = null,
  reason = "order_cancelled",
  prisma = defaultPrisma,
  stripe = defaultStripe,
}) {
  const pending = await prisma.shipment.findMany({
    where: {
      orderId,
      depositStatus: "PENDING",
      ...(shipmentId ? { id: String(shipmentId) } : {}),
    },
    select: { id: true, stripeDepositSessionId: true },
  });

  const expired = [];

  for (const shipment of pending) {
    const updated = await prisma.shipment.updateMany({
      where: { id: shipment.id, depositStatus: "PENDING" },
      data: {
        depositStatus: "EXPIRED",
        depositPaymentError: reason,
      },
    });

    if (updated.count !== 1) continue;

    expired.push(shipment.id);

    if (shipment.stripeDepositSessionId) {
      try {
        await stripe.checkout.sessions.expire(
          String(shipment.stripeDepositSessionId)
        );
      } catch (error) {
        // Sesiune deja expirată/finalizată: nu blochează anularea.
        // Dacă a fost totuși plătită, webhook-ul refundează (mai jos).
        console.warn(
          "[deposit] checkout session expire failed:",
          shipment.stripeDepositSessionId,
          error?.message || error
        );
      }
    }
  }

  return expired;
}

export async function refundDepositForBlockedOrder({
  shipment,
  paymentIntent,
  reason,
  prisma = defaultPrisma,
  stripe = defaultStripe,
}) {
  const paymentIntentId = String(paymentIntent.id);

  const paidAmount =
    Number(paymentIntent.amount_received || paymentIntent.amount || 0) / 100;

  const refund = await stripe.refunds.create(
    {
      payment_intent: paymentIntentId,
      metadata: {
        kind: "deposit_refund_blocked_order",
        orderId: String(shipment.orderId),
        shipmentId: String(shipment.id),
        reason: String(reason),
      },
    },
    {
      idempotencyKey: `deposit-blocked-refund-${shipment.id}-${paymentIntentId}`,
    }
  );

  const existingMeta =
    shipment.depositMeta &&
    typeof shipment.depositMeta === "object" &&
    !Array.isArray(shipment.depositMeta)
      ? shipment.depositMeta
      : {};

  await prisma.shipment.updateMany({
    where: { id: shipment.id, depositStatus: { not: "PAID" } },
    data: {
      depositStatus: "REFUNDED",
      stripeDepositPaymentIntentId: paymentIntentId,
      depositPaymentError: String(reason),
      depositMeta: {
        ...existingMeta,
        stripeRefundId: refund.id,
        refundedAmount: paidAmount,
        refundReason: String(reason),
        refundedAt: new Date().toISOString(),
      },
    },
  });

  return { refundId: refund.id, amount: paidAmount };
}
