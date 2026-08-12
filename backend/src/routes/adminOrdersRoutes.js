// src/routes/adminOrdersRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { stripe } from "../lib/stripe.js";
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
   Helper: date avans pentru Admin
----------------------------------------------------- */
function getDepositAdminData(
  shipment
) {
  if (!shipment) {
    return null;
  }

  const meta =
    shipment.depositMeta &&
    typeof shipment.depositMeta ===
      "object" &&
    !Array.isArray(
      shipment.depositMeta
    )
      ? shipment.depositMeta
      : {};

  return {
    status:
      shipment.depositStatus ||
      "NOT_REQUESTED",

    percent:
      shipment.depositPercent != null
        ? Number(
            shipment.depositPercent
          )
        : null,

    requestedAmount:
      shipment.depositRequestedAmount != null
        ? Number(
            shipment.depositRequestedAmount
          )
        : null,

    paidAmount:
      shipment.depositPaidAmount != null
        ? Number(
            shipment.depositPaidAmount
          )
        : null,

    remainingCodAmount:
      shipment.remainingCodAmount != null
        ? Number(
            shipment.remainingCodAmount
          )
        : null,

    requestedAt:
      shipment.depositRequestedAt ||
      null,

    paidAt:
      shipment.depositPaidAt ||
      null,

    expiresAt:
      shipment.depositExpiresAt ||
      null,

    stripeCheckoutSessionId:
      shipment.stripeDepositSessionId ||
      null,

    stripePaymentIntentId:
      shipment.stripeDepositPaymentIntentId ||
      null,

    stripeChargeId:
      shipment.stripeDepositChargeId ||
      null,

    paymentError:
      shipment.depositPaymentError ||
      null,

    stripeTransferId:
      meta.stripeTransferId ||
      null,

    stripeFeeNet:
      meta.stripeFeeNet != null
        ? Number(
            meta.stripeFeeNet
          )
        : null,

    vendorTransferNet:
      meta.vendorTransferNet != null
        ? Number(
            meta.vendorTransferNet
          )
        : null,

    commissionCollected:
      meta.commissionCollected != null
        ? Number(
            meta.commissionCollected
          )
        : 0,

    commissionHandling:
      meta.commissionHandling ||
      null,
  };
}

