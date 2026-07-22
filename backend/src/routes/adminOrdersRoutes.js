// src/routes/adminOrdersRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import {
  authRequired,
  requireRole,
} from "../api/auth.js";
import {
  sendOrderConfirmationEmail,
} from "../lib/mailer.js";

const router = Router();

// Doar ADMIN
router.use(
  authRequired,
  requireRole("ADMIN")
);

const normalizeText = (value = "") =>
  String(value || "").trim();

/* ----------------------------------------------------
   Helper: computeUiStatus
----------------------------------------------------- */
function computeUiStatus(
  order,
  shipments = []
) {
  const orderStatus =
    order?.status || null;

  const shipmentStatuses =
    shipments.map(
      (shipment) =>
        shipment.status
    );

  if (
    orderStatus === "CANCELLED"
  ) {
    return "CANCELED";
  }

  if (shipmentStatuses.length) {
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
      shipmentStatuses.every(
        (status) =>
          status === "DELIVERED"
      )
    ) {
      return "DELIVERED";
    }

    if (
      shipmentStatuses.some(
        (status) =>
          [
            "IN_TRANSIT",
            "AWB",
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

    if (
      shipmentStatuses.some(
        (status) =>
          status === "PENDING"
      )
    ) {
      return "PENDING";
    }
  }

  switch (orderStatus) {
    case "PENDING":
      return "PENDING";

    case "PAID":
      return "PROCESSING";

    case "FULFILLED":
      return "DELIVERED";

    default:
      return "PENDING";
  }
}

/* ----------------------------------------------------
   Helper: este anulabilă comanda?
----------------------------------------------------- */
function isOrderCancellable(
  order,
  shipments = []
) {
  const orderStatus =
    order?.status || null;

  if (
    [
      "CANCELLED",
      "FULFILLED",
    ].includes(orderStatus)
  ) {
    return false;
  }

  const hasStartedOrBeyond =
    shipments.some(
      (shipment) =>
        [
          "PREPARING",
          "READY_FOR_PICKUP",
          "AWB",
          "IN_TRANSIT",
          "PICKUP_SCHEDULED",
          "DELIVERED",
          "RETURNED",
          "REFUSED",
        ].includes(
          shipment.status
        )
    );

  return !hasStartedOrBeyond;
}

/* ----------------------------------------------------
   Helper: construiește datele clientului
----------------------------------------------------- */
function getOrderCustomer(order) {
  const shippingAddress =
    order?.shippingAddress || {};

  const contactPerson =
    order?.contactPerson || {};

  return {
    name:
      order?.customerName ||
      shippingAddress?.name ||
      [
        shippingAddress?.lastName,
        shippingAddress?.firstName,
      ]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      null,

    email:
      order?.customerEmail ||
      shippingAddress?.email ||
      contactPerson?.email ||
      order?.user?.email ||
      null,

    phone:
      order?.customerPhone ||
      shippingAddress?.phone ||
      contactPerson?.phone ||
      null,
  };
}

/* ----------------------------------------------------
   POST /api/admin/orders/:id/cancel

   Anulează comanda:
   - verifică dacă mai poate fi anulată
   - marchează shipment-urile REFUSED
   - restaurează stocul
   - marchează comanda CANCELLED
----------------------------------------------------- */
router.post(
  "/orders/:id/cancel",
  async (req, res) => {
    const id = normalizeText(
      req.params.id
    );

    const reason =
      normalizeText(
        req.body?.reason
      ) ||
      "Anulată de administrator";

    try {
      const order =
        await prisma.order.findFirst({
          where: {
            id,
          },

          include: {
            shipments: {
              include: {
                items: {
                  select: {
                    productId: true,
                    qty: true,
                  },
                },
              },
            },
          },
        });

      if (!order) {
        return res.status(404).json({
          error: "not_found",
          message:
            "Comanda nu a fost găsită.",
        });
      }

      const uiStatus =
        computeUiStatus(
          order,
          order.shipments
        );

      const cancellable =
        isOrderCancellable(
          order,
          order.shipments
        );

      if (
        ![
          "PENDING",
          "PROCESSING",
        ].includes(uiStatus) ||
        !cancellable
      ) {
        return res.status(409).json({
          error:
            "not_cancellable",

          message:
            "Comanda nu mai poate fi anulată deoarece procesarea sau livrarea a început.",
        });
      }

      await prisma.$transaction(
        async (tx) => {
          /*
           * Schimbăm numai shipment-urile
           * care încă sunt PENDING.
           *
           * Verificarea previne anularea
           * simultană de două ori.
           */
          const updatedShipments =
            await tx.shipment.updateMany({
              where: {
                orderId:
                  order.id,

                status:
                  "PENDING",
              },

              data: {
                status:
                  "REFUSED",

                refusedAt:
                  new Date(),

                cancelReason:
                  reason,

                cancelReasonNote:
                  null,
              },
            });

          if (
            updatedShipments.count !==
            order.shipments.length
          ) {
            throw new Error(
              "order_already_changed"
            );
          }

          /*
           * Calculăm cantitatea totală
           * pentru fiecare produs.
           */
          const quantityByProductId =
            new Map();

          for (
            const shipment
            of order.shipments
          ) {
            for (
              const item
              of shipment.items || []
            ) {
              if (!item.productId) {
                continue;
              }

              const qty =
                Number(item.qty || 0);

              if (
                !Number.isInteger(qty) ||
                qty <= 0
              ) {
                continue;
              }

              quantityByProductId.set(
                item.productId,
                Number(
                  quantityByProductId.get(
                    item.productId
                  ) || 0
                ) + qty
              );
            }
          }

          /*
           * Restaurăm stocul.
           */
          for (
            const [
              productId,
              qty,
            ]
            of quantityByProductId
          ) {
            await tx.product.updateMany({
              where: {
                id: productId,
              },

              data: {
                readyQty: {
                  increment: qty,
                },

                availability:
                  "READY",
              },
            });
          }

          await tx.order.update({
            where: {
              id: order.id,
            },

            data: {
              status:
                "CANCELLED",
            },
          });
        }
      );

      return res.json({
        ok: true,
      });
    } catch (error) {
      console.error(
        "ADMIN /orders/:id/cancel error",
        error
      );

      if (
        error?.message ===
        "order_already_changed"
      ) {
        return res.status(409).json({
          error:
            "order_already_changed",

          message:
            "Comanda a fost deja modificată și nu mai poate fi anulată.",
        });
      }

      return res.status(500).json({
        error:
          "admin_order_cancel_failed",

        message:
          "Comanda nu a putut fi anulată.",
      });
    }
  }
);

/* ----------------------------------------------------
   POST /api/admin/orders/:id/mark-fulfilled

   Marchează:
   - Order -> FULFILLED
   - Shipments -> DELIVERED
----------------------------------------------------- */
router.post(
  "/orders/:id/mark-fulfilled",
  async (req, res) => {
    const id = normalizeText(
      req.params.id
    );

    try {
      const order =
        await prisma.order.findFirst({
          where: {
            id,
          },

          include: {
            shipments: true,
          },
        });

      if (!order) {
        return res.status(404).json({
          error: "not_found",
          message:
            "Comanda nu a fost găsită.",
        });
      }

      if (
        order.status ===
        "CANCELLED"
      ) {
        return res.status(409).json({
          error:
            "already_cancelled",

          message:
            "Comanda este anulată și nu poate fi marcată ca livrată.",
        });
      }

      const updated =
        await prisma.$transaction(
          async (tx) => {
            await tx.shipment.updateMany({
              where: {
                orderId:
                  order.id,

                status: {
                  notIn: [
                    "DELIVERED",
                    "RETURNED",
                    "REFUSED",
                  ],
                },
              },

              data: {
                status:
                  "DELIVERED",
              },
            });

            return tx.order.update({
              where: {
                id: order.id,
              },

              data: {
                status:
                  "FULFILLED",
              },

              include: {
                shipments: true,
              },
            });
          }
        );

      return res.json({
        ok: true,
        order: updated,
      });
    } catch (error) {
      console.error(
        "ADMIN /orders/:id/mark-fulfilled error",
        error
      );

      return res.status(500).json({
        error:
          "admin_order_mark_fulfilled_failed",

        message:
          "Comanda nu a putut fi marcată ca livrată.",
      });
    }
  }
);

/* ----------------------------------------------------
   POST /api/admin/orders/:id/resend-confirmation

   Funcționează pentru:
   - user autentificat
   - guest
----------------------------------------------------- */
router.post(
  "/orders/:id/resend-confirmation",
  async (req, res) => {
    const id = normalizeText(
      req.params.id
    );

    try {
      const order =
        await prisma.order.findFirst({
          where: {
            id,
          },

          include: {
            shipments: {
              include: {
                items: true,
              },
            },

            user: {
              select: {
                email: true,
              },
            },
          },
        });

      if (!order) {
        return res.status(404).json({
          error: "not_found",
          message:
            "Comanda nu a fost găsită.",
        });
      }

      const customer =
        getOrderCustomer(order);

      if (!customer.email) {
        return res.status(400).json({
          error: "no_email",

          message:
            "Comanda nu are o adresă de email asociată.",
        });
      }

      const items =
        order.shipments.flatMap(
          (shipment) =>
            shipment.items.map(
              (item) => ({
                productId:
                  item.productId ||
                  null,

                title:
                  item.title,

                qty:
                  item.qty,

                price:
                  Number(
                    item.price || 0
                  ),
              })
            )
        );

      await sendOrderConfirmationEmail({
        to: customer.email,
        order,
        items,
      });

      return res.json({
        ok: true,
      });
    } catch (error) {
      console.error(
        "ADMIN /orders/:id/resend-confirmation error",
        error
      );

      return res.status(500).json({
        error:
          "admin_order_resend_confirmation_failed",

        message:
          "Emailul de confirmare nu a putut fi retrimis.",
      });
    }
  }
);

/* ----------------------------------------------------
   GET /api/admin/orders/:id

   Detalii comandă pentru admin.
   Funcționează și pentru guest.
----------------------------------------------------- */
router.get(
  "/orders/:id",
  async (req, res) => {
    const id = normalizeText(
      req.params.id
    );

    try {
      const order =
        await prisma.order.findFirst({
          where: {
            id,
          },

          include: {
            user: {
              select: {
                id: true,
                email: true,
              },
            },

            shipments: {
              include: {
                vendor: {
                  select: {
                    id: true,
                    displayName: true,
                    city: true,
                  },
                },

                items: true,
              },
            },
          },
        });

      if (!order) {
        return res.status(404).json({
          error: "not_found",
          message:
            "Comanda nu a fost găsită.",
        });
      }

      const uiStatus =
        computeUiStatus(
          order,
          order.shipments
        );

      const customer =
        getOrderCustomer(order);

      /*
       * Nu expunem hashul tokenului
       * către frontend.
       */
      const {
        guestAccessTokenHash,
        ...safeOrder
      } = order;

      return res.json({
        ...safeOrder,

        uiStatus,

        isGuestOrder:
          order.isGuestOrder === true ||
          !order.userId,

        customer,
      });
    } catch (error) {
      console.error(
        "ADMIN GET /orders/:id error",
        error
      );

      return res.status(500).json({
        error:
          "admin_order_details_failed",

        message:
          "Detaliile comenzii nu au putut fi încărcate.",
      });
    }
  }
);

/* ----------------------------------------------------
   PATCH /api/admin/orders/:id/notes

   Salvează note interne.
----------------------------------------------------- */
router.patch(
  "/orders/:id/notes",
  async (req, res) => {
    const id = normalizeText(
      req.params.id
    );

    const raw = normalizeText(
      req.body?.adminNotes
    );

    try {
      const existing =
        await prisma.order.findFirst({
          where: {
            id,
          },

          select: {
            id: true,
          },
        });

      if (!existing) {
        return res.status(404).json({
          error: "not_found",
          message:
            "Comanda nu a fost găsită.",
        });
      }

      let finalNotes = "";

      if (raw) {
        const dateStr =
          new Date()
            .toISOString()
            .slice(0, 10);

        const who =
          req.user?.email ||
          req.user?.id ||
          req.user?.sub ||
          "admin";

        finalNotes =
          `[${dateStr} | ${who}] ${raw}`;
      }

      const updated =
        await prisma.order.update({
          where: {
            id,
          },

          data: {
            adminNotes:
              finalNotes,
          },

          select: {
            id: true,
            adminNotes: true,
          },
        });

      return res.json({
        ok: true,
        order: updated,
      });
    } catch (error) {
      console.error(
        "ADMIN PATCH /orders/:id/notes error",
        error
      );

      return res.status(500).json({
        error:
          "admin_order_notes_failed",

        message:
          "Notele comenzii nu au putut fi salvate.",
      });
    }
  }
);

export default router;
