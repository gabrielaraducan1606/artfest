// backend/src/routes/userOrdersRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { sendOrderCancelledByUserNotifications } from "../services/orderMessaging.js";
import { sendOrderCancelledByUserEmail } from "../lib/mailer.js";
import {
  createDepositPaymentForShipment,
} from "../payments/orchestrator.js";

const router = Router();

/* ----------------------------------------------------
   Middleware global: doar user logat (indiferent de rol)
----------------------------------------------------- */
router.use(authRequired);

/* ----------------------------------------------------
   Helper: map OrderStatus + ShipmentStatus -> UI status
   UI: PENDING | PROCESSING | SHIPPED | DELIVERED | CANCELED | RETURNED
----------------------------------------------------- */
function computeUiStatus(order, shipments = []) {
  const orderStatus = order?.status || null; // PENDING / PAID / CANCELLED / FULFILLED
  const shipmentStatuses = shipments.map((s) => s.status);

  // 1) dacă avem shipments, derivăm din ele (au prioritate)
  if (shipmentStatuses.length) {
    // retur real are prioritate
    if (shipmentStatuses.some((st) => st === "RETURNED")) return "RETURNED";

    // anulare vendor / colet neexpediat
    if (shipmentStatuses.some((st) => st === "REFUSED")) return "CANCELED";

    // livrat doar dacă toate sunt livrate
    if (shipmentStatuses.every((st) => st === "DELIVERED")) return "DELIVERED";

    // SHIPPED doar când chiar există AWB / ridicat / în tranzit
    if (shipmentStatuses.some((st) => ["AWB", "IN_TRANSIT"].includes(st))) return "SHIPPED";

    // PROCESSING include și “pickup cerut”
    if (
      shipmentStatuses.some((st) =>
        ["PREPARING", "READY_FOR_PICKUP", "PICKUP_SCHEDULED"].includes(st)
      )
    )
      return "PROCESSING";

    if (shipmentStatuses.some((st) => st === "PENDING")) return "PENDING";
  }

  // 2) dacă order e CANCELLED și NU avem shipments relevante, override UI
  if (orderStatus === "CANCELLED") return "CANCELED";

  // 3) fallback din OrderStatus
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

function computeShippingStage(shipments = []) {
  const st = shipments.map((s) => s.status);

  // pickup cerut / programat (fără AWB)
  if (st.some((x) => ["READY_FOR_PICKUP", "PICKUP_SCHEDULED"].includes(x))) {
    return { code: "AWAITING_COURIER_PICKUP", label: "Urmează să fie predată curierului" };
  }

  if (st.some((x) => x === "AWB")) {
    return { code: "AWB_ISSUED", label: "AWB emis – pregătită de expediere" };
  }

  if (st.some((x) => x === "IN_TRANSIT")) {
    return { code: "IN_TRANSIT", label: "Predată curierului" };
  }

  if (st.length > 0 && st.every((x) => x === "DELIVERED")) {
    return { code: "DELIVERED", label: "Livrată" };
  }

  return null;
}

/* ----------------------------------------------------
   Helper: este anulabilă comanda?
   - nu e deja CANCELLED/FULFILLED
   - niciun shipment nu a depășit PENDING
----------------------------------------------------- */
function isOrderCancellable(order, shipments = []) {
  const orderStatus = order?.status || null;

  // dacă e deja CANCELLED sau FULFILLED, clar nu
  if (["CANCELLED", "FULFILLED"].includes(orderStatus)) return false;

  // dacă vreun shipment este deja trecut de PENDING -> nu mai e anulabilă
  const hasStartedOrBeyond = shipments.some((s) =>
    [
      "PREPARING",
      "READY_FOR_PICKUP",
      "AWB",
      "IN_TRANSIT",
      "PICKUP_SCHEDULED",
      "DELIVERED",
      "RETURNED",
      "REFUSED",
    ].includes(s.status)
  );

  if (hasStartedOrBeyond) return false;

  return true;
}

function parseStatusList(statusParam) {
  return statusParam
    ? String(statusParam)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

function toInsensitiveContains(q) {
  return { contains: q, mode: "insensitive" };
}

function computeTotalsCents(order) {
  const currency = order.currency || "RON";
  const subtotal = Number(order.subtotal || 0);
  const shippingTotal = Number(order.shippingTotal || 0);
  const total = Number(order.total || subtotal + shippingTotal);
  return { currency, totalCents: Math.round(total * 100) };
}

function serializeShipmentDeposit(
  shipment
) {
  if (!shipment) {
    return null;
  }

  return {
    shipmentId:
      shipment.id,

    status:
      shipment.depositStatus ||
      "NOT_REQUESTED",

    percent:
      shipment.depositPercent !=
      null
        ? Number(
            shipment.depositPercent
          )
        : null,

    requestedAmount:
      shipment.depositRequestedAmount !=
      null
        ? Number(
            shipment.depositRequestedAmount
          )
        : null,

    paidAmount:
      shipment.depositPaidAmount !=
      null
        ? Number(
            shipment.depositPaidAmount
          )
        : null,

    remainingCodAmount:
      shipment.remainingCodAmount !=
      null
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

    payable:
      shipment.depositStatus ===
        "PENDING" &&
      (
        !shipment.depositExpiresAt ||
        new Date(
          shipment.depositExpiresAt
        ).getTime() >
          Date.now()
      ),
  };
}

function getOrderDeposits(
  shipments = []
) {
  return shipments
    .map(
      serializeShipmentDeposit
    )
    .filter(
      (deposit) =>
        deposit &&
        deposit.status !==
          "NOT_REQUESTED"
    );
}

function getActiveOrderDeposit(
  shipments = []
) {
  const deposits =
    getOrderDeposits(
      shipments
    );

  return (
    deposits.find(
      (deposit) =>
        deposit.status ===
        "PENDING"
    ) ||
    deposits.find(
      (deposit) =>
        deposit.status ===
        "PAID"
    ) ||
    deposits.find(
      (deposit) =>
        deposit.status ===
        "FAILED"
    ) ||
    deposits.find(
      (deposit) =>
        deposit.status ===
        "EXPIRED"
    ) ||
    deposits[0] ||
    null
  );
}

/* ----------------------------------------------------
   GET /api/user/orders/my
   Optimized:
   - query + paginare în DB (skip/take)
   - select minimal (nu include tot)
   - filtrare UI status în memorie cu "overfetch" ca să umple pagina
----------------------------------------------------- */
router.get("/my", async (req, res) => {
  const userId = req.user.sub;

  const q = String(req.query.q || "").trim();
  const statusParam = String(req.query.status || ""); // ex: "PENDING,PROCESSING,SHIPPED"
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));

  const statusList = parseStatusList(statusParam);

  // where în DB (cât se poate)
  const where = {
    userId,
    ...(q
      ? {
          OR: [
            { orderNumber: toInsensitiveContains(q) },
            // id e cuid, de obicei nu e căutat, dar păstrăm funcțional
            { id: toInsensitiveContains(q) },
            {
              shipments: {
                some: {
                  items: {
                    some: {
                      title: toInsensitiveContains(q),
                    },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  // total rapid (pentru paginare UI). Atenție: acest total NU ține cont de uiStatus derivat.
  // Dacă vrei total exact per tab, ai nevoie de denormalizare uiStatus sau de logică de numărare (scump).
  // Practic, front-ul tău calculează totalPages din total; ca să nu “mintă” prea tare, îl facem "best-effort":
  // - dacă nu ai statusList => total e exact
  // - dacă ai statusList => total e aproximativ (maxim), dar hasMore îl controlăm din fetch real
  const totalDb = await prisma.order.count({ where });

  // OVERFETCH ca să putem filtra pe uiStatus (derivat din shipments) dar să nu citim tot
  const INTERNAL_CHUNK = Math.min(200, limit * 8); // ex: limit 10 => 80
  const startIndexWanted = (page - 1) * limit;

  let collected = [];
  let scanned = 0;
  let skip = 0;

  // ca să ajungem la "pagina N" după filtrare, trebuie să sărim primele startIndexWanted rezultate filtrate
  let filteredOffsetToSkip = startIndexWanted;

  // limităm bucla ca să nu fie infinită dacă filtrele sunt foarte restrictive
  const MAX_LOOPS = 25;

  for (let loop = 0; loop < MAX_LOOPS; loop++) {
    const rows = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: INTERNAL_CHUNK,
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        status: true,
        currency: true,
        subtotal: true,
        shippingTotal: true,
        total: true,
        shippingAddress: true,
       shipments: {
  select: {
    id:
      true,

    status:
      true,

    depositStatus:
      true,

    depositPercent:
      true,

    depositRequestedAmount:
      true,

    depositPaidAmount:
      true,

    remainingCodAmount:
      true,

    depositRequestedAt:
      true,

    depositPaidAt:
      true,

    depositExpiresAt:
      true,

         items: {
  select: {
    id: true,

    productId: true,

    title: true,

    qty: true,

    price: true,

    originalPrice: true,

    discountAmount: true,

    promoCollectionId: true,

    promoFundingSource: true,

   selectedOptions: true,
customAnswers: true,
repeatedGroupAnswers: true,
configurationKey: true,
  },
},
          },
        },
      },
    });

    if (!rows.length) break;

    skip += rows.length;
    scanned += rows.length;

    // colectăm productIds doar din chunk-ul curent (și doar dacă avem nevoie)
    const productIdSet = new Set();
    for (const o of rows) {
      for (const s of o.shipments) {
        for (const it of s.items) {
          if (it.productId) productIdSet.add(it.productId);
        }
      }
    }

    let imageMap = new Map();
    if (productIdSet.size) {
      const products = await prisma.product.findMany({
        where: { id: { in: Array.from(productIdSet) } },
        select: { id: true, images: true },
      });

      imageMap = new Map(
        products.map((p) => [p.id, Array.isArray(p.images) && p.images[0] ? p.images[0] : null])
      );
    }

    // map + filtrare uiStatus în memorie
    for (const o of rows) {
      const uiStatus = computeUiStatus(o, o.shipments);
      if (statusList.length && !statusList.includes(uiStatus)) continue;

      // "skip" pentru pagina cerută după filtrare
      if (filteredOffsetToSkip > 0) {
        filteredOffsetToSkip--;
        continue;
      }

      const shippingStage = computeShippingStage(o.shipments);
      const returnEligible = uiStatus === "DELIVERED";

      const { currency, totalCents } = computeTotalsCents(o);

      const addr = o.shippingAddress || {};
      const isCompany = !!(addr.companyName || addr.companyCui);
      const customerType = isCompany ? "PJ" : "PF";

   const flatItems =
  o.shipments.flatMap(
    (shipment) =>
      shipment.items.map(
        (item) => {
          const price =
            Number(
              item.price || 0
            );

          const originalPrice =
            item.originalPrice != null
              ? Number(
                  item.originalPrice
                )
              : null;

          const hasDiscount =
            originalPrice != null &&
            originalPrice > price;

          const discountPercent =
            hasDiscount &&
            originalPrice > 0
              ? Math.round(
                  (
                    (
                      originalPrice -
                      price
                    ) /
                    originalPrice
                  ) * 100
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
                price * 100
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

            discountAmount:
              Number(
                item.discountAmount ||
                  0
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
  item.repeatedGroupAnswers || {},

            configurationKey:
              item.configurationKey ||
              null,

            image:
              item.productId
                ? imageMap.get(
                    item.productId
                  ) || null
                : null,

            shipmentId:
              shipment.id,
          };
        }
      )
  );
const deposits =
  getOrderDeposits(
    o.shipments
  );

const activeDeposit =
  getActiveOrderDeposit(
    o.shipments
  );

collected.push({
  id:
    o.id,

  orderNumber:
    o.orderNumber ||
    null,

  createdAt:
    o.createdAt,

  status:
    uiStatus,

  totalCents,

  currency,

  items:
    flatItems,

  cancellable:
    isOrderCancellable(
      o,
      o.shipments
    ),

  customerType,

  shippingAddress:
    addr,

  shippingStage,

  returnEligible,

  deposits,

  deposit:
    activeDeposit,
});

      if (collected.length >= limit) break;
    }

    if (collected.length >= limit) break;
  }

  // hasMore “real” pentru pagina curentă: dacă am reușit să umplem pagina și încă mai există date în DB,
  // e probabil că există next. Mai corect: mai încercăm să vedem dacă există încă măcar 1 rezultat filtrat după colectare.
  // (nu facem extra query; folosim un heuristic ok)
  const hasMore = collected.length === limit && scanned < totalDb;

  res.json({
    // total: exact doar când nu ai statusList; altfel e best-effort (maxim posibil din DB)
    total: statusList.length ? totalDb : totalDb,
    items: collected,
    hasMore, // extra (front-ul tău nu-l folosește acum, dar e util)
  });
});

/* ----------------------------------------------------
   GET /api/user/orders/:id
----------------------------------------------------- */
router.get(
  "/:id",
  async (req, res) => {
    try {
      const userId =
        req.user.sub;

      const ref =
        String(
          req.params.id ||
            ""
        ).trim();

      const order =
        await prisma.order.findFirst({
          where: {
            userId,

            OR: [
              {
                id:
                  ref,
              },

              {
                orderNumber:
                  ref,
              },
            ],
          },

          include: {
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
          },
        });

      if (!order) {
        return res.status(404).json({
          error:
            "not_found",

          message:
            "Comanda nu a fost găsită.",
        });
      }

      const status =
        computeUiStatus(
          order,
          order.shipments
        );

      const shippingStage =
        computeShippingStage(
          order.shipments
        );

      const returnEligible =
        status ===
        "DELIVERED";

      const currency =
        order.currency ||
        "RON";

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

      const subtotalCents =
        Math.round(
          subtotal *
            100
        );

      const shippingCents =
        Math.round(
          shippingTotal *
            100
        );

      const totalCents =
        Math.round(
          total *
            100
        );

      const address =
        order.shippingAddress ||
        {};

      const isCompany =
        Boolean(
          address.companyName ||
            address.companyCui
        );

      const customerType =
        isCompany
          ? "PJ"
          : "PF";

      const productIdSet =
        new Set();

      for (
        const shipment of
        order.shipments
      ) {
        for (
          const item of
          shipment.items
        ) {
          if (
            item.productId
          ) {
            productIdSet.add(
              item.productId
            );
          }
        }
      }

      let imageMap =
        new Map();

      if (
        productIdSet.size
      ) {
        const products =
          await prisma.product.findMany({
            where: {
              id: {
                in:
                  Array.from(
                    productIdSet
                  ),
              },
            },

            select: {
              id:
                true,

              images:
                true,
            },
          });

        imageMap =
          new Map(
            products.map(
              (product) => [
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
      }

      const flatItems =
        order.shipments.flatMap(
          (shipment) =>
            shipment.items.map(
              (item) => {
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

                  discountAmount:
                    Number(
                      item.discountAmount ||
                        0
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

                  configurationKey:
                    item.configurationKey ||
                    null,

                  image:
                    item.productId
                      ? imageMap.get(
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

      const deposits =
        getOrderDeposits(
          order.shipments
        );

      const activeDeposit =
        getActiveOrderDeposit(
          order.shipments
        );

      return res.json({
        id:
          order.id,

        orderNumber:
          order.orderNumber ||
          null,

        createdAt:
          order.createdAt,

        status,

        shippingStage,

        returnEligible,

        currency,

        subtotal,

        shippingTotal,

        total,

        subtotalCents,

        shippingCents,

        totalCents,

        shippingAddress:
          address,

        customerType,

        items:
          flatItems,

        deposits,

        deposit:
          activeDeposit,

        shipments:
          order.shipments.map(
            (shipment) => ({
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
                  : shipment.vendorId
                  ? "Artizan"
                  : null,

              deposit:
                serializeShipmentDeposit(
                  shipment
                ),

              storeAddress:
                shipment.vendor
                  ? {
                      name:
                        shipment.vendor
                          .displayName ||
                        "Magazin",

                      street:
                        shipment.vendor
                          .address ||
                        "",

                      city:
                        shipment.vendor
                          .city ||
                        "",

                      county:
                        address.county ||
                        "",

                      postalCode:
                        address.postalCode ||
                        "",

                      country:
                        "România",
                    }
                  : null,
            })
          ),

        cancellable:
          isOrderCancellable(
            order,
            order.shipments
          ),
      });
    } catch (error) {
      console.error(
        "GET /api/user/orders/:id failed:",
        error
      );

      return res.status(500).json({
        error:
          "order_read_failed",

        message:
          "Nu am putut încărca această comandă.",
      });
    }
  }
);

/* ----------------------------------------------------
   POST /api/user/orders/:orderId/shipments/:shipmentId/pay-deposit
----------------------------------------------------- */
router.post(
  "/:orderId/shipments/:shipmentId/pay-deposit",
  async (req, res) => {
    try {
      const userId =
        req.user.sub;

      const orderId =
        String(
          req.params.orderId ||
            ""
        ).trim();

      const shipmentId =
        String(
          req.params.shipmentId ||
            ""
        ).trim();

      const shipment =
        await prisma.shipment.findFirst({
          where: {
            id:
              shipmentId,

            orderId,

            order: {
              userId,
            },
          },

          select: {
            id:
              true,

            orderId:
              true,

            depositStatus:
              true,

            depositRequestedAmount:
              true,

            depositPaidAmount:
              true,

            depositExpiresAt:
              true,

            depositMeta:
              true,

            stripeDepositSessionId:
              true,
          },
        });

      if (!shipment) {
        return res.status(404).json({
          error:
            "deposit_not_found",

          message:
            "Solicitarea de avans nu a fost găsită.",
        });
      }

      if (
        shipment.depositStatus ===
        "PAID"
      ) {
        return res.status(409).json({
          error:
            "deposit_already_paid",

          message:
            "Avansul a fost deja achitat.",
        });
      }

      if (
        shipment.depositStatus !==
        "PENDING"
      ) {
        return res.status(409).json({
          error:
            "deposit_not_payable",

          message:
            shipment.depositStatus ===
            "EXPIRED"
              ? "Solicitarea de avans a expirat."
              : "Acest avans nu poate fi achitat în starea actuală.",
        });
      }

      const expired =
        shipment.depositExpiresAt &&
        new Date(
          shipment.depositExpiresAt
        ).getTime() <=
          Date.now();

      if (expired) {
        await prisma.shipment.updateMany({
          where: {
            id:
              shipment.id,

            depositStatus:
              "PENDING",
          },

          data: {
            depositStatus:
              "EXPIRED",

            depositPaymentError:
              "deposit_expired",
          },
        });

        return res.status(409).json({
          error:
            "deposit_expired",

          message:
            "Solicitarea de avans a expirat. Vânzătorul trebuie să trimită o solicitare nouă.",
        });
      }
const payment =
  await createDepositPaymentForShipment({
    shipmentId:
      shipment.id,
  });

if (!payment?.url) {
  return res.status(500).json({
    error:
      "deposit_checkout_missing",

    message:
      "Nu am putut deschide plata avansului.",
  });
}

return res.json({
  ok:
    true,

  shipmentId:
    shipment.id,

  orderId:
    shipment.orderId,

  amount:
    shipment.depositRequestedAmount !=
    null
      ? Number(
          shipment.depositRequestedAmount
        )
      : null,

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
        "POST user pay deposit failed:",
        error
      );

      return res.status(500).json({
        error:
          "deposit_payment_open_failed",

        message:
          "Nu am putut deschide plata avansului.",
      });
    }
  }
);

/* ----------------------------------------------------
   POST /api/user/orders/:id/cancel
----------------------------------------------------- */
router.post("/:id/cancel", async (req, res) => {
  const userId = req.user.sub;
  const id = String(req.params.id);

  const o = await prisma.order.findFirst({
    where: {
      id,
      userId,
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

      user: true,
    },
  });

  if (!o) {
    return res.status(404).json({
      error: "not_found",
      message: "Comanda nu a fost găsită.",
    });
  }

  const uiStatus = computeUiStatus(
    o,
    o.shipments
  );

  if (
    !["PENDING", "PROCESSING"].includes(
      uiStatus
    ) ||
    !isOrderCancellable(
      o,
      o.shipments
    )
  ) {
    return res.status(409).json({
      error: "not_cancellable",
      message:
        "Comanda nu mai poate fi anulată în această etapă.",
    });
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        /*
         * Schimbăm condiționat shipment-urile.
         * Astfel doar prima anulare reușește.
         */
        const updated =
          await tx.shipment.updateMany({
            where: {
              orderId: o.id,
              status: "PENDING",
            },

            data: {
              status: "REFUSED",
              refusedAt: new Date(),
              cancelReason:
                "Anulată de client",
              cancelReasonNote:
                null,
            },
          });

        if (
          updated.count !==
          o.shipments.length
        ) {
          throw new Error(
            "order_already_changed"
          );
        }

        /*
         * Adunăm cantitățile pe produs
         * din toate shipment-urile.
         */
        const qtyByProductId =
          new Map();

        for (
          const shipment
          of o.shipments
        ) {
          for (
            const item
            of shipment.items || []
          ) {
            if (!item.productId) {
              continue;
            }

            const qty = Number(
              item.qty || 0
            );

            if (
              !Number.isInteger(qty) ||
              qty <= 0
            ) {
              continue;
            }

            qtyByProductId.set(
              item.productId,
              (
                qtyByProductId.get(
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
          ] of qtyByProductId
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
            id: o.id,
          },

          data: {
            status: "CANCELLED",
          },
        });
      }
    );
  } catch (error) {
    console.error(
      "User cancel order failed:",
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
        "order_cancel_failed",
      message:
        "Comanda nu a putut fi anulată.",
    });
  }

  try {
    await sendOrderCancelledByUserNotifications({
      orderId: o.id,
      userId,
    });
  } catch (error) {
    console.error(
      "sendOrderCancelledByUserNotifications failed:",
      error
    );
  }

  try {
    const to =
      o.user?.email ||
      o.shippingAddress?.email ||
      null;

    if (to) {
      await sendOrderCancelledByUserEmail({
        to,
        order: o,
      });
    }
  } catch (error) {
    console.error(
      "sendOrderCancelledByUserEmail failed:",
      error
    );
  }

  return res.json({
    ok: true,
  });
});

/* ----------------------------------------------------
   POST /api/user/orders/:id/reorder
----------------------------------------------------- */
router.post(
  "/:id/reorder",
  async (req, res) => {
    const userId =
      req.user.sub;

    const id =
      String(
        req.params.id || ""
      ).trim();

    const order =
      await prisma.order.findFirst({
        where: {
          userId,

          OR: [
            {
              id,
            },
            {
              orderNumber:
                id,
            },
          ],
        },

        include: {
          shipments: {
            include: {
              items:
                true,
            },
          },
        },
      });

    if (!order) {
      return res.status(
        404
      ).json({
        error:
          "not_found",

        message:
          "Comanda nu a fost găsită.",
      });
    }

    const allItems =
      order.shipments.flatMap(
        (shipment) =>
          shipment.items ||
          []
      );

    if (!allItems.length) {
      return res.status(
        409
      ).json({
        error:
          "order_has_no_items",

        message:
          "Comanda nu conține produse care pot fi adăugate din nou în coș.",
      });
    }

    const productIds =
      Array.from(
        new Set(
          allItems
            .map(
              (item) =>
                item.productId
            )
            .filter(Boolean)
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

              orderMode:
                true,

              availability:
                true,

              readyQty:
                true,

              isActive:
                true,

              isHidden:
                true,

              moderationStatus:
                true,
            },
          })
        : [];

    const productsById =
      new Map(
        products.map(
          (product) => [
            product.id,
            product,
          ]
        )
      );

    let added = 0;
    let skipped = 0;

    for (
      const item of
      allItems
    ) {
      if (
        !item.productId
      ) {
        skipped++;
        continue;
      }

      const product =
        productsById.get(
          item.productId
        );

      /*
       * Nu readăugăm produse șterse,
       * ascunse, neaprobate, epuizate
       * sau disponibile doar prin ofertă.
       */
      if (
        !product ||
        product.isActive !==
          true ||
        product.isHidden ===
          true ||
        product.moderationStatus !==
          "APPROVED" ||
        product.availability ===
          "SOLD_OUT" ||
        String(
          product.orderMode ||
            ""
        ).toUpperCase() ===
          "QUOTE_ONLY"
      ) {
        skipped++;
        continue;
      }

      const qty =
        Math.min(
          99,
          Math.max(
            1,
            Number.parseInt(
              item.qty,
              10
            ) || 1
          )
        );

      const selectedOptions =
        item.selectedOptions &&
        typeof item.selectedOptions ===
          "object" &&
        !Array.isArray(
          item.selectedOptions
        )
          ? item.selectedOptions
          : {};

      const customAnswers =
        item.customAnswers &&
        typeof item.customAnswers ===
          "object" &&
        !Array.isArray(
          item.customAnswers
        )
          ? item.customAnswers
          : {};

          const repeatedGroupAnswers =
  item.repeatedGroupAnswers &&
  typeof item.repeatedGroupAnswers === "object" &&
  !Array.isArray(
    item.repeatedGroupAnswers
  )
    ? item.repeatedGroupAnswers
    : {};

      /*
       * Folosim configurația originală.
       *
       * Pentru comenzile vechi care nu aveau
       * configurationKey, folosim id-ul liniei
       * ca identificator stabil, ca să nu unim
       * accidental două personalizări diferite.
       */
      const configurationKey =
        String(
          item.configurationKey ||
            ""
        ).trim() ||
        `reorder:${item.id}`;

      const existing =
        await prisma.cartItem.findUnique({
          where: {
            userId_productId_configurationKey:
              {
                userId,

                productId:
                  item.productId,

                configurationKey,
              },
          },

          select: {
            qty:
              true,
          },
        });

      const currentQty =
        Number(
          existing?.qty ||
            0
        );

      const nextQty =
        Math.min(
          99,
          currentQty +
            qty
        );

      /*
       * Verificăm stocul total al produsului
       * din toate configurațiile din coș.
       */
      if (
        product.readyQty !=
        null
      ) {
        const cartProductQty =
          await prisma.cartItem.aggregate({
            where: {
              userId,

              productId:
                item.productId,
            },

            _sum: {
              qty:
                true,
            },
          });

        const currentProductQty =
          Number(
            cartProductQty
              ?._sum?.qty ||
              0
          );

        const stockLimit =
          Math.max(
            0,
            Number(
              product.readyQty ||
                0
            )
          );

        if (
          currentProductQty +
            qty >
          stockLimit
        ) {
          skipped++;
          continue;
        }
      }

      await prisma.cartItem.upsert({
        where: {
          userId_productId_configurationKey:
            {
              userId,

              productId:
                item.productId,

              configurationKey,
            },
        },

        update: {
  qty: nextQty,

  selectedOptions,

  customAnswers,

  repeatedGroupAnswers,
},

       create: {
  userId,

  productId:
    item.productId,

  qty,

  selectedOptions,

  customAnswers,

  repeatedGroupAnswers,

  configurationKey,
},
      });

      added++;
    }

    if (
      added === 0
    ) {
      return res.status(
        409
      ).json({
        error:
          "no_items_reordered",

        message:
          "Produsele din această comandă nu mai sunt disponibile în forma comandată.",

        added,
        skipped,
      });
    }

    return res.json({
      ok:
        true,

      added,

      skipped,

      message:
        skipped > 0
          ? `${added} produse au fost adăugate în coș, iar ${skipped} au fost omise deoarece nu mai sunt disponibile.`
          : "Produsele au fost adăugate din nou în coș.",
    });
  }
);
export default router;
