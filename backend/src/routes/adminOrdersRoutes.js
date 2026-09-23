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
import {
  computeVendorEarningForShipment,
  buildAttributionCommissionPreview,
} from "./vendorOrdersRoutes.js";
import {
  restoreStockFromItems,
} from "../services/stockRestore.js";
import {
  refundCardOrderFully,
} from "../services/orderRefundService.js";
import {
  expirePendingDepositsForOrder,
} from "../services/depositInvalidation.js";
import {
  expireOrderCheckoutSession,
} from "../services/orderPaymentGuards.js";

const router = Router();

// Doar ADMIN
router.use(
  authRequired,
  requireRole("ADMIN")
);

const normalizeText = (value = "") =>
  String(value || "").trim();

const isPostgres =
  (process.env.DATABASE_URL || "").startsWith("postgres://") ||
  (process.env.DATABASE_URL || "").startsWith("postgresql://");

function round2(value) {
  return Number.parseFloat(Number(value || 0).toFixed(2));
}

/*
 * Calcul financiar per shipment pentru Admin Order Details - REUTILIZEAZĂ
 * exact aceeași sursă ca vendorul (computeVendorEarningForShipment,
 * buildAttributionCommissionPreview din vendorOrdersRoutes.js) - NU o
 * a doua logică financiară.
 *
 * Dacă există deja o intrare CONFIRMATĂ în ledger (VendorEarningEntry,
 * creată la DELIVERED/IN_TRANSIT), aceea e sursa de adevăr (+ REFUND
 * netat, dacă a fost returnată) - identic ca strategie cu GET
 * /api/vendor/orders/:id. Altfel, preview live.
 */