function buildOrderDepositSummary(
  shipments = []
) {
  const deposits =
    (shipments || []).map(
      (shipment) => ({
        shipmentId:
          shipment.id,

        vendorId:
          shipment.vendorId ||
          null,

        vendorName:
          shipment.vendor
            ?.displayName ||
          null,

        ...getDepositAdminData(
          shipment
        ),
      })
    );

  const activeDeposits =
    deposits.filter(
      (deposit) =>
        deposit.status !==
        "NOT_REQUESTED"
    );

  return {
    hasDeposit:
      activeDeposits.length > 0,

    hasPendingDeposit:
      activeDeposits.some(
        (deposit) =>
          deposit.status ===
          "PENDING"
      ),

    hasPaidDeposit:
      activeDeposits.some(
        (deposit) =>
          deposit.status ===
          "PAID"
      ),

    requestedTotal:
      Number(
        activeDeposits
          .reduce(
            (
              sum,
              deposit
            ) =>
              sum +
              Number(
                deposit.requestedAmount ||
                  0
              ),
            0
          )
          .toFixed(2)
      ),

    paidTotal:
      Number(
        activeDeposits
          .reduce(
            (
              sum,
              deposit
            ) =>
              sum +
              Number(
                deposit.paidAmount ||
                  0
              ),
            0
          )
          .toFixed(2)
      ),

    stripeFeeTotal:
      Number(
        activeDeposits
          .reduce(
            (
              sum,
              deposit
            ) =>
              sum +
              Number(
                deposit.stripeFeeNet ||
                  0
              ),
            0
          )
          .toFixed(2)
      ),

    vendorTransferTotal:
      Number(
        activeDeposits
          .reduce(
            (
              sum,
              deposit
            ) =>
              sum +
              Number(
                deposit.vendorTransferNet ||
                  0
              ),
            0
          )
          .toFixed(2)
      ),

    deposits:
      activeDeposits,
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
            Number(item.price || 0),

          originalPrice:
            item.originalPrice != null
              ? Number(item.originalPrice)
              : null,

          hasDiscount:
            item.originalPrice != null &&
            Number(item.originalPrice) >
              Number(item.price),

          discountAmount:
            Number(item.discountAmount || 0),

          promoCollectionId:
            item.promoCollectionId || null,

          promoFundingSource:
            item.promoFundingSource || null,
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

const totalDiscount =
  order.shipments
    .flatMap(
      (shipment) =>
        shipment.items || []
    )
    .reduce(
      (sum, item) =>
        sum +
        Number(
          item.discountAmount ||
            0
        ),
      0
    );

/*
 * Nu expunem hashul tokenului
 * către frontend.
 */
const {
  guestAccessTokenHash,
  ...safeOrder
} = order;

/*
 * Adăugăm și un obiect `deposit`
 * normalizat pe fiecare shipment.
 */
const safeShipments =
  (safeOrder.shipments || []).map(
    (shipment) => ({
      ...shipment,

      deposit:
        getDepositAdminData(
          shipment
        ),
    })
  );

/*
 * Rezumatul tuturor avansurilor
 * din comandă.
 */
const depositSummary =
  buildOrderDepositSummary(
    safeOrder.shipments || []
  );

return res.json({
  ...safeOrder,

  shipments:
    safeShipments,

  uiStatus,

  isGuestOrder:
    order.isGuestOrder === true ||
    !order.userId,

  customer,

  totalDiscount,

  totalDiscountCents:
    Math.round(
      totalDiscount * 100
    ),

  depositSummary,
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

/* ----------------------------------------------------
   POST /api/admin/orders/:id/refund

   Refund manual inițiat exclusiv de ADMIN.

   CARD:
   - reverse transferurile către vendori
   - refund integral al plății clientului

   COD + avans:
   - reverse transferul avansului
   - refund doar suma plătită ca avans

   COD fără avans:
   - nu există nimic de refundat prin Stripe
----------------------------------------------------- */
router.post(
  "/orders/:id/refund",
  async (req, res) => {
    const orderId =
      normalizeText(
        req.params.id
      );

    if (!orderId) {
      return res.status(400).json({
        error:
          "order_id_required",

        message:
          "Lipsește ID-ul comenzii.",
      });
    }

    try {
      /*
       * ==========================================
       * ÎNCĂRCĂM COMANDA
       * ==========================================
       */
      const order =
        await prisma.order.findUnique({
          where: {
            id:
              orderId,
          },

          include: {
            shipments: {
              include: {
                vendor: {
                  select: {
                    id: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        });

      if (!order) {
        return res.status(404).json({
          error:
            "order_not_found",

          message:
            "Comanda nu a fost găsită.",
        });
      }

      const paymentMethod =
        String(
          order.paymentMethod ||
            ""
        ).toUpperCase();

      /*
       * ==========================================
       * CAZ 1 — PLATĂ INTEGRALĂ CU CARDUL
       * ==========================================
       */
      if (
        paymentMethod ===
        "CARD"
      ) {
        const chargeId =
          order.stripeChargeId
            ? String(
                order.stripeChargeId
              )
            : null;

        if (!chargeId) {
          return res
            .status(409)
            .json({
              error:
                "card_charge_missing",

              message:
                "Comanda nu are o plată Stripe confirmată care să poată fi rambursată.",
            });
        }

        /*
         * Găsim toate transferurile
         * făcute către vendorii comenzii.
         *
         * În webhook-ul plății integrale
         * salvăm stripeTransferId în
         * VendorEarningEntry.
         */
        const earningEntries =
          await prisma.vendorEarningEntry.findMany({
            where: {
              orderId:
                order.id,

              stripeTransferId: {
                not:
                  null,
              },
            },

            select: {
              id: true,
              vendorId: true,
              stripeTransferId:
                true,
            },
          });

        if (
          !earningEntries.length
        ) {
          return res
            .status(409)
            .json({
              error:
                "vendor_transfers_missing",

              message:
                "Nu am găsit transferurile Stripe către vendori. Rambursarea a fost oprită pentru verificare manuală.",
            });
        }

        const reversals = [];

        /*
         * ==========================================
         * 1. RECUPERĂM TRANSFERURILE VENDORILOR
         * ==========================================
         */
        for (
          const entry of
          earningEntries
        ) {
          const transferId =
            entry
              .stripeTransferId
              ? String(
                  entry
                    .stripeTransferId
                )
              : null;

          if (!transferId) {
            continue;
          }

          /*
           * Citim transferul direct din Stripe,
           * ca să știm cât a fost deja reversat.
           */
          const transfer =
            await stripe.transfers.retrieve(
              transferId
            );

          const transferAmount =
            Number(
              transfer.amount ||
                0
            );

          const amountReversed =
            Number(
              transfer.amount_reversed ||
                0
            );

          const remainingToReverse =
            Math.max(
              0,

              transferAmount -
                amountReversed
            );

          /*
           * Dacă a fost deja reversat complet,
           * nu mai trimitem încă o operațiune.
           */
          if (
            remainingToReverse <=
            0
          ) {
            reversals.push({
              vendorId:
                entry.vendorId,

              transferId,

              alreadyReversed:
                true,

              amountCents:
                0,
            });

            continue;
          }

          const reversal =
            await stripe.transfers.createReversal(
              transferId,
              {
                amount:
                  remainingToReverse,

                metadata: {
                  kind:
                    "admin_order_refund",

                  orderId:
                    String(
                      order.id
                    ),

                  vendorId:
                    String(
                      entry.vendorId
                    ),
                },
              },
              {
                idempotencyKey:
                  `admin-order-refund-reversal-${order.id}-${transferId}`,
              }
            );

          reversals.push({
            vendorId:
              entry.vendorId,

            transferId,

            reversalId:
              reversal.id,

            amountCents:
              Number(
                reversal.amount ||
                  remainingToReverse
              ),
          });
        }

        /*
         * ==========================================
         * 2. REFUND CLIENT
         * ==========================================
         *
         * Refundăm doar suma care NU a fost
         * deja rambursată.
         */
        const charge =
          await stripe.charges.retrieve(
            chargeId
          );

        const chargeAmount =
          Number(
            charge.amount ||
              0
          );

        const amountAlreadyRefunded =
          Number(
            charge.amount_refunded ||
              0
          );

        const remainingRefundAmount =
          Math.max(
            0,

            chargeAmount -
              amountAlreadyRefunded
          );

        /*
         * Dacă plata a fost deja rambursată,
         * nu mai facem încă un refund.
         */
        if (
          remainingRefundAmount <=
          0
        ) {
          return res.json({
            ok:
              true,

            alreadyRefunded:
              true,

            message:
              "Plata acestei comenzi era deja rambursată integral.",

            reversals,
          });
        }

        const refund =
          await stripe.refunds.create(
            {
              charge:
                chargeId,

              amount:
                remainingRefundAmount,

              metadata: {
                kind:
                  "admin_order_refund",

                orderId:
                  String(
                    order.id
                  ),

                orderNumber:
                  String(
                    order.orderNumber ||
                      ""
                  ),
              },
            },
            {
              idempotencyKey:
                `admin-order-refund-${order.id}-${chargeId}`,
            }
          );

        /*
         * Adăugăm o urmă simplă în notele
         * Admin, fără să avem nevoie acum
         * de migrare Prisma.
         */
        const who =
          req.user?.email ||
          req.user?.id ||
          req.user?.sub ||
          "admin";

        const refundNote =
          `[${new Date().toISOString()} | ${who}] ` +
          `Refund Stripe ${refund.id} — ` +
          `${(
            remainingRefundAmount /
            100
          ).toFixed(2)} ${String(
            order.currency ||
              "RON"
          ).toUpperCase()}`;

        const oldNotes =
          normalizeText(
            order.adminNotes
          );

        await prisma.order.update({
          where: {
            id:
              order.id,
          },

          data: {
            adminNotes:
              oldNotes
                ? `${oldNotes}\n${refundNote}`
                : refundNote,
          },
        });

        return res.json({
          ok:
            true,

          type:
            "CARD_FULL_REFUND",

          refundId:
            refund.id,

          refundedAmount:
            Number(
              (
                remainingRefundAmount /
                100
              ).toFixed(2)
            ),

          currency:
            String(
              order.currency ||
                "RON"
            ).toUpperCase(),

          reversals,

          message:
            "Plata a fost rambursată integral clientului, iar transferurile către vendori au fost reversate.",
        });
      }

      /*
       * ==========================================
       * CAZ 2 — COD + AVANS STRIPE
       * ==========================================
       */
      if (
        paymentMethod ===
        "COD"
      ) {
        const paidDepositShipments =
          (
            order.shipments ||
            []
          ).filter(
            (shipment) =>
              shipment.depositStatus ===
                "PAID" &&
              shipment
                .stripeDepositChargeId
          );

        if (
          !paidDepositShipments
            .length
        ) {
          return res
            .status(409)
            .json({
              error:
                "no_online_payment_to_refund",

              message:
                "Această comandă este ramburs și nu are niciun avans Stripe plătit.",
            });
        }

        const refundedDeposits =
          [];

        /*
         * O comandă poate avea mai multe
         * shipments / vendori și, implicit,
         * mai multe avansuri.
         */
        for (
          const shipment of
          paidDepositShipments
        ) {
          const existingMeta =
            shipment.depositMeta &&
            typeof shipment.depositMeta ===
              "object" &&
            !Array.isArray(
              shipment.depositMeta
            )
              ? shipment.depositMeta
              : {};

          const transferId =
            existingMeta
              .stripeTransferId
              ? String(
                  existingMeta
                    .stripeTransferId
                )
              : null;

          const chargeId =
            String(
              shipment
                .stripeDepositChargeId
            );

          /*
           * ======================================
           * 1. REVERSE TRANSFER AVANS VENDOR
           * ======================================
           */
          let reversalId =
            existingMeta
              .refundReversalId ||
            null;

          if (transferId) {
            const transfer =
              await stripe.transfers.retrieve(
                transferId
              );

            const transferAmount =
              Number(
                transfer.amount ||
                  0
              );

            const amountReversed =
              Number(
                transfer.amount_reversed ||
                  0
              );

            const remainingToReverse =
              Math.max(
                0,

                transferAmount -
                  amountReversed
              );

            if (
              remainingToReverse >
              0
            ) {
              const reversal =
                await stripe.transfers.createReversal(
                  transferId,
                  {
                    amount:
                      remainingToReverse,

                    metadata: {
                      kind:
                        "admin_deposit_refund",

                      orderId:
                        String(
                          order.id
                        ),

                      shipmentId:
                        String(
                          shipment.id
                        ),

                      vendorId:
                        String(
                          shipment.vendorId
                        ),
                    },
                  },
                  {
                    idempotencyKey:
                      `admin-deposit-refund-reversal-${shipment.id}-${transferId}`,
                  }
                );

              reversalId =
                reversal.id;
            }
          }

          /*
           * ======================================
           * 2. REFUND AVANS CLIENT
           * ======================================
           */
          const charge =
            await stripe.charges.retrieve(
              chargeId
            );

          const chargeAmount =
            Number(
              charge.amount ||
                0
            );

          const amountAlreadyRefunded =
            Number(
              charge.amount_refunded ||
                0
            );

          const remainingRefundAmount =
            Math.max(
              0,

              chargeAmount -
                amountAlreadyRefunded
            );

          let refundId =
            existingMeta
              .stripeRefundId ||
            null;

          if (
            remainingRefundAmount >
            0
          ) {
            const refund =
              await stripe.refunds.create(
                {
                  charge:
                    chargeId,

                  amount:
                    remainingRefundAmount,

                  metadata: {
                    kind:
                      "admin_deposit_refund",

                    orderId:
                      String(
                        order.id
                      ),

                    shipmentId:
                      String(
                        shipment.id
                      ),

                    vendorId:
                      String(
                        shipment.vendorId
                      ),
                  },
                },
                {
                  idempotencyKey:
                    `admin-deposit-refund-${shipment.id}-${chargeId}`,
                }
              );

            refundId =
              refund.id;
          }

          /*
           * Păstrăm datele refund-ului
           * în depositMeta, câmp pe care
           * îl ai deja în Prisma.
           */
          const refundedAt =
            new Date();

          await prisma.shipment.update({
            where: {
              id:
                shipment.id,
            },

            data: {
              depositMeta: {
                ...existingMeta,

                refunded:
                  true,

                refundedAt:
                  refundedAt.toISOString(),

                stripeRefundId:
                  refundId,

                refundReversalId:
                  reversalId,

                refundedAmount:
                  Number(
                    (
                      chargeAmount /
                      100
                    ).toFixed(2)
                  ),

                refundReason:
                  "ADMIN_MANUAL_REFUND",
              },
            },
          });

          refundedDeposits.push({
            shipmentId:
              shipment.id,

            vendorId:
              shipment.vendorId,

            stripeRefundId:
              refundId,

            reversalId,

            refundedAmount:
              Number(
                (
                  chargeAmount /
                  100
                ).toFixed(2)
              ),
          });
        }

        return res.json({
          ok:
            true,

          type:
            "COD_DEPOSIT_REFUND",

          refunds:
            refundedDeposits,

          message:
            "Avansul plătit online a fost rambursat clientului, iar transferul către vendor a fost reversat.",
        });
      }

      /*
       * Metodă de plată necunoscută.
       */
      return res
        .status(409)
        .json({
          error:
            "unsupported_payment_method",

          message:
            "Această comandă nu are o plată online care poate fi rambursată.",
        });
    } catch (error) {
      console.error(
        "ADMIN /orders/:id/refund error",
        error
      );

      /*
       * Dacă vendorul nu mai are suficient
       * sold Stripe pentru transfer reversal,
       * NU continuăm cu refund-ul clientului.
       *
       * Astfel Artfest nu suportă automat
       * pierderea.
       */
      if (
  error?.code === "balance_insufficient"
) {
  return res.status(409).json({
    error: "stripe_reversal_failed",
    message:
      "Nu am putut recupera suma de la vendor în Stripe. Rambursarea clientului NU a fost efectuată. Verifică soldul contului Stripe Connect al vendorului.",
  });
} {
        return res
          .status(409)
          .json({
            error:
              "stripe_reversal_failed",

            message:
              "Nu am putut recupera suma de la vendor în Stripe. Rambursarea clientului NU a fost efectuată. Verifică soldul contului Stripe Connect al vendorului.",
          });
      }

      return res
        .status(500)
        .json({
          error:
            "admin_order_refund_failed",

          message:
            error?.message ||
            "Rambursarea nu a putut fi procesată.",
        });
    }
  }
);

export default router;
