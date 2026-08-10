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

export async function createDepositPaymentForShipment({
  shipmentId,
}) {
  const appUrl = getAppUrl();

  if (!appUrl) {
    throw new Error(
      "APP_URL/FRONTEND_URL missing"
    );
  }

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

  if (
    shipment.order
      ?.paymentMethod !== "COD"
  ) {
    throw new Error(
      "deposit_only_for_cod"
    );
  }

  if (
    shipment.depositStatus !==
    "PENDING"
  ) {
    throw new Error(
      "deposit_not_pending"
    );
  }

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
      "stripe_not_active"
    );
  }

  const amountCents =
    Math.round(
      Number(
        shipment
          .depositRequestedAmount ||
          0
      ) * 100
    );

  if (
    !Number.isFinite(
      amountCents
    ) ||
    amountCents <= 0
  ) {
    throw new Error(
      "invalid_deposit_amount"
    );
  }

  const order =
    shipment.order;

  const address =
    order.shippingAddress ||
    {};

  const currency =
    String(
      order.currency ||
        "RON"
    ).toLowerCase();

  const session =
    await stripe.checkout.sessions.create({
      mode:
        "payment",

      payment_method_types: [
        "card",
      ],

      customer_email:
        address.email ||
        undefined,

      expires_at:
        Math.floor(
          (
            shipment
              .depositExpiresAt ||
            new Date(
              Date.now() +
                24 *
                  60 *
                  60 *
                  1000
            )
          ).getTime() /
            1000
        ),

      line_items: [
        {
          quantity:
            1,

          price_data: {
            currency,

            unit_amount:
              amountCents,

            product_data: {
              name:
                `Avans 15% – comanda ${
                  order.orderNumber ||
                  order.id
                }`,
            },
          },
        },
      ],

      success_url:
        `${appUrl}/comenzile-mele` +
        `?deposit=success` +
        `&orderId=${encodeURIComponent(
          order.id
        )}`,

      cancel_url:
        `${appUrl}/comenzile-mele` +
        `?deposit=cancelled` +
        `&orderId=${encodeURIComponent(
          order.id
        )}`,

      metadata: {
        kind:
          "deposit_payment",

        orderId:
          order.id,

        orderNumber:
          order.orderNumber ||
          "",

        shipmentId:
          shipment.id,

        vendorId:
          shipment.vendorId,

        depositPercent:
          String(
            shipment.depositPercent ||
              15
          ),
      },

      payment_intent_data: {
        transfer_group:
          `deposit_${shipment.id}`,

        metadata: {
          kind:
            "deposit_payment",

          orderId:
            order.id,

          orderNumber:
            order.orderNumber ||
            "",

          shipmentId:
            shipment.id,

          vendorId:
            shipment.vendorId,

          depositPercent:
            String(
              shipment.depositPercent ||
                15
            ),
        },
      },
    });

  await prisma.shipment.update({
    where: {
      id: shipment.id,
    },

    data: {
      stripeDepositSessionId:
        session.id,

      depositPaymentError:
        null,

      depositMeta: {
        checkoutUrl:
          session.url,

        checkoutCreatedAt:
          new Date().toISOString(),

        stripeConnectedAccountId:
          shipment.vendor
            .stripeAccountId,
      },
    },
  });

  return {
    provider:
      "stripe",

    checkoutSessionId:
      session.id,

    url:
      session.url,
  };
}