async function buildShipmentFinancialsForAdmin(shipment) {
  try {
    const confirmedSale = await prisma.vendorEarningEntry.findUnique({
      where: { shipmentId: shipment.id },
    });

    let vendorFinancials;

    if (confirmedSale) {
      let confirmedRefund = null;

      if (isPostgres) {
        confirmedRefund = await prisma.vendorEarningEntry.findFirst({
          where: {
            vendorId: shipment.vendorId,
            type: "REFUND",
            meta: { path: ["refShipmentId"], equals: shipment.id },
          },
        });
      } else {
        const lastRefunds = await prisma.vendorEarningEntry.findMany({
          where: { vendorId: shipment.vendorId, type: "REFUND" },
          orderBy: { createdAt: "desc" },
          take: 50,
        });

        confirmedRefund =
          lastRefunds.find((r) => r?.meta?.refShipmentId === shipment.id) ||
          null;
      }

      vendorFinancials = {
        itemsNet: round2(
          Number(confirmedSale.itemsNet || 0) +
            Number(confirmedRefund?.itemsNet || 0)
        ),
        commissionNet: round2(
          Number(confirmedSale.commissionNet || 0) +
            Number(confirmedRefund?.commissionNet || 0)
        ),
        vendorNet: round2(
          Number(confirmedSale.vendorNet || 0) +
            Number(confirmedRefund?.vendorNet || 0)
        ),
        commissionBps: confirmedSale.meta?.commissionBps ?? null,
        commissionSource: confirmedSale.meta?.commissionSource ?? null,
        /*
         * Comision MIXT (audit 2026-09-14) - snapshot din ledger,
         * identic ca sursă cu Vendor Order Details.
         */
        isMixedCommission: Boolean(confirmedSale.meta?.isMixedCommission),
        commissionGroups: confirmedSale.meta?.commissionGroups ?? null,
        platformDiscountGross:
          confirmedSale.meta?.platformDiscountGross ?? null,
        vendorDiscountGross:
          confirmedSale.meta?.vendorDiscountGross ?? null,
        commissionBaseGross:
          confirmedSale.meta?.commissionBaseGross ?? null,
        commissionBase: confirmedSale.meta?.commissionBase ?? null,
        commissionAmount: confirmedSale.meta?.commissionAmount ?? null,
        platformSubsidyAmount:
          confirmedSale.meta?.platformSubsidyAmount ?? null,
        isReversed: Boolean(confirmedRefund),
        isSnapshot: true,
      };
    } else {
      const live = await computeVendorEarningForShipment({
        vendorId: shipment.vendorId,
        shipmentId: shipment.id,
      });

      vendorFinancials = {
        ...live,
        isReversed: false,
        isSnapshot: false,
      };
    }

    const influencerCommission = await buildAttributionCommissionPreview({
      type: "INFLUENCER",
      name: shipment.influencer?.displayName,
      commissionBpsSnapshot: shipment.influencerCommissionBpsSnapshot,
      ledgerModel: prisma.influencerEarningEntry,
      shipmentId: shipment.id,
      liveArtfestCommissionNet: vendorFinancials.commissionNet,
    });

    const vendorReferralCommission = await buildAttributionCommissionPreview({
      type: "VENDOR_REFERRAL",
      name: shipment.referrerVendor?.displayName,
      commissionBpsSnapshot: shipment.referrerVendorCommissionBpsSnapshot,
      ledgerModel: prisma.vendorReferralEarningEntry,
      shipmentId: shipment.id,
      liveArtfestCommissionNet: vendorFinancials.commissionNet,
    });

    vendorFinancials.netArtfestAfterAttribution = round2(
      Number(vendorFinancials.commissionNet || 0) -
        Number(influencerCommission?.amount || 0) -
        Number(vendorReferralCommission?.amount || 0)
    );

    return { vendorFinancials, influencerCommission, vendorReferralCommission };
  } catch (error) {
    console.error(
      "[adminOrders] buildShipmentFinancialsForAdmin failed:",
      shipment.id,
      error
    );

    return {
      vendorFinancials: null,
      influencerCommission: null,
      vendorReferralCommission: null,
    };
  }
}

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

    refunded:
      meta.refunded === true,

    refundedAt:
      meta.refundedAt ||
      null,

    refundedAmount:
      meta.refundedAmount != null
        ? Number(
            meta.refundedAmount
          )
        : null,

    stripeRefundId:
      meta.stripeRefundId ||
      null,

    refundReversalId:
      meta.refundReversalId ||
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

      /*
       * =====================================================
       * COD + AVANS PLĂTIT - blocăm anularea (audit 2026-09-14)
       * =====================================================
       *
       * Anularea NU trebuie să lase avansul încasat fără refund.
       * Varianta aleasă e cea mai sigură dintre cele două propuse:
       * blocăm anularea și cerem refund avans ÎNTÂI, prin ruta deja
       * idempotentă POST /orders/:id/refund (CAZ 2). NU declanșăm
       * automat refund Stripe de aici - un refund Stripe pornit din
       * mijlocul unei tranzacții de anulare ar putea reuși pe Stripe
       * și eșua la commit-ul DB, lăsând o stare parțială fără
       * recovery clar (exact riscul pe care admin refund CARD l-a
       * avut înainte de fix-ul din runda anterioară).
       */
      const shipmentsWithPaidDeposit =
        (order.shipments || []).filter(
          (shipment) =>
            shipment.depositStatus ===
            "PAID"
        );

      if (
        shipmentsWithPaidDeposit
          .length >
        0
      ) {
        return res
          .status(409)
          .json({
            error:
              "deposit_refund_required_before_cancel",

            message:
              "Această comandă are un avans plătit online. Rambursează avansul (POST /orders/:id/refund) înainte de a anula comanda.",

            shipmentIds:
              shipmentsWithPaidDeposit.map(
                (shipment) =>
                  shipment.id
              ),
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
           * Restaurăm stocul - sursă canonică unică
           * (src/services/stockRestore.js), aceeași folosită și de
           * vendor cancel și user cancel. Regulă (audit 2026-09-14):
           * doar produse ÎN CONTINUARE stock-tracked (readyQty!==null)
           * aflate în READY/SOLD_OUT - MADE_TO_ORDER/PREORDER nu sunt
           * niciodată atinse.
           */
          const allItems =
            order.shipments.flatMap(
              (shipment) =>
                shipment.items || []
            );

          await restoreStockFromItems(
            tx,
            allItems
          );

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

      /*
       * Avans COD încă PENDING: după anulare nu mai trebuie să poată fi
       * plătit (DB + sesiune Stripe). Non-blocant.
       */
      try {
        await expirePendingDepositsForOrder({
          orderId:
            order.id,
          reason:
            "order_cancelled",
          prisma,
          stripe,
        });
      } catch (depositError) {
        console.error(
          "ADMIN cancel: expire pending deposits failed:",
          order.id,
          depositError
        );
      }

      /*
       * Comandă CARD neplătită: expirăm sesiunea Stripe Checkout deschisă
       * (plata târzie rămâne acoperită de webhook). Non-blocant.
       */
      if (
        String(order.paymentMethod || "").toUpperCase() === "CARD" &&
        !order.paidAt &&
        order.status !== "PAID" &&
        order.stripeCheckoutSessionId
      ) {
        await expireOrderCheckoutSession({
          sessionId:
            order.stripeCheckoutSessionId,
          stripe,
        });
      }

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
   GET /api/admin/withdrawals

   Vizibilitate MINIMĂ pentru Admin asupra declarațiilor de retragere
   din contract (audit 2026-09-23, punctul 7) - listă simplă, fără
   workflow/acțiuni. Strict citire - nu modifică nimic.
----------------------------------------------------- */
router.get("/withdrawals", async (req, res) => {
  try {
    const requests = await prisma.withdrawalRequest.findMany({
      orderBy: { submittedAt: "desc" },
      take: 200,
      select: {
        id: true,
        orderId: true,
        shipmentIds: true,
        clientName: true,
        contactEmail: true,
        status: true,
        submittedAt: true,
        order: {
          select: {
            orderNumber: true,
            shipments: {
              select: {
                id: true,
                vendorId: true,
                vendor: { select: { displayName: true } },
              },
            },
          },
        },
      },
    });

    const items = requests.map((request) => {
      const ids = request.shipmentIds || [];
      const coversWholeOrder = !ids.length;

      const relevantShipments = coversWholeOrder
        ? request.order?.shipments || []
        : (request.order?.shipments || []).filter((s) => ids.includes(s.id));

      const vendorNames = [
        ...new Set(
          relevantShipments
            .map((s) => s.vendor?.displayName)
            .filter(Boolean)
        ),
      ];

      return {
        id: request.id,
        orderId: request.orderId,
        orderNumber: request.order?.orderNumber || null,
        clientName: request.clientName,
        contactEmail: request.contactEmail,
        status: request.status,
        submittedAt: request.submittedAt,
        coversWholeOrder,
        shipmentIds: ids,
        vendorNames,
      };
    });

    return res.json({ ok: true, items });
  } catch (error) {
    console.error("GET /api/admin/withdrawals FAILED:", error);
    return res.status(500).json({
      ok: false,
      error: "withdrawals_list_failed",
      message: "Lista de cereri de retragere nu a putut fi încărcată.",
    });
  }
});

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

                influencer: {
                  select: {
                    id: true,
                    displayName: true,
                  },
                },

                referrerVendor: {
                  select: {
                    id: true,
                    displayName: true,
                  },
                },

                campaign: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
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
const shipmentFinancialsById = new Map(
  await Promise.all(
    (safeOrder.shipments || []).map(async (shipment) => [
      shipment.id,
      await buildShipmentFinancialsForAdmin(shipment),
    ])
  )
);

const safeShipments =
  (safeOrder.shipments || []).map(
    (shipment) => ({
      ...shipment,

      deposit:
        getDepositAdminData(
          shipment
        ),

      ...(shipmentFinancialsById.get(shipment.id) || {}),
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
        /*
         * Logica CARD (transfer reversal către vendori + refund client +
         * reversal ledger) e acum în serviciul partajat, refolosit și de
         * anularea comenzii de către client (cancelOwnOrder). Comportament
         * identic pentru admin: aceleași chei de idempotență, aceeași
         * metadata Stripe, aceeași notă de audit.
         */
        const who =
          req.user?.email ||
          req.user?.id ||
          req.user?.sub ||
          "admin";

        const result =
          await refundCardOrderFully({
            order,
            actor: who,
            prisma,
            stripe,
          });

        return res
          .status(result.status)
          .json(result.body);
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
        const relevantDepositShipments =
          (
            order.shipments ||
            []
          ).filter(
            (shipment) =>
              (
                shipment.depositStatus ===
                  "PAID" ||
                shipment.depositStatus ===
                  "REFUNDED"
              ) &&
              shipment
                .stripeDepositChargeId
          );

        if (
          !relevantDepositShipments
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
          relevantDepositShipments
        ) {
          /*
           * Retry idempotent: avansul acestui
           * shipment a fost deja rambursat
           * complet într-un apel anterior - NU
           * mai atingem Stripe din nou, doar
           * raportăm starea curentă (identică
           * cu tratarea alreadyRefundedByStripe
           * de la CARD).
           */
          if (
            shipment.depositStatus ===
            "REFUNDED"
          ) {
            const meta =
              shipment.depositMeta &&
              typeof shipment.depositMeta ===
                "object" &&
              !Array.isArray(
                shipment.depositMeta
              )
                ? shipment.depositMeta
                : {};

            refundedDeposits.push({
              shipmentId:
                shipment.id,

              vendorId:
                shipment.vendorId,

              stripeRefundId:
                meta.stripeRefundId ||
                null,

              reversalId:
                meta.refundReversalId ||
                null,

              refundedAmount:
                meta.refundedAmount ??
                null,

              alreadyRefunded:
                true,
            });

            continue;
          }

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

          /*
           * =====================================================
           * RESET AVANS DUPĂ REFUND (audit 2026-09-14)
           * =====================================================
           *
           * depositStatus -> REFUNDED (valoare deja existentă în
           * enum-ul PaymentDepositStatus, nefolosită până acum).
           *
           * depositPaidAmount -> null, la fel ca la
           * NOT_REQUESTED/PENDING (vezi request-deposit route) -
           * avansul nu mai este considerat plătit.
           *
           * remainingCodAmount -> recalculat cu FORMULA EXISTENTĂ
           * (request-deposit route: productsTotal + shippingAmount -
           * depositRequestedAmount), fără să hardcodăm nicio sumă și
           * fără să recalculăm productsTotal/shippingAmount din
           * items (risc de drift) - folosim direct relația inversă
           * cu valorile deja stocate pe shipment: adăugăm înapoi
           * exact suma avansului care tocmai a fost scăzută
           * (depositRequestedAmount == suma efectiv plătită,
           * validată la webhook cu toleranță de 1 ban).
           */
          const restoredRemainingCodAmount =
            round2(
              Number(
                shipment.remainingCodAmount ||
                  0
              ) +
                Number(
                  shipment.depositRequestedAmount ||
                    0
                )
            );

          await prisma.shipment.update({
            where: {
              id:
                shipment.id,
            },

            data: {
              depositStatus:
                "REFUNDED",

              depositPaidAmount:
                null,

              remainingCodAmount:
                restoredRemainingCodAmount,

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

            depositStatus:
              "REFUNDED",

            remainingCodAmount:
              restoredRemainingCodAmount,
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
            "Avansul plătit online a fost rambursat clientului, iar transferul către vendor a fost reversat. Restul de încasat la livrare a fost recalculat ca și cum avansul nu ar fi fost plătit.",
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
