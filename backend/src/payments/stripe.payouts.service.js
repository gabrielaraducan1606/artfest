import { stripe } from "./stripe.client.js";
import { prisma } from "../lib/prisma.js";

export async function handleSuccessfulPayment(session) {
  const orderId = session.metadata.orderId;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });

  const vendorTotals = {};

  for (const item of order.items) {
    vendorTotals[item.vendorId] =
      (vendorTotals[item.vendorId] || 0) + item.price * item.quantity;
  }

  const totalProducts = Object.values(vendorTotals).reduce((a, b) => a + b, 0);

  for (const [vendorId, productsTotal] of Object.entries(vendorTotals)) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });

    const commission = productsTotal * 0.1;
    const shippingShare = (productsTotal / totalProducts) * order.shippingTotal;
    const payout = productsTotal + shippingShare - commission;

    await stripe.transfers.create({
      amount: Math.round(payout * 100),
      currency: "ron",
      destination: vendor.stripeAccountId,
      metadata: { orderId, vendorId },
    });
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "PAID" },
  });
}
