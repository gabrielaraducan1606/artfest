// backend/src/routes/guestOrdersRoutes.js

import { Router } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";

import { prisma } from "../db.js";

import {
  createDepositPaymentForShipment,
  createPaymentForOrder,
} from "../payments/orchestrator.js";

const router = Router();

/* =========================================================
   Config
========================================================= */

const JWT_SECRET =
  process.env.JWT_SECRET;

if (
  !JWT_SECRET &&
  process.env.NODE_ENV ===
    "production"
) {
  throw new Error(
    "JWT_SECRET is required in production"
  );
}

/* =========================================================
   Guest token normal
========================================================= */

function hashGuestToken(token) {
  return crypto
    .createHash("sha256")
    .update(
      String(
        token || ""
      )
    )
    .digest("hex");
}

/* =========================================================
   Deposit access token

   Acesta este tokenul temporar pe care îl putem trimite
   prin email atunci când vendorul solicită avans.

   Nu este același cu guestAccessToken.
========================================================= */

function verifyDepositAccessToken(
  token
) {
  const normalized =
    String(
      token || ""
    ).trim();

  if (!normalized) {
    return null;
  }

  try {
    const payload =
      jwt.verify(
        normalized,
        JWT_SECRET
      );

    if (
      payload?.type !==
      "guest_deposit_access"
    ) {
      return null;
    }

    if (
      !payload?.orderId
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/* =========================================================
   Status comandă
========================================================= */
function computeUiStatus(
  order,
  shipments = []
) {
  const orderStatus =
    String(
      order?.status || ""
    )
      .trim()
      .toUpperCase();

  const paymentMethod =
    String(
      order?.paymentMethod || ""
    )
      .trim()
      .toUpperCase();

  const shipmentStatuses =
    shipments.map(
      (shipment) =>
        String(
          shipment?.status || ""
        )
          .trim()
          .toUpperCase()
    );

  if (
    shipmentStatuses.some(
      (status) =>
        status === "RETURNED"
    )
  ) {
    return "RETURNED";
  }

  if (
    shipmentStatuses.some(
      (status) =>
        status === "REFUSED"
    )
  ) {
    return "CANCELED";
  }

  if (
    orderStatus === "CANCELLED"
  ) {
    return "CANCELED";
  }

  if (
    shipmentStatuses.length > 0 &&
    shipmentStatuses.every(
      (status) =>
        status === "DELIVERED"
    )
  ) {
    return "DELIVERED";
  }

  if (
    orderStatus === "FULFILLED"
  ) {
    return "DELIVERED";
  }

  if (
    shipmentStatuses.some(
      (status) =>
        [
          "AWB",
          "IN_TRANSIT",
        ].includes(status)
    )
  ) {
    return "SHIPPED";
  }

  if (
    shipmentStatuses.some(
      (status) =>
        [
          "PREPARING",
          "READY_FOR_PICKUP",
          "PICKUP_SCHEDULED",
        ].includes(status)
    )
  ) {
    return "PROCESSING";
  }

  /*
   * CARD plătit.
   * Chiar dacă shipment-ul este încă PENDING,
   * comanda trebuie afișată ca PROCESSING.
   */
  if (
    paymentMethod === "CARD" &&
    (
      orderStatus === "PAID" ||
      Boolean(
        order?.paidAt
      )
    )
  ) {
    return "PROCESSING";
  }

  if (
    shipmentStatuses.some(
      (status) =>
        status === "PENDING"
    )
  ) {
    return "PENDING";
  }

  switch (orderStatus) {
    case "PAID":
      return "PROCESSING";

    case "FULFILLED":
      return "DELIVERED";

    case "CANCELLED":
      return "CANCELED";

    case "PENDING":
    default:
      return "PENDING";
  }
}

function computeGuestOrderPaymentState(
  order
) {
  const paymentMethod =
    String(
      order?.paymentMethod || ""
    )
      .trim()
      .toUpperCase();

  const orderStatus =
    String(
      order?.status || ""
    )
      .trim()
      .toUpperCase();

  const isCard =
    paymentMethod === "CARD";

  const isPaid =
    isCard &&
    (
      orderStatus === "PAID" ||
      Boolean(
        order?.paidAt
      )
    );

  const paymentStatus =
    paymentMethod === "COD"
      ? "COD"
      : isPaid
        ? "PAID"
        : "PENDING";

  const canRetryPayment =
    isCard &&
    !isPaid &&
    orderStatus === "PENDING";

  return {
    paymentMethod,
    paymentStatus,
    paid:
      isPaid,
    canRetryPayment,
  };
}

/* =========================================================
   Status livrare
========================================================= */

function computeShippingStage(
  shipments = []
) {
  const statuses =
    shipments.map(
      (shipment) =>
        shipment.status
    );

  if (
    statuses.some(
      (status) =>
        [
          "READY_FOR_PICKUP",
          "PICKUP_SCHEDULED",
        ].includes(
          status
        )
    )
  ) {
    return {
      code:
        "AWAITING_COURIER_PICKUP",

      label:
        "Urmează să fie predată curierului",
    };
  }

  if (
    statuses.some(
      (status) =>
        status ===
        "AWB"
    )
  ) {
    return {
      code:
        "AWB_ISSUED",

      label:
        "AWB emis – pregătită de expediere",
    };
  }

  if (
    statuses.some(
      (status) =>
        status ===
        "IN_TRANSIT"
    )
  ) {
    return {
      code:
        "IN_TRANSIT",

      label:
        "Predată curierului",
    };
  }

  if (
    statuses.length >
      0 &&
    statuses.every(
      (status) =>
        status ===
        "DELIVERED"
    )
  ) {
    return {
      code:
        "DELIVERED",

      label:
        "Livrată",
    };
  }

  return null;
}

/* =========================================================
   Deposit serializer
========================================================= */

function serializeDeposit(
  shipment
) {
  const rawStatus =
    shipment
      ?.depositStatus ||
    "NOT_REQUESTED";

  const expiresAt =
    shipment
      ?.depositExpiresAt ||
    null;

  const expired =
    rawStatus ===
      "PENDING" &&
    expiresAt &&
    new Date(
      expiresAt
    ).getTime() <=
      Date.now();

  const status =
    expired
      ? "EXPIRED"
      : rawStatus;

  return {
    shipmentId:
      shipment.id,

    status,

    percent:
      shipment
        .depositPercent !=
      null
        ? Number(
            shipment
              .depositPercent
          )
        : null,

    requestedAmount:
      shipment
        .depositRequestedAmount !=
      null
        ? Number(
            shipment
              .depositRequestedAmount
          )
        : null,

    paidAmount:
      shipment
        .depositPaidAmount !=
      null
        ? Number(
            shipment
              .depositPaidAmount
          )
        : null,

    remainingCodAmount:
      shipment
        .remainingCodAmount !=
      null
        ? Number(
            shipment
              .remainingCodAmount
          )
        : null,

    requestedAt:
      shipment
        .depositRequestedAt ||
      null,

    paidAt:
      shipment
        .depositPaidAt ||
      null,

    expiresAt,

    payable:
      rawStatus ===
        "PENDING" &&
      !expired,
  };
}

/* =========================================================
   Include comun
========================================================= */

const guestOrderInclude = {
  shipments: {
    include: {
      items:
        true,

      vendor: {
        select: {
          id:
            true,

          displayName:
            true,

          address:
            true,

          city:
            true,
        },
      },
    },
  },
};

/* =========================================================
   Găsește guest order folosind tokenul normal
========================================================= */

async function findGuestOrder({
  orderReference,
  token,
}) {
  const normalizedToken =
    String(
      token || ""
    ).trim();

  if (!normalizedToken) {
    return null;
  }

  const tokenHash =
    hashGuestToken(
      normalizedToken
    );

  return prisma.order.findFirst({
    where: {
      isGuestOrder:
        true,

      userId:
        null,

      guestAccessTokenHash:
        tokenHash,

      AND: [
        {
          OR: [
            {
              id:
                orderReference,
            },

            {
              orderNumber:
                orderReference,
            },
          ],
        },

        {
          OR: [
            {
              guestAccessExpiresAt:
                null,
            },

            {
              guestAccessExpiresAt: {
                gt:
                  new Date(),
              },
            },
          ],
        },
      ],
    },

    include:
      guestOrderInclude,
  });
}

/* =========================================================
   Găsește guest order folosind depositToken

   Tokenul este semnat de server și expiră.
========================================================= */

async function findGuestOrderByDepositToken({
  orderReference,
  depositToken,
}) {
  const payload =
    verifyDepositAccessToken(
      depositToken
    );

  if (!payload) {
    return null;
  }

  /*
   * Tokenul trebuie să fie exact
   * pentru această comandă.
   */
  if (
    String(
      payload.orderId
    ) !==
    String(
      orderReference
    )
  ) {
    return null;
  }

  const order =
    await prisma.order.findFirst({
      where: {
        id:
          payload.orderId,

        isGuestOrder:
          true,

        userId:
          null,
      },

      include:
        guestOrderInclude,
    });

  if (!order) {
    return null;
  }

  /*
   * Dacă tokenul este pentru un anumit
   * shipment, verificăm că acesta
   * aparține comenzii.
   */
  if (
    payload.shipmentId &&
    !order.shipments.some(
      (shipment) =>
        shipment.id ===
        payload.shipmentId
    )
  ) {
    return null;
  }

  return {
    order,
    payload,
  };
}

/* =========================================================
   Resolve acces

   Acceptăm:
   - token = guestAccessToken normal
   - depositToken = token temporar primit pe email
========================================================= */

async function resolveGuestOrderAccess({
  orderReference,
  token,
  depositToken,
}) {
  if (token) {
    const order =
      await findGuestOrder({
        orderReference,
        token,
      });

    if (order) {
      return {
        order,
        accessType:
          "guest_token",

        depositPayload:
          null,
      };
    }
  }

  if (depositToken) {
    const result =
      await findGuestOrderByDepositToken({
        orderReference,
        depositToken,
      });

    if (result?.order) {
      return {
        order:
          result.order,

        accessType:
          "deposit_token",

        depositPayload:
          result.payload,
      };
    }
  }

  return null;
}

/* =========================================================
   GET /api/guest/orders/:id

   Exemple:

   /api/guest/orders/ORDER_ID?token=...
   sau
   /api/guest/orders/ORDER_ID?depositToken=...
========================================================= */

router.get(
  "/:id",

  async (
    req,
    res
  ) => {
    try {
      const orderReference =
        String(
          req.params.id ||
            ""
        ).trim();

      const token =
        String(
          req.query.token ||
            ""
        ).trim();

      const depositToken =
        String(
          req.query
            .depositToken ||
            ""
        ).trim();

      /*
       * Trebuie să avem:
       * - ID / orderNumber
       * - și cel puțin un token de acces.
       */
      if (
        !orderReference ||
        (
          !token &&
          !depositToken
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "guest_order_access_invalid",

            message:
              "Lipsește identificatorul comenzii sau tokenul de acces.",
          });
      }

      /*
       * Poate fi accesată fie cu:
       * - guestAccessToken normal
       * - depositToken temporar.
       */
      const access =
        await resolveGuestOrderAccess({
          orderReference,
          token,
          depositToken,
        });

      if (!access) {
        return res
          .status(404)
          .json({
            error:
              "guest_order_not_found",

            message:
              "Comanda nu a fost găsită sau linkul nu mai este valid.",
          });
      }

      const order =
        access.order;

      /*
       * =====================================================
       * STATUS PLATĂ
       * =====================================================
       */

      const paymentState =
        computeGuestOrderPaymentState(
          order
        );

      /*
       * =====================================================
       * STATUS COMANDĂ
       * =====================================================
       */

      const status =
        computeUiStatus(
          order,
          order.shipments
        );

      const shippingStage =
        computeShippingStage(
          order.shipments
        );

      /*
       * =====================================================
       * PRODUSE / IMAGINI
       * =====================================================
       */

      const productIds =
        Array.from(
          new Set(
            order.shipments
              .flatMap(
                (
                  shipment
                ) =>
                  shipment.items ||
                  []
              )
              .map(
                (
                  item
                ) =>
                  item.productId
              )
              .filter(
                Boolean
              )
          )
        );

      const products =
        productIds.length
          ? await prisma.product.findMany({
              where: {
                id: {
                  in:
                    productIds,
                },
              },

              select: {
                id:
                  true,

                images:
                  true,
              },
            })
          : [];

      const imageByProductId =
        new Map(
          products.map(
            (
              product
            ) => [
              product.id,

              Array.isArray(
                product.images
              ) &&
              product.images[0]
                ? product.images[0]
                : null,
            ]
          )
        );

      /*
       * =====================================================
       * ITEMS
       * =====================================================
       */

      const items =
        order.shipments.flatMap(
          (
            shipment
          ) =>
            shipment.items.map(
              (
                item
              ) => {
                const price =
                  Number(
                    item.price ||
                      0
                  );

                const originalPrice =
                  item.originalPrice !=
                  null
                    ? Number(
                        item.originalPrice
                      )
                    : null;

                const hasDiscount =
                  originalPrice !=
                    null &&
                  originalPrice >
                    price;

                const discountAmount =
                  Number(
                    item.discountAmount ||
                      0
                  );

                const discountPercent =
                  hasDiscount &&
                  originalPrice >
                    0
                    ? Math.round(
                        (
                          (
                            originalPrice -
                            price
                          ) /
                          originalPrice
                        ) *
                          100
                      )
                    : 0;

                return {
                  id:
                    item.id,

                  productId:
                    item.productId,

                  title:
                    item.title,

                  qty:
                    item.qty,

                  price,

                  priceCents:
                    Math.round(
                      price *
                        100
                    ),

                  originalPrice:
                    hasDiscount
                      ? originalPrice
                      : null,

                  originalPriceCents:
                    hasDiscount
                      ? Math.round(
                          originalPrice *
                            100
                        )
                      : null,

                  hasDiscount,

                  discountPercent,

                  discountAmount,

                  discountAmountCents:
                    Math.round(
                      discountAmount *
                        100
                    ),

                  promoCollectionId:
                    item.promoCollectionId ||
                    null,

                  promoFundingSource:
                    item.promoFundingSource ||
                    null,

                  selectedOptions:
                    item.selectedOptions ||
                    {},

                  customAnswers:
                    item.customAnswers ||
                    {},

                  repeatedGroupAnswers:
                    item.repeatedGroupAnswers ||
                    {},

                  configurationKey:
                    item.configurationKey ||
                    null,

                  image:
                    item.productId
                      ? imageByProductId.get(
                          item.productId
                        ) ||
                        null
                      : null,

                  shipmentId:
                    shipment.id,
                };
              }
            )
        );

      /*
       * =====================================================
       * TOTALURI
       * =====================================================
       */

      const subtotal =
        Number(
          order.subtotal ||
            0
        );

      const shippingTotal =
        Number(
          order.shippingTotal ||
            0
        );

      const total =
        Number(
          order.total ||
            subtotal +
              shippingTotal
        );

      /*
       * =====================================================
       * SHIPMENTS
       * =====================================================
       */

      const shipments =
        order.shipments.map(
          (
            shipment
          ) => ({
            id:
              shipment.id,

            provider:
              shipment.courierProvider,

            service:
              shipment.courierService,

            status:
              shipment.status,

            trackingUrl:
              shipment.trackingUrl,

            awb:
              shipment.awb,

            vendorId:
              shipment.vendorId ||
              null,

            vendorName:
              shipment.vendor
                ? shipment.vendor
                    .displayName ||
                  "Artizan"
                : null,

            deposit:
              serializeDeposit(
                shipment
              ),
          })
        );

      /*
       * Avansul activ, util și pentru
       * warning-ul general din frontend.
       */
      const activeDeposit =
        shipments
          .map(
            (
              shipment
            ) =>
              shipment.deposit
          )
          .find(
            (
              deposit
            ) =>
              deposit?.status ===
                "PENDING" ||
              deposit?.status ===
                "PAID"
          ) ||
        null;

      /*
       * =====================================================
       * RESPONSE
       * =====================================================
       */

      return res.json({
        id:
          order.id,

        orderNumber:
          order.orderNumber ||
          null,

        createdAt:
          order.createdAt,

        /*
         * Status calculat pentru UI:
         * PENDING / PROCESSING / SHIPPED...
         */
        status,

        /*
         * Status real:
         * PENDING | PAID | CANCELLED | FULFILLED
         */
        orderStatus:
          order.status,

        /*
         * =================================================
         * PLATĂ
         * =================================================
         */

        paymentMethod:
          paymentState
            .paymentMethod,

        paymentStatus:
          paymentState
            .paymentStatus,

        canRetryPayment:
          paymentState
            .canRetryPayment,

        paidAt:
          order.paidAt ||
          null,

        stripeCheckoutSessionId:
          order
            .stripeCheckoutSessionId ||
          null,

        stripePaymentIntentId:
          order
            .stripePaymentIntentId ||
          null,

        /*
         * =================================================
         * LIVRARE
         * =================================================
         */

        shippingStage,

        /*
         * =================================================
         * SUME
         * =================================================
         */

        currency:
          order.currency ||
          "RON",

        subtotal,

        shippingTotal,

        total,

        subtotalCents:
          Math.round(
            subtotal *
              100
          ),

        shippingCents:
          Math.round(
            shippingTotal *
              100
          ),

        totalCents:
          Math.round(
            total *
              100
          ),

        /*
         * =================================================
         * CLIENT
         * =================================================
         */

        customerName:
          order.customerName ||
          null,

        customerEmail:
          order.customerEmail ||
          null,

        customerPhone:
          order.customerPhone ||
          null,

        shippingAddress:
          order.shippingAddress ||
          {},

        billingAddress:
          order.billingAddress ||
          null,

        contactPerson:
          order.contactPerson ||
          null,

        customerType:
          order.customerType ||
          "PF",

        /*
         * =================================================
         * PRODUSE / PACHETE
         * =================================================
         */

        items,

        shipments,

        deposit:
          activeDeposit,

        /*
         * Tipul accesului.
         *
         * Frontend-ul poate ști astfel dacă pagina
         * a fost deschisă din linkul guest normal
         * sau din linkul special de avans.
         */
        access: {
          type:
            access.accessType,

          depositShipmentId:
            access
              .depositPayload
              ?.shipmentId ||
            null,
        },
      });
    } catch (
      error
    ) {
      console.error(
        "Guest order read failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "guest_order_read_failed",

          message:
            "Nu am putut încărca detaliile comenzii.",
        });
    }
  }
);
/* =========================================================
   POST /api/guest/orders/:id/payment

   Reia plata integrală CARD pentru guest.
========================================================= */

router.post(
  "/:id/payment",

  async (req, res) => {
    try {
      const orderReference =
        String(
          req.params.id || ""
        ).trim();

      const token =
        String(
          req.query.token ||
          req.body?.token ||
          ""
        ).trim();

      if (
        !orderReference ||
        !token
      ) {
        return res
          .status(400)
          .json({
            error:
              "guest_order_access_invalid",

            message:
              "Linkul comenzii nu este valid.",
          });
      }

      /*
       * Pentru plata integrală folosim
       * DOAR guestAccessToken-ul original.
       */
      const order =
        await findGuestOrder({
          orderReference,
          token,
        });

      if (!order) {
        return res
          .status(404)
          .json({
            error:
              "guest_order_not_found",

            message:
              "Comanda nu a fost găsită sau linkul nu mai este valid.",
          });
      }

      const paymentState =
        computeGuestOrderPaymentState(
          order
        );

      /*
       * Doar CARD.
       */
      if (
        paymentState
          .paymentMethod !== "CARD"
      ) {
        return res
          .status(409)
          .json({
            error:
              "order_not_card",

            message:
              "Această comandă nu necesită plată online.",
          });
      }

      /*
       * Deja achitată.
       */
      if (
        paymentState.paid
      ) {
        return res
          .status(409)
          .json({
            error:
              "order_already_paid",

            message:
              "Această comandă este deja plătită.",
          });
      }

      /*
       * Doar PENDING poate relua plata.
       */
      if (
        !paymentState
          .canRetryPayment
      ) {
        return res
          .status(409)
          .json({
            error:
              "order_not_payable",

            message:
              "Această comandă nu mai poate fi achitată în starea actuală.",
          });
      }

      /*
       * IMPORTANT:
       *
       * În DB există doar hash-ul tokenului.
       * Tokenul original îl avem aici din URL.
       *
       * Îl atașăm temporar obiectului trimis
       * către orchestrator.
       */
      const payment =
        await createPaymentForOrder({
          ...order,

          guestAccessToken:
            token,
        });

      const redirectUrl =
        payment?.redirectUrl ||
        payment?.url ||
        null;

      if (!redirectUrl) {
        return res
          .status(500)
          .json({
            error:
              "payment_url_missing",

            message:
              "Nu am primit linkul pentru plată.",
          });
      }

      return res.json({
        ok:
          true,

        orderId:
          order.id,

        orderNumber:
          order.orderNumber ||
          null,

        paymentMethod:
          paymentState
            .paymentMethod,

        paymentStatus:
          "PENDING",

        payment: {
          ...payment,
          redirectUrl,
        },
      });
    } catch (error) {
      console.error(
        "Guest retry payment failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "guest_payment_restart_failed",

          message:
            "Plata nu a putut fi reluată. Te rugăm să încerci din nou.",
        });
    }
  }
);
/* =========================================================
   POST
   /api/guest/orders/:orderId/shipments/:shipmentId/pay-deposit

   Acceptă:
   ?token=...
   sau
   ?depositToken=...
========================================================= */

