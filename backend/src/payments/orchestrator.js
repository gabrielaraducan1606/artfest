// src/payments/orchestrator.js
import { prisma } from "../db.js";
import { stripe } from "../lib/stripe.js";

function getAppUrl() {
  return (process.env.APP_URL || process.env.FRONTEND_URL || "").replace(/\/+$/, "");
}

export async function createPaymentForOrder(
  order
) {
  const appUrl =
    getAppUrl();

  if (!appUrl) {
    throw new Error(
      "APP_URL/FRONTEND_URL missing"
    );
  }

  const amountCents =
    Math.round(
      Number(
        order.total || 0
      ) * 100
    );

  if (
    !Number.isFinite(
      amountCents
    ) ||
    amountCents <= 0
  ) {
    throw new Error(
      "invalid_order_total"
    );
  }

  const address =
    order.shippingAddress ||
    {};

  const currency =
    String(
      order.currency ||
        "RON"
    ).toLowerCase();

  /*
   * Comandă guest dacă:
   * - isGuestOrder === true
   * sau
   * - nu există userId
   */
  const isGuestOrder =
    order.isGuestOrder === true ||
    !order.userId;

  /*
   * Pentru guest avem nevoie de tokenul
   * public de acces.
   *
   * IMPORTANT:
   * în DB avem doar HASH-ul tokenului,
   * deci tokenul original NU poate fi
   * reconstruit aici.
   *
   * De aceea ruta guest trebuie să trimită
   * guestAccessToken către această funcție.
   */
  const guestAccessToken =
    order.guestAccessToken ||
    null;

  let successUrl;
  let cancelUrl;

 if (
  isGuestOrder &&
  !guestAccessToken
) {
  throw new Error(
    "guest_access_token_missing"
  );
}

if (isGuestOrder)  {
    /*
     * Guest:
     * după Stripe ajunge direct
     * la pagina publică a comenzii.
     */
    successUrl =
      `${appUrl}/comanda-guest/${encodeURIComponent(
        order.id
      )}` +
      `?token=${encodeURIComponent(
        guestAccessToken
      )}` +
      `&payment=success`;

    cancelUrl =
      `${appUrl}/comanda-guest/${encodeURIComponent(
        order.id
      )}` +
      `?token=${encodeURIComponent(
        guestAccessToken
      )}` +
      `&payment=cancelled`;
  } else {
    /*
     * User autentificat.
     */
    successUrl =
      `${appUrl}/comanda/${encodeURIComponent(
        order.id
      )}` +
      `?payment=success`;

    cancelUrl =
      `${appUrl}/comanda/${encodeURIComponent(
        order.id
      )}` +
      `?payment=cancelled`;
  }

  const session =
    await stripe.checkout.sessions.create({
      mode:
        "payment",

      payment_method_types: [
        "card",
      ],

      customer_email:
        address.email ||
        order.customerEmail ||
        undefined,

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
                `Comandă ${
                  order.orderNumber ||
                  order.id
                }`,
            },
          },
        },
      ],

      success_url:
        successUrl,

      cancel_url:
        cancelUrl,

      metadata: {
        kind:
          "order_payment",

        orderId:
          String(
            order.id
          ),

        orderNumber:
          String(
            order.orderNumber ||
              ""
          ),

        isGuestOrder:
          isGuestOrder
            ? "true"
            : "false",
      },

      payment_intent_data: {
        transfer_group:
          `order_${order.id}`,

        metadata: {
          kind:
            "order_payment",

          orderId:
            String(
              order.id
            ),

          orderNumber:
            String(
              order.orderNumber ||
                ""
            ),

          isGuestOrder:
            isGuestOrder
              ? "true"
              : "false",
        },
      },
    });

  await prisma.order.update({
    where: {
      id:
        order.id,
    },

    data: {
      stripeCheckoutSessionId:
        session.id,
    },
  });

  return {
    provider:
      "stripe",

    checkoutSessionId:
      session.id,

    /*
     * Checkout.jsx-ul tău caută
     * result.payment.redirectUrl.
     */
    redirectUrl:
      session.url,

    /*
     * Îl păstrăm și pentru
     * compatibilitate cu cod mai vechi.
     */
    url:
      session.url,
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