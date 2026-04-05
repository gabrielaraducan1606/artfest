// src/payments/orchestrator.js
import { prisma } from "../db.js";
import { stripe } from "../lib/stripe.js";

function getAppUrl() {
  return (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");
}

export async function createPaymentForOrder(order) {
  const appUrl = getAppUrl();
  if (!appUrl) throw new Error("APP_URL/FRONTEND_URL missing");

  const amountCents = Math.round(Number(order.total || 0) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("invalid_order_total");
  }

  const addr = order.shippingAddress || {};
  const currency = String(order.currency || "RON").toLowerCase();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: addr.email || undefined,

    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amountCents,
          product_data: {
            name: `Comandă ${order.orderNumber || order.id}`,
          },
        },
      },
    ],

    success_url: `${appUrl}/checkout/success?orderId=${encodeURIComponent(order.id)}`,
    cancel_url: `${appUrl}/checkout/cancel?orderId=${encodeURIComponent(order.id)}`,

    metadata: {
      orderId: order.id,
      orderNumber: order.orderNumber || "",
      kind: "order_payment",
    },

    payment_intent_data: {
      metadata: {
        orderId: order.id,
        orderNumber: order.orderNumber || "",
        kind: "order_payment",
      },
      // super util pt raportare (transfer_group folosit apoi la transfers)
      transfer_group: `order_${order.id}`,
    },
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { stripeCheckoutSessionId: session.id },
  });

  return {
    provider: "stripe",
    checkoutSessionId: session.id,
    url: session.url, // FE face redirect aici
  };
}