router.post(
  "/:orderId/shipments/:shipmentId/pay-deposit",
  async (
    req,
    res
  ) => {
    try {
      const orderReference =
        String(
          req.params
            .orderId ||
            ""
        ).trim();

      const shipmentId =
        String(
          req.params
            .shipmentId ||
            ""
        ).trim();

      const token =
        String(
          req.query.token ||
            req.body?.token ||
            ""
        ).trim();

      const depositToken =
        String(
          req.query
            .depositToken ||
            req.body
              ?.depositToken ||
            ""
        ).trim();

      if (
        !orderReference ||
        !shipmentId ||
        (!token &&
          !depositToken)
      ) {
        return res
          .status(400)
          .json({
            error:
              "guest_order_access_invalid",

            message:
              "Linkul pentru comandă nu este valid.",
          });
      }

      const access =
        await resolveGuestOrderAccess({
          orderReference,
          token,
          depositToken,
        });

      if (!access) {
        return res
          .status(404)
          .json({
            error:
              "guest_order_not_found",

            message:
              "Comanda nu a fost găsită sau linkul nu mai este valid.",
          });
      }

      const order =
        access.order;

      const shipment =
        order.shipments.find(
          (item) =>
            item.id ===
            shipmentId
        );

      if (!shipment) {
        return res
          .status(404)
          .json({
            error:
              "shipment_not_found",

            message:
              "Pachetul nu a fost găsit.",
          });
      }

      /*
       * Dacă accesul este prin
       * depositToken, acesta trebuie
       * să fie pentru shipment-ul
       * pe care încearcă să-l plătească.
       */
      if (
        access.accessType ===
          "deposit_token" &&
        access
          .depositPayload
          ?.shipmentId &&
        access
          .depositPayload
          .shipmentId !==
          shipment.id
      ) {
        return res
          .status(403)
          .json({
            error:
              "deposit_access_forbidden",

            message:
              "Acest link nu este valabil pentru avansul selectat.",
          });
      }

      if (
        shipment
          .depositStatus !==
        "PENDING"
      ) {
        return res
          .status(409)
          .json({
            error:
              "deposit_not_pending",

            message:
              shipment
                .depositStatus ===
              "PAID"
                ? "Avansul a fost deja achitat."
                : "Nu există un avans activ pentru această comandă.",
          });
      }

      if (
        shipment
          .depositExpiresAt &&
        new Date(
          shipment
            .depositExpiresAt
        ).getTime() <=
          Date.now()
      ) {
        await prisma.shipment.update({
          where: {
            id:
              shipment.id,
          },

          data: {
            depositStatus:
              "EXPIRED",
          },
        });

        return res
          .status(409)
          .json({
            error:
              "deposit_expired",

            message:
              "Solicitarea de avans a expirat.",
          });
      }

      /*
       * Orchestratorul creează sau
       * returnează Checkout-ul Stripe.
       */
      const payment =
        await createDepositPaymentForShipment({
          shipmentId:
            shipment.id,
        });

      if (!payment?.url) {
        return res
          .status(500)
          .json({
            error:
              "deposit_checkout_missing",

            message:
              "Nu am putut deschide plata avansului.",
          });
      }

      return res.json({
        ok:
          true,

        provider:
          payment.provider ||
          "stripe",

        checkoutSessionId:
          payment.checkoutSessionId ||
          null,

        url:
          payment.url,
      });
    } catch (error) {
      console.error(
        "Guest pay deposit failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "guest_deposit_payment_failed",

          message:
            "Nu am putut deschide plata avansului.",
        });
    }
  }
);

export default router;