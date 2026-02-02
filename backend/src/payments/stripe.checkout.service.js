import { stripe } from "./stripe.client.js";
import { prisma } from "../lib/prisma.js";

export async function createCheckoutSession(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  const line_items = order.items.map(item => ({
    quantity: item.quantity,
    price_data: {
      currency: "ron",
      unit_amount: Math.round(item.price * 100),
      product_data: { name: item.name },
    },
  }));

  if (order.shippingTotal > 0) {
    line_items.push({
      quantity: 1,
      price_data: {
        currency: "ron",
        unit_amount: Math.round(order.shippingTotal * 100),
        product_data: { name: "Transport" },
      },
    });
  }

  return stripe.checkout.sessions.create({
    mode: "payment",
    line_items,
    success_url: `${process.env.APP_URL}/checkout/success`,
    cancel_url: `${process.env.APP_URL}/checkout/cancel`,
    metadata: { orderId },
    payment_intent_data: {
      metadata: { orderId },
    },
  });
}
