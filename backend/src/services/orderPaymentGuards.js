// src/services/orderPaymentGuards.js
//
// Plata CARD a unei comenzi care între timp a fost ANULATĂ.
//
// Scenariu: clientul deschide Stripe Checkout, comanda este anulată (client,
// admin sau vendor) înainte de finalizarea plății, apoi clientul plătește.
// Înainte, handleOrderPaymentIntentSucceeded marca comanda ca PAID (deși era
// CANCELLED), transfera banii vendorilor și crea SALE/comision.
//
// Regula: pe o comandă CANCELLED, sau care are măcar o livrare OUTBOUND
// REFUSED/RETURNED, plata NU se procesează (fără PAID, fără transfer, fără
// SALE); PaymentIntent-ul încasat se rambursează integral Clientului.
// Statusurile Order/Shipment rămân cele anulate.
//
// Nicio schimbare de schemă.

import { prisma as defaultPrisma } from "../db.js";
import { stripe as defaultStripe } from "../lib/stripe.js";

// emailul se încarcă la nevoie (modulul e importat de multe rute de comenzi)
const defaultSendRefundEmail = async (args) =>
  (await import("../lib/mailer.js")).sendLatePaymentRefundedEmail(args);

const CANCELLED_SHIPMENT_STATUSES = ["REFUSED", "RETURNED"];

/*
 * `order` trebuie încărcat cu `shipments` (id, status, direction).
 * Întoarce null dacă plata poate fi procesată normal.
 */
export function getOrderPaymentBlockReason({ order }) {
  if (String(order?.status || "").toUpperCase() === "CANCELLED") {
    return "order_cancelled";
  }

  const outbound = (order?.shipments || []).filter(
    (shipment) => String(shipment?.direction || "OUTBOUND") !== "RETURN"
  );

  if (
    outbound.some((shipment) =>
      CANCELLED_SHIPMENT_STATUSES.includes(
        String(shipment?.status || "").toUpperCase()
      )
    )
  ) {
    return "shipment_cancelled";
  }

  return null;
}

async function appendOrderAdminNote({ prisma, orderId, text }) {
  try {
    const current = await prisma.order.findUnique({
      where: { id: orderId },
      select: { adminNotes: true },
    });

    const line = `[${new Date().toISOString()} | webhook] ${text}`;
    const old = String(current?.adminNotes || "").trim();

    await prisma.order.update({
      where: { id: orderId },
      data: { adminNotes: old ? `${old}\n${line}` : line },
    });
  } catch (error) {
    // Urma de audit nu trebuie să blocheze rambursarea deja făcută.
    console.error(
      "[order payment] adminNotes update failed:",
      orderId,
      error?.message || error
    );
  }
}

/*
 * Rambursează integral plata încasată pe o comandă anulată.
 *
 * Idempotent pe două niveluri:
 *  - starea REALĂ a charge-ului din Stripe (amount_refunded) - dacă e deja
 *    rambursat integral (de ex. de anularea clientului sau de un apel
 *    anterior), nu se mai creează niciun refund, indiferent de vârsta
 *    cheii de idempotență;
 *  - cheia de idempotență Stripe per comandă + PaymentIntent.
 *
 * Dacă pentru comandă există deja transferuri către vendori (procesare
 * parțială anterioară), NU facem un refund simplu (ar lăsa transferurile
 * nereversate): aruncăm eroare -> evenimentul rămâne FAILED, vizibil pentru
 * recovery (POST /api/admin/orders/:id/refund reversează transferurile).
 */
export async function refundBlockedOrderPayment({
  order,
  paymentIntent,
  chargeId,
  reason,
  prisma = defaultPrisma,
  stripe = defaultStripe,
  sendRefundEmail = defaultSendRefundEmail,
}) {
  const orderId = String(order.id);

  const existingTransfer = await prisma.vendorEarningEntry.findFirst({
    where: { orderId, stripeTransferId: { not: null } },
  });

  if (existingTransfer) {
    throw new Error("order_payment_blocked_with_existing_transfers");
  }

  const charge = await stripe.charges.retrieve(String(chargeId));

  const remaining = Math.max(
    0,
    Number(charge?.amount || 0) - Number(charge?.amount_refunded || 0)
  );

  if (remaining <= 0) {
    return { refunded: false, alreadyRefunded: true, amountCents: 0 };
  }

  const refund = await stripe.refunds.create(
    {
      charge: String(chargeId),
      amount: remaining,
      metadata: {
        kind: "order_payment_blocked_order",
        orderId,
        paymentIntentId: String(paymentIntent.id),
        reason: String(reason),
      },
    },
    {
      idempotencyKey: `order-blocked-refund-${orderId}-${paymentIntent.id}`,
    }
  );

  await appendOrderAdminNote({
    prisma,
    orderId,
    text: `Plată CARD primită pe comandă/livrare anulată (${reason}) - rambursată automat: ${(
      remaining / 100
    ).toFixed(2)} ${String(order.currency || "RON").toUpperCase()} (refund ${
      refund.id
    }, PaymentIntent ${paymentIntent.id}).`,
  });

  await notifyCustomerOfLateRefund({ prisma, orderId, amountCents: remaining, refundId: refund.id, sendRefundEmail });

  return {
    refunded: true,
    alreadyRefunded: false,
    refundId: refund.id,
    amountCents: remaining,
  };
}

/*
 * Email către client: doar după ce rambursarea a fost creată în Stripe
 * (un apel repetat găsește charge-ul deja rambursat și nu ajunge aici).
 * Non-blocant: rambursarea e deja făcută.
 */
async function notifyCustomerOfLateRefund({ prisma, orderId, amountCents, refundId, sendRefundEmail }) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        userId: true,
        currency: true,
        customerName: true,
        customerEmail: true,
        shippingAddress: true,
        user: { select: { email: true } },
      },
    });
    const to = order?.user?.email || order?.customerEmail || order?.shippingAddress?.email || null;
    if (!to) return;
    await sendRefundEmail({ to, order, amountCents, refundId, userId: order.userId || null });
  } catch (error) {
    console.error("[order payment] late refund email failed:", orderId, error?.message || error);
  }
}
