import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../db.js";

const router = Router();

function hashGuestToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token || ""))
    .digest("hex");
}

function computeUiStatus(order, shipments = []) {
  const orderStatus = order?.status || null;
  const shipmentStatuses = shipments.map(
    (shipment) => shipment.status
  );

  if (shipmentStatuses.length) {
    if (
      shipmentStatuses.some(
        (status) => status === "RETURNED"
      )
    ) {
      return "RETURNED";
    }

    if (
      shipmentStatuses.some(
        (status) => status === "REFUSED"
      )
    ) {
      return "CANCELED";
    }

    if (
      shipmentStatuses.every(
        (status) => status === "DELIVERED"
      )
    ) {
      return "DELIVERED";
    }

    if (
      shipmentStatuses.some((status) =>
        ["AWB", "IN_TRANSIT"].includes(status)
      )
    ) {
      return "SHIPPED";
    }

    if (
      shipmentStatuses.some((status) =>
        [
          "PREPARING",
          "READY_FOR_PICKUP",
          "PICKUP_SCHEDULED",
        ].includes(status)
      )
    ) {
      return "PROCESSING";
    }

    if (
      shipmentStatuses.some(
        (status) => status === "PENDING"
      )
    ) {
      return "PENDING";
    }
  }

  if (orderStatus === "CANCELLED") {
    return "CANCELED";
  }

  switch (orderStatus) {
    case "PAID":
      return "PROCESSING";

    case "FULFILLED":
      return "DELIVERED";

    case "PENDING":
    default:
      return "PENDING";
  }
}

function computeShippingStage(shipments = []) {
  const statuses = shipments.map(
    (shipment) => shipment.status
  );

  if (
    statuses.some((status) =>
      [
        "READY_FOR_PICKUP",
        "PICKUP_SCHEDULED",
      ].includes(status)
    )
  ) {
    return {
      code: "AWAITING_COURIER_PICKUP",
      label:
        "Urmează să fie predată curierului",
    };
  }

  if (
    statuses.some(
      (status) => status === "AWB"
    )
  ) {
    return {
      code: "AWB_ISSUED",
      label:
        "AWB emis – pregătită de expediere",
    };
  }

  if (
    statuses.some(
      (status) => status === "IN_TRANSIT"
    )
  ) {
    return {
      code: "IN_TRANSIT",
      label: "Predată curierului",
    };
  }

  if (
    statuses.length > 0 &&
    statuses.every(
      (status) => status === "DELIVERED"
    )
  ) {
    return {
      code: "DELIVERED",
      label: "Livrată",
    };
  }

  return null;
}

async function findGuestOrder({
  orderReference,
  token,
}) {
  const normalizedToken = String(
    token || ""
  ).trim();

  if (!normalizedToken) {
    return null;
  }

  const tokenHash = hashGuestToken(
    normalizedToken
  );

  const order = await prisma.order.findFirst({
    where: {
      isGuestOrder: true,
      userId: null,

      OR: [
        {
          id: orderReference,
        },
        {
          orderNumber: orderReference,
        },
      ],

      guestAccessTokenHash: tokenHash,

      OR: [
        {
          guestAccessExpiresAt: null,
        },
        {
          guestAccessExpiresAt: {
            gt: new Date(),
          },
        },
      ],
    },

    include: {
      shipments: {
        include: {
          items: true,

          vendor: {
            select: {
              id: true,
              displayName: true,
              address: true,
              city: true,
            },
          },
        },
      },
    },
  });

  return order;
}

/*
 * GET /api/guest/orders/:id?token=...
 */
router.get("/:id", async (req, res) => {
  try {
    const orderReference = String(
      req.params.id || ""
    ).trim();

    const token = String(
      req.query.token || ""
    ).trim();

    if (!orderReference || !token) {
      return res.status(400).json({
        error: "guest_order_access_invalid",
        message:
          "Lipsește identificatorul comenzii sau tokenul de acces.",
      });
    }

    const order = await findGuestOrder({
      orderReference,
      token,
    });

    if (!order) {
      return res.status(404).json({
        error: "guest_order_not_found",
        message:
          "Comanda nu a fost găsită sau linkul nu mai este valid.",
      });
    }

    const status = computeUiStatus(
      order,
      order.shipments
    );

    const shippingStage =
      computeShippingStage(
        order.shipments
      );

    const productIds = Array.from(
      new Set(
        order.shipments
          .flatMap(
            (shipment) =>
              shipment.items || []
          )
          .map((item) => item.productId)
          .filter(Boolean)
      )
    );

    const products = productIds.length
      ? await prisma.product.findMany({
          where: {
            id: {
              in: productIds,
            },
          },

          select: {
            id: true,
            images: true,
          },
        })
      : [];

    const imageByProductId = new Map(
      products.map((product) => [
        product.id,
        Array.isArray(product.images) &&
        product.images[0]
          ? product.images[0]
          : null,
      ])
    );

  const items = order.shipments.flatMap(
  (shipment) =>
    shipment.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      title: item.title,
      qty: item.qty,

      priceCents: Math.round(
        Number(item.price || 0) * 100
      ),

      selectedOptions: item.selectedOptions || {},
      customAnswers: item.customAnswers || {},
      configurationKey:
        item.configurationKey || null,

      image: item.productId
        ? imageByProductId.get(item.productId) || null
        : null,

      shipmentId: shipment.id,
    }))
);

    const subtotal = Number(
      order.subtotal || 0
    );

    const shippingTotal = Number(
      order.shippingTotal || 0
    );

    const total = Number(
      order.total ||
        subtotal + shippingTotal
    );

    return res.json({
      id: order.id,
      orderNumber:
        order.orderNumber || null,

      createdAt: order.createdAt,
      status,
      shippingStage,

      currency:
        order.currency || "RON",

      subtotal,
      shippingTotal,
      total,

      subtotalCents: Math.round(
        subtotal * 100
      ),

      shippingCents: Math.round(
        shippingTotal * 100
      ),

      totalCents: Math.round(
        total * 100
      ),

      customerName:
        order.customerName || null,

      customerEmail:
        order.customerEmail || null,

      customerPhone:
        order.customerPhone || null,

      shippingAddress:
        order.shippingAddress || {},

      customerType:
        order.customerType || "PF",

      items,

      shipments:
        order.shipments.map(
          (shipment) => ({
            id: shipment.id,

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
              shipment.vendorId || null,

            vendorName:
              shipment.vendor
                ? shipment.vendor
                    .displayName ||
                  "Artizan"
                : null,
          })
        ),
    });
  } catch (error) {
    console.error(
      "Guest order read failed:",
      error
    );

    return res.status(500).json({
      error:
        "guest_order_read_failed",
      message:
        "Nu am putut încărca detaliile comenzii.",
    });
  }
});

export default router;