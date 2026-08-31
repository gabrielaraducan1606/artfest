// backend/src/routes/vendorOrdersRoutes.js  (ESM)
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { sendOrderCancelledMessage } from "../services/orderMessaging.js";
import {
  createVendorNotification,
  notifyUserOnOrderStatusChange,
  notifyUserOnInvoiceIssued,
  notifyUserOnShipmentPickupScheduled,
  notifyUserDepositRequested,
} from "../services/notifications.js";
import {
  sendShipmentPickupEmail,
  sendOrderConfirmationEmail,
  sendDepositRequestedEmail,
} from "../lib/mailer.js";

import {
  createDepositPaymentForShipment,
} from "../payments/orchestrator.js";
import {
  computeCommissionBreakdown,
} from "../services/commissionCalc.js";

const prisma = new PrismaClient();
const router = express.Router();

function getFrontendUrl() {
  return (
    process.env.APP_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:5173"
  ).replace(/\/+$/, "");
}

// --- SSE: vendor orders updates (in-memory subscribers per vendor)
const vendorSubscribers = new Map(); // vendorId -> Set(res)
const isPostgres =
  (process.env.DATABASE_URL || "").startsWith("postgres://") ||
  (process.env.DATABASE_URL || "").startsWith("postgresql://");

function sseSend(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function sseBroadcastToVendor(vendorId, event, data) {
  const set = vendorSubscribers.get(vendorId);
  if (!set || set.size === 0) return;

  for (const res of Array.from(set)) {
    try {
      sseSend(res, event, data);
    } catch {
      try {
        res.end?.();
      } catch {}
      set.delete(res);
    }
  }

  if (set.size === 0) vendorSubscribers.delete(vendorId);
}

/* ----------------------------------------------------
   Helpers: plan activ + comision
----------------------------------------------------- */
function generateOrderNumber() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AF-${t}-${r}`.slice(0, 32);
}

async function getActivePlanForVendor(vendorId) {
  const now = new Date();

  const sub = await prisma.vendorSubscription.findFirst({
    where: {
      vendorId,
      OR: [
        { status: "active", endAt: { gt: now } },
        { trialEndsAt: { gt: now } },
      ],
    },
    include: { plan: true },
    orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
  });

  if (sub?.plan) return sub.plan;

  const latest = await prisma.vendorSubscription.findFirst({
    where: { vendorId },
    include: { plan: true },
    orderBy: [{ createdAt: "desc" }],
  });

  if (latest?.plan) return latest.plan;

  return { code: "basic", name: "Basic", commissionBps: 0 };
}

function validateBillingGate(billing) {
  const missing = [];
  const isEmpty = (v) => !v || !String(v).trim();

  if (!billing) {
    return {
      ok: false,
      missing: ["datele de facturare"],
    };
  }

  if (isEmpty(billing.sellerType)) missing.push("tipul de vendor");
  if (isEmpty(billing.vendorName)) missing.push("numele vendorului");
  if (isEmpty(billing.address)) missing.push("adresa");
  if (isEmpty(billing.email)) missing.push("emailul de facturare");
  if (isEmpty(billing.contactPerson)) missing.push("persoana de contact");
  if (isEmpty(billing.phone)) missing.push("telefonul de contact");

  if (billing.sellerType === "independent_creator") {
    if (!billing.taxResponsibilityConfirmed) {
      missing.push("confirmarea responsabilității fiscale");
    }

    if (!billing.independentTermsConfirmed) {
      missing.push("acceptarea condițiilor pentru Creator Independent");
    }
  }

  if (billing.sellerType === "verified_business") {
    if (isEmpty(billing.legalType)) missing.push("tip entitate");
    if (isEmpty(billing.companyName)) missing.push("denumirea entității");
    if (isEmpty(billing.cui)) missing.push("CUI");
    if (isEmpty(billing.regCom)) missing.push("Nr. Registrul Comerțului");
    if (isEmpty(billing.vatStatus)) missing.push("status TVA");

    if (billing.vatStatus === "payer" && isEmpty(billing.vatRate)) {
      missing.push("cota TVA");
    }

    if (!billing.vatResponsibilityConfirmed) {
      missing.push("confirmarea responsabilității fiscale");
    }
  }

  return {
    ok: missing.length === 0,
    missing,
  };
}

/* ----------------------------------------------------
   ✅ Ledger helpers (earnings)
----------------------------------------------------- */
function round2(n) {
  return Number.parseFloat(Number(n || 0).toFixed(2));
}
function getPaidGrossForItem(it) {
  return Number(it.price || 0) * Number(it.qty || 0);
}

function getShipmentPaidGross(items = []) {
  return items.reduce((sum, it) => sum + getPaidGrossForItem(it), 0);
}

function getPlatformDiscountGross(
  items = []
) {
  return round2(
    items.reduce(
      (sum, item) =>
        sum +
        Number(
          item.platformDiscountAmount ||
            0
        ),
      0
    )
  );
}

function getVendorDiscountGross(
  items = []
) {
  return round2(
    items.reduce(
      (sum, item) =>
        sum +
        Number(
          item.vendorDiscountAmount ||
            0
        ),
      0
    )
  );
}
/**
 * Calculează earning-ul vendorului pe shipment, folosind aceeași logică ca în GET /orders/:id:
 * - items subtotal gross -> net în funcție de TVA vendor
 * - comision pe itemsNet (bps din plan)
 * - vendorNet = itemsNet - commissionNet
 *
 * Notă: shipping NU intră în earning vendor.
 */
async function computeVendorEarningForShipment({
  vendorId,
  shipmentId,
}) {
  const shipment =
    await prisma.shipment.findUnique({
      // Pin explicit pe "query" - calcul earning/comision vendor.
      relationLoadStrategy: "query",
      where: {
        id: shipmentId,
      },

      include: {
        items: true,
        order: true,
      },
    });

  if (!shipment) {
    throw new Error(
      "shipment_not_found"
    );
  }

  const billing =
    await prisma.vendorBilling.findUnique({
      where: {
        vendorId,
      },
    });

  const vatStatus =
    billing?.vatStatus ||
    null;

  const vatRate =
    vatStatus === "payer"
      ? Number(
          billing?.vatRate ||
            0
        )
      : 0;

  /*
   * Valoarea efectiv plătită de client
   * pentru produsele din shipment.
   */
  const subtotalGross =
    getShipmentPaidGross(
      shipment.items ||
        []
    );

  /*
   * Reducerea suportată de Artfest.
   */
  const platformDiscountGross =
    getPlatformDiscountGross(
      shipment.items ||
        []
    );

  /*
   * Reducerea suportată de vendor.
   */
  const vendorDiscountGross =
    getVendorDiscountGross(
      shipment.items ||
        []
    );

  /*
   * Prețul inițial al produselor:
   *
   * preț final client
   * + reducerea Artfest
   * + reducerea vendorului.
   */
  const commissionBaseGross =
    round2(
      subtotalGross +
        platformDiscountGross +
        vendorDiscountGross
    );

  const plan =
    await getActivePlanForVendor(
      vendorId
    );

  let baseCommissionBps =
    Number(
      plan?.commissionBps ||
        0
    );

  if (
    !Number.isFinite(
      baseCommissionBps
    ) ||
    baseCommissionBps < 0
  ) {
    baseCommissionBps =
      0;
  }

  /*
   * Comision de campanie (override) - setat exclusiv
   * server-side la checkout, pe shipment-ul curent, dacă
   * atribuirea a fost validă în acel moment. Are prioritate
   * față de planul curent al vendorului.
   */
  const hasCampaignCommission =
    shipment.campaignCommissionBps !==
      null &&
    shipment.campaignCommissionBps !==
      undefined;

  const commissionBps =
    hasCampaignCommission
      ? Number(
          shipment.campaignCommissionBps
        )
      : baseCommissionBps;

  const vatFraction =
    vatRate > 0
      ? vatRate / 100
      : 0;

  /*
   * Sursă unică pentru comision - identică cu CARD
   * (computeOrderSplits) și cu Order Details vendor.
   */
  const breakdown =
    computeCommissionBreakdown({
      itemsOriginalGross:
        commissionBaseGross,

      itemsAfterDiscountGross:
        subtotalGross,

      platformDiscountAmount:
        platformDiscountGross,

      commissionBps,

      vatFraction,
    });

  return {
    currency:
      shipment.order
        ?.currency ||
      "RON",

    orderId:
      shipment.orderId,

    itemsNet:
      breakdown.itemsAfterDiscount,

    /*
     * IMPORTANT: commissionNet reprezintă acum platformNet -
     * cât reține EFECTIV Artfest (după subvenția platformei),
     * nu comisionul brut. Asta e cifra corectă de facturat
     * vendorului (adminInvoicesRoutes.js sumează acest câmp).
     */
    commissionNet:
      breakdown.platformNet,

    vendorNet:
      breakdown.vendorNet,

    vatStatus,
    vatRate,
    commissionBps,

    commissionSource:
      hasCampaignCommission
        ? "campaign"
        : "plan",

    campaignId:
      shipment.campaignId ||
      null,

    platformDiscountGross:
      round2(
        platformDiscountGross
      ),

    vendorDiscountGross:
      round2(
        vendorDiscountGross
      ),

    commissionBaseGross:
      round2(
        commissionBaseGross
      ),

    itemsAfterDiscount:
      breakdown.itemsAfterDiscount,

    commissionBase:
      breakdown.commissionBase,

    commissionAmount:
      breakdown.commissionAmount,

    platformSubsidyAmount:
      breakdown.platformSubsidyAmount,

    platformNet:
      breakdown.platformNet,
  };
}

async function ensureSaleLedgerEntry({
  vendorId,
  shipmentId,
}) {
  const earning =
    await computeVendorEarningForShipment({
      vendorId,
      shipmentId,
    });

  return prisma.vendorEarningEntry.upsert({
    where: {
      shipmentId,
    },

    update: {},

    create: {
      vendorId,
      shipmentId,

      orderId:
        earning.orderId,

      type:
        "SALE",

      occurredAt:
        new Date(),

      currency:
        earning.currency,

      itemsNet:
        earning.itemsNet,

      commissionNet:
        earning.commissionNet,

      vendorNet:
        earning.vendorNet,

      meta: {
        source:
          "shipment_status_fulfilled",

        vatStatus:
          earning.vatStatus,

        vatRate:
          earning.vatRate,

        commissionBps:
          earning.commissionBps,

        commissionSource:
          earning.commissionSource,

        campaignId:
          earning.campaignId,

        platformDiscountGross:
          earning.platformDiscountGross,

        vendorDiscountGross:
          earning.vendorDiscountGross,

        commissionBaseGross:
          earning.commissionBaseGross,

        itemsAfterDiscount:
          earning.itemsAfterDiscount,

        commissionBase:
          earning.commissionBase,

        commissionAmount:
          earning.commissionAmount,

        platformSubsidyAmount:
          earning.platformSubsidyAmount,

        platformNet:
          earning.platformNet,
      },
    },
  });
}

async function ensureRefundLedgerEntry({ vendorId, shipmentId }) {
  const sale = await prisma.vendorEarningEntry.findUnique({
    where: { shipmentId },
  });
  if (!sale) return null;

  let existingRefund = null;

  if (isPostgres) {
    existingRefund = await prisma.vendorEarningEntry.findFirst({
      where: {
        vendorId,
        type: "REFUND",
        meta: { path: ["refShipmentId"], equals: shipmentId },
      },
    });
  } else {
    const lastRefunds = await prisma.vendorEarningEntry.findMany({
      where: { vendorId, type: "REFUND" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, meta: true },
    });

    existingRefund =
      lastRefunds.find((r) => r?.meta?.refShipmentId === shipmentId) || null;
  }

  if (existingRefund) return existingRefund;

  return prisma.vendorEarningEntry.create({
    data: {
      vendorId,
      shipmentId: null,
      orderId: sale.orderId,
      type: "REFUND",
      occurredAt: new Date(),
      currency: sale.currency,
      itemsNet: sale.itemsNet?.mul ? sale.itemsNet.mul(-1) : -Number(sale.itemsNet || 0),
      commissionNet: sale.commissionNet?.mul
        ? sale.commissionNet.mul(-1)
        : -Number(sale.commissionNet || 0),
      vendorNet: sale.vendorNet?.mul ? sale.vendorNet.mul(-1) : -Number(sale.vendorNet || 0),
      meta: { refShipmentId: shipmentId, source: "shipment_status_returned" },
    },
  });
}

const dec = (n) => Number.parseFloat(Number(n || 0).toFixed(2));

/* ----------------------------------------------------
   ✅ LOCK: dezactivat temporar pentru lansare fără curier/AWB
----------------------------------------------------- */
function isAwaitingAwbLock(_shipment) {
  return false;
}

function lock409(res) {
  return res.status(409).json({
    error: "ORDER_LOCKED_AWAITING_AWB",
    message:
      "Comanda este blocată deoarece ai cerut curier. Așteaptă AWB-ul de la admin, apoi poți modifica din nou comanda.",
  });
}

/* ----------------------------------------------------
   Tiny cache (TTL) pentru listă
----------------------------------------------------- */
const ORDERS_CACHE_TTL_MS = 3000;
const ordersCache = new Map();

function cacheGet(key) {
  const v = ordersCache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > ORDERS_CACHE_TTL_MS) {
    ordersCache.delete(key);
    return null;
  }
  return v.payload;
}

function cacheSet(key, payload) {
  if (ordersCache.size > 500) ordersCache.clear();
  ordersCache.set(key, { ts: Date.now(), payload });
}

/* ----------------------------------------------------
   Middleware local – atașare req.user din token
----------------------------------------------------- */
router.use(async (req, _res, next) => {
  try {
    const cookieToken = req.cookies?.token || req.cookies?.access_token;
    const hdr = req.headers?.authorization || "";
    const headerToken = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
    const token = cookieToken || headerToken;
    if (!token) return next();

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        vendor: { select: { id: true } },
      },
    });

    if (user) {
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        vendorId: user.vendor?.id || null,
      };
    }
  } catch {}

  next();
});

/* ----------------------------------------------------
   Guard VENDOR
----------------------------------------------------- */
function requireVendor(req, res, next) {
  if (
    !req.user &&
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_VENDOR_ID
  ) {
    req.user = {
      id: "dev",
      email: "dev@local",
      role: "VENDOR",
      vendorId: process.env.DEV_VENDOR_ID,
    };
  }

  if (!req.user || req.user.role !== "VENDOR" || !req.user.vendorId) {
    return res.status(403).json({ error: "forbidden" });
  }

  next();
}

/* ----------------------------------------------------
   Helper status map UI <-> DB
----------------------------------------------------- */
function uiToShipmentStatus(ui) {
  switch (ui) {
    case "new":
      return "PENDING";
    case "preparing":
      return "PREPARING";
    default:
      return null;
  }
}

function shipmentToUiStatus(st) {
  switch (st) {
    case "PENDING":
      return "new";
    case "PREPARING":
      return "preparing";
    case "READY_FOR_PICKUP":
    case "PICKUP_SCHEDULED":
    case "AWB":
      return "confirmed";
    case "IN_TRANSIT":
      return "shipped";
    case "DELIVERED":
      return "fulfilled";
    case "REFUSED":
    case "RETURNED":
      return "cancelled";
    default:
      return "new";
  }
}

function shipmentToUserUiStatus(st) {
  if (st === "DELIVERED") return "fulfilled";
  if (st === "RETURNED") return "cancelled";
  if (st === "REFUSED") return "cancelled";

  if (st === "PREPARING") return "preparing";

  if (["READY_FOR_PICKUP", "PICKUP_SCHEDULED", "AWB", "IN_TRANSIT"].includes(st)) {
    return "confirmed";
  }

  return "new";
}

/* ----------------------------------------------------
   Helper: status plată pentru vendor

   Important:
   - comenzile manuale CARD create de vendor nu sunt
     confundate automat cu plățile Stripe;
   - considerăm CARD online dacă există user/guest
     sau identificatori Stripe.
----------------------------------------------------- */

function computeVendorOrderPaymentState(
  order
) {
  const paymentMethod =
    String(
      order?.paymentMethod ||
        ""
    )
      .trim()
      .toUpperCase();

  const orderStatus =
    String(
      order?.status ||
        ""
    )
      .trim()
      .toUpperCase();

  const isCard =
    paymentMethod ===
    "CARD";

  const isOnlineCard =
    isCard &&
    (
      Boolean(
        order?.userId
      ) ||
      order?.isGuestOrder ===
        true ||
      Boolean(
        order?.stripeCheckoutSessionId
      ) ||
      Boolean(
        order?.stripePaymentIntentId
      ) ||
      Boolean(
        order?.paidAt
      )
    );

  const isPaid =
    isOnlineCard &&
    (
      orderStatus ===
        "PAID" ||
      Boolean(
        order?.paidAt
      )
    );

  const paymentStatus =
    paymentMethod ===
    "COD"
      ? "COD"
      : !isOnlineCard
        ? "CARD"
        : isPaid
          ? "PAID"
          : "PENDING";

  const waitingForCardPayment =
    isOnlineCard &&
    !isPaid;

  return {
    paymentMethod,

    paymentStatus,

    isOnlineCard,

    paid:
      isPaid,

    waitingForCardPayment,

    canProcess:
      !waitingForCardPayment,
  };
}

/* ----------------------------------------------------
   🎫 Zod schema pentru facturi
----------------------------------------------------- */
const InvoiceLineInput = z.object({
  description: z.string().min(1),
  qty: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
  vatRate: z.number().nonnegative(),
});

const InvoiceInput = z.object({
  series: z.string().optional(),
  number: z.string().optional(),
  issueDate: z.string(),
  dueDate: z.string().optional(),
  currency: z.string().default("RON"),
  notes: z.string().optional(),
  customer: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      address: z.string().optional(),
    })
    .optional(),
  lines: z.array(InvoiceLineInput).min(1),
});

const InvoicePayload = z.object({
  invoice: InvoiceInput,
  sendEmail: z.boolean().optional(),
});

const ManualOrderItemInput = z.object({
  title: z.string().min(1),
  qty: z.number().positive(),
  price: z.number().nonnegative(),
});

const ManualOrderInput = z.object({
  customer: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  }),
  address: z.object({
    street: z.string().optional(),
    city: z.string().optional(),
    county: z.string().optional(),
    postalCode: z.string().optional(),
  }),
  items: z.array(ManualOrderItemInput).min(1),
  shippingPrice: z.number().nonnegative().default(0),
  paymentMethod: z.enum(["COD", "CARD"]).default("COD"),
  vendorNotes: z.string().optional(),
});

async function getNextInvoiceNumber(vendorId) {
  const year = new Date().getFullYear();
  const prefix = `AF-${year}-`;

  const last = await prisma.invoice.findFirst({
    where: { vendorId, direction: "VENDOR_TO_CLIENT" },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });

  let nextSeq = 1;
  if (last?.number?.startsWith(prefix)) {
    const n = parseInt(last.number.slice(prefix.length), 10);
    if (Number.isFinite(n)) nextSeq = n + 1;
  }

  return `${prefix}${String(nextSeq).padStart(5, "0")}`;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// ----------------------------------------------------
// Helper: găsește shipment-ul vendorului după:
// - orderId (cuid)
// - sau orderNumber (ex: "AF-...")
// ----------------------------------------------------
async function findShipmentByOrderRef({ vendorId, orderRef, include, select }) {
  return prisma.shipment.findFirst({
    // Pin explicit pe "query" - folosit de comandă vendor (detalii,
    // status, deposit, facturare); relații adiacente payment/comision
    // în majoritatea apelurilor - păstrăm strategia curentă până sunt
    // testate separat A/B, nu doar auditate mecanic.
    relationLoadStrategy: "query",
    where: {
      vendorId,
      OR: [{ orderId: orderRef }, { order: { orderNumber: orderRef } }],
    },
    include,
    select,
  });
}

/* ----------------------------------------------------
   Helper: unread meta per orderId
----------------------------------------------------- */
async function getThreadMetaByOrderId({ vendorId, orderIds }) {
  if (!orderIds?.length) return new Map();

  const threads = await prisma.messageThread.findMany({
    where: { vendorId, orderId: { in: orderIds } },
    select: { id: true, orderId: true, vendorLastReadAt: true },
  });

  if (!threads.length) return new Map();

  if (isPostgres) {
    const threadIds = threads.map((t) => t.id);

    const rows = await prisma.$queryRaw`
      SELECT
        t."orderId" as "orderId",
        t.id         as "threadId",
        COUNT(m.*)::int as "unreadCount"
      FROM "MessageThread" t
      LEFT JOIN "Message" m
        ON m."threadId" = t.id
       AND m."authorType" <> 'VENDOR'
       AND m."createdAt" > COALESCE(t."vendorLastReadAt", to_timestamp(0))
      WHERE t."vendorId" = ${vendorId}
        AND t.id = ANY(${threadIds})
      GROUP BY t."orderId", t.id
    `;

    const map = new Map();
    for (const r of rows || []) {
      map.set(r.orderId, { threadId: r.threadId, unreadCount: r.unreadCount });
    }

    for (const t of threads) {
      if (!map.has(t.orderId)) {
        map.set(t.orderId, { threadId: t.id, unreadCount: 0 });
      }
    }

    return map;
  }

  const counts = await Promise.all(
    threads.map(async (t) => {
      const unreadCount = await prisma.message.count({
        where: {
          threadId: t.id,
          NOT: { authorType: "VENDOR" },
          ...(t.vendorLastReadAt
            ? { createdAt: { gt: t.vendorLastReadAt } }
            : {}),
        },
      });

      return { orderId: t.orderId, threadId: t.id, unreadCount };
    })
  );

  const map = new Map();
  for (const c of counts) {
    map.set(c.orderId, { threadId: c.threadId, unreadCount: c.unreadCount });
  }
  return map;
}

/* ----------------------------------------------------
   GET /api/vendor/orders
----------------------------------------------------- */

router.get(
  "/orders",
  requireVendor,

  async (req, res) => {
    const vendorId =
      req.user.vendorId;

    const billingGate =
      await prisma.vendorBilling.findUnique({
        where: {
          vendorId,
        },
      });

    const billingStatus =
      validateBillingGate(
        billingGate
      );

    const ordersCount =
      await prisma.shipment.count({
        where: {
          vendorId,
        },
      });

    if (
      !billingStatus.ok
    ) {
      return res.json({
        total:
          ordersCount,

        items: [],

        billingRequired:
          true,

        billingGate: {
          title:
            "Completează datele de facturare",

          message:
            ordersCount > 0
              ? "Ai primit comenzi. Pentru a vedea datele clienților și detaliile comenzilor trebuie să completezi mai întâi informațiile de facturare."
              : "Pentru a putea primi și administra comenzile, completează mai întâi informațiile de facturare.",

          cta: {
            label:
              "Completează datele de facturare",

            url:
              "/setari?tab=billing",
          },
        },
      });
    }

    const q =
      String(
        req.query.q ||
          ""
      ).trim();

    const statusUi =
      String(
        req.query.status ||
          ""
      );

    const from =
      req.query.from
        ? new Date(
            String(
              req.query.from
            )
          )
        : null;

    const to =
      req.query.to
        ? new Date(
            String(
              req.query.to
            )
          )
        : null;

    const page =
      Math.max(
        1,
        parseInt(
          req.query.page ||
            "1",
          10
        )
      );

    const pageSize =
      Math.min(
        100,
        Math.max(
          1,
          parseInt(
            req.query
              .pageSize ||
              "20",
            10
          )
        )
      );

    const cacheKey =
      `v:${vendorId}` +
      `|q:${q}` +
      `|st:${statusUi}` +
      `|f:${
        from
          ? from.toISOString()
          : ""
      }` +
      `|t:${
        to
          ? to.toISOString()
          : ""
      }` +
      `|p:${page}` +
      `|ps:${pageSize}`;

    const cached =
      cacheGet(
        cacheKey
      );

    if (cached) {
      return res.json(
        cached
      );
    }

    const where = {
      vendorId,

      ...(
        statusUi ===
        "confirmed"
          ? {
              status: {
                in: [
                  "READY_FOR_PICKUP",
                  "PICKUP_SCHEDULED",
                  "AWB",
                ],
              },
            }
          : statusUi ===
              "shipped"
          ? {
              status:
                "IN_TRANSIT",
            }
          : statusUi ===
              "fulfilled"
          ? {
              status:
                "DELIVERED",
            }
          : statusUi ===
              "cancelled"
          ? {
              status: {
                in: [
                  "RETURNED",
                  "REFUSED",
                ],
              },
            }
          : statusUi
          ? {
              status:
                uiToShipmentStatus(
                  statusUi
                ),
            }
          : {}
      ),
    };

    if (
      from ||
      to
    ) {
      where.createdAt = {
        ...(
          from
            ? {
                gte:
                  from,
              }
            : {}
        ),

        ...(
          to
            ? {
                lte:
                  endOfDay(
                    to
                  ),
              }
            : {}
        ),
      };
    }

    if (q) {
      where.OR = [
        {
          orderId: {
            contains:
              q,
          },
        },

        {
          order: {
            orderNumber: {
              contains:
                q,

              mode:
                "insensitive",
            },
          },
        },

        {
          order: {
            shippingAddress: {
              path: [
                "name",
              ],

              string_contains:
                q,
            },
          },
        },

        {
          order: {
            shippingAddress: {
              path: [
                "phone",
              ],

              string_contains:
                q,
            },
          },
        },

        {
          order: {
            shippingAddress: {
              path: [
                "email",
              ],

              string_contains:
                q,
            },
          },
        },

        {
          order: {
            shippingAddress: {
              path: [
                "city",
              ],

              string_contains:
                q,
            },
          },
        },

        {
          order: {
            shippingAddress: {
              path: [
                "street",
              ],

              string_contains:
                q,
            },
          },
        },
      ];
    }

    const [
      rows,
      total,
    ] =
      await Promise.all([
        prisma.shipment.findMany({
          /*
           * LEAN LIST SELECT - doar câmpurile randate efectiv în
           * rândul din tabel (trace exhaustiv făcut pe Orders.jsx,
           * fiecare câmp verificat unul câte unul). Explicit
           * EXCLUSE, disponibile doar în Order Details:
           * courier/AWB, pickup, delivered/refused/returned,
           * câmpuri de campanie, vendorNotes, invoiceNumber/Date,
           * items complete (personalizări/discount breakdown),
           * și breakdown-ul de comision per rând (vendorFinancials -
           * confirmat neutilizat de UI, calculat degeaba pe server).
           *
           * join: toate relațiile de mai jos sunt 1:1 (service,
           * profile, vendor, order) + items redus la 2 câmpuri
           * scalare (fără relație) - testat A/B cu date reale din
           * DEV, rezultat identic, 6->1 query-uri.
           */
          relationLoadStrategy: "join",

          where,

          orderBy: {
            createdAt:
              "desc",
          },

          skip:
            (
              page -
              1
            ) *
            pageSize,

          take:
            pageSize,

          select: {
            id:
              true,

            orderId:
              true,

            createdAt:
              true,

            status:
              true,

            price:
              true,

            cancelReason:
              true,

            cancelReasonNote:
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

            items: {
              select: {
                // doar ce are nevoie getShipmentPaidGross() pentru
                // `total` - nimic altceva nu ajunge în listă.
                price:
                  true,

                qty:
                  true,
              },
            },

            service: {
              select: {
                title:
                  true,

                profile: {
                  select: {
                    displayName:
                      true,
                  },
                },

                vendor: {
                  select: {
                    displayName:
                      true,
                  },
                },
              },
            },

            order: {
              select: {
                orderNumber:
                  true,

                status:
                  true,

                paymentMethod:
                  true,

                paidAt:
                  true,

                stripeCheckoutSessionId:
                  true,

                stripePaymentIntentId:
                  true,

                userId:
                  true,

                isGuestOrder:
                  true,

                shippingAddress:
                  true,
              },
            },
          },
        }),

        prisma.shipment.count({
          where,
        }),
      ]);

    // Nu mai există lookup de imagini/vendorFinancials aici -
    // `items[]` complet și breakdown-ul de comision per rând nu sunt
    // randate de tabelul din Comenzi (confirmat prin trace exhaustiv
    // pe Orders.jsx) - au fost mutate/eliminate din select mai sus.

    let items =
      rows.map(
        (
          shipment
        ) => {
          /*
           * Breakdown-ul complet de comision (platformNet/vendorNet/
           * planCode etc.) NU se mai calculează aici - confirmat prin
           * trace exhaustiv că `vendorFinancials` nu e randat de
           * tabelul din Comenzi. Sursa unică pentru comision rămâne
           * neschimbată pentru Order Details/COD/CARD:
           * computeVendorEarningForShipment() / computeOrderSplits().
           * Aici păstrăm DOAR ce hrănește `total`, câmpul singur
           * folosit efectiv de listă.
           */
          const order =
            shipment.order ||
            {};

          const paymentState =
            computeVendorOrderPaymentState(
              order
            );

          const address =
            order.shippingAddress ||
            {};

          const storeName =
            shipment.service
              ?.profile
              ?.displayName ||
            shipment.service
              ?.title ||
            shipment.service
              ?.vendor
              ?.displayName ||
            "Magazin";

          const shipmentSubtotal =
            getShipmentPaidGross(
              shipment.items ||
                []
            );

          const shipmentShipping =
            Number(
              shipment.price ||
                0
            );

          const shipmentTotal =
            shipmentSubtotal +
            shipmentShipping;

          return {
            id:
              shipment.orderId,

            orderNumber:
              order.orderNumber ||
              null,

            shortId:
              String(
                shipment.id
              )
                .slice(
                  -6
                )
                .toUpperCase(),

            createdAt:
              shipment.createdAt,

            customerName:
              address.name ||
              "",

            customerPhone:
              address.phone ||
              "",

            customerEmail:
              address.email ||
              "",

            address: {
              city:
                address.city ||
                "",
            },

            storeName,

            status:
              shipmentToUiStatus(
                shipment.status
              ),

            total:
              shipmentTotal,

            itemsCount:
              (
                shipment.items ||
                []
              ).length,

            cancelReason:
              shipment.cancelReason ||
              null,

            cancelReasonNote:
              shipment.cancelReasonNote ||
              null,

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

            waitingForCardPayment:
              paymentState
                .waitingForCardPayment,

            canProcess:
              paymentState
                .canProcess,

            deposit: {
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
            },

            /*
             * Placeholder - completat printr-un apel separat,
             * nu-blocant, de la client (vezi
             * GET /orders/thread-meta) ca să nu întârzie primul
             * randare a tabelului pentru un simplu badge.
             */
            messageThreadId:
              null,

            messageUnreadCount:
              0,
          };
        }
      );

    // messageThreadId/messageUnreadCount rămân null/0 aici - clientul
    // le completează printr-un apel separat (GET /orders/thread-meta),
    // ca badge-ul de mesaje necitite să nu mai blocheze primul
    // răspuns al listei.

    const payload = {
      total,
      items,
    };

    cacheSet(
      cacheKey,
      payload
    );

    return res.json(
      payload
    );
  }
);

/* ----------------------------------------------------
   GET /api/vendor/orders/thread-meta?orderIds=a,b,c
   Populează messageThreadId/messageUnreadCount separat de lista
   principală, ca badge-ul de mesaje să nu mai întârzie primul
   randare al tabelului. Aceeași logică (getThreadMetaByOrderId),
   doar mutată într-un apel non-blocant, ulterior.
----------------------------------------------------- */
router.get("/orders/thread-meta", requireVendor, async (req, res, next) => {
  try {
    const vendorId = req.user.vendorId;

    const orderIds = String(req.query.orderIds || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!orderIds.length) {
      return res.json({});
    }

    const metaByOrderId = await getThreadMetaByOrderId({
      vendorId,
      orderIds,
    });

    const out = {};
    for (const [orderId, meta] of metaByOrderId.entries()) {
      out[orderId] = {
        messageThreadId: meta.threadId,
        messageUnreadCount: meta.unreadCount,
      };
    }

    return res.json(out);
  } catch (e) {
    next(e);
  }
});

router.get("/orders/stream", requireVendor, (req, res) => {
  const vendorId = req.user.vendorId;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  res.write(`: connected\n\n`);

  const ping = setInterval(() => {
    try {
      res.write(`event: ping\ndata: {}\n\n`);
    } catch {}
  }, 25000);

  if (!vendorSubscribers.has(vendorId)) vendorSubscribers.set(vendorId, new Set());
  vendorSubscribers.get(vendorId).add(res);

  sseSend(res, "ready", { ok: true });

  req.on("close", () => {
    clearInterval(ping);
    const set = vendorSubscribers.get(vendorId);
    if (set) {
      set.delete(res);
      if (set.size === 0) vendorSubscribers.delete(vendorId);
    }
  });
});

/* ----------------------------------------------------
   GET /api/vendor/orders/:id
----------------------------------------------------- */

router.get(
  "/orders/:id",
  requireVendor,

  async (req, res) => {
    const vendorId =
      req.user.vendorId;

    const billingGate =
      await prisma.vendorBilling.findUnique({
        where: {
          vendorId,
        },
      });

    const billingStatus =
      validateBillingGate(
        billingGate
      );

    if (
      !billingStatus.ok
    ) {
      return res
        .status(423)
        .json({
          error:
            "billing_required",

          title:
            "Completează datele de facturare",

          message:
            "Nu poți vedea detaliile comenzii până nu completezi datele de facturare.",

          missing:
            billingStatus.missing,

          cta: {
            label:
              "Completează datele de facturare",

            url:
              "/setari?tab=billing",
          },
        });
    }

    const orderId =
      String(
        req.params.id
      );

    const shipment =
      await findShipmentByOrderRef({
        vendorId,

        orderRef:
          orderId,

        include: {
          order: {
            include: {
              messageThreads: {
                where: {
                  vendorId,
                },

                select: {
                  id:
                    true,

                  internalNote:
                    true,

                  followUpAt:
                    true,

                  leadStatus:
                    true,

                  contactName:
                    true,

                  contactPhone:
                    true,
                },
              },
            },
          },

          items:
            true,

          service: {
            select: {
              id:
                true,

              title:
                true,

              profile: {
                select: {
                  displayName:
                    true,

                  slug:
                    true,
                },
              },

              vendor: {
                select: {
                  displayName:
                    true,
                },
              },
            },
          },
        },
      });

    if (!shipment) {
      return res
        .status(404)
        .json({
          error:
            "not_found",
        });
    }

    const order =
      shipment.order;

    const paymentState =
      computeVendorOrderPaymentState(
        order
      );

    const address =
      order?.shippingAddress ||
      {};

    const storeName =
      shipment.service
        ?.profile
        ?.displayName ||
      shipment.service
        ?.title ||
      shipment.service
        ?.vendor
        ?.displayName ||
      "Magazin";

    const shipmentSubtotal =
      getShipmentPaidGross(
        shipment.items ||
          []
      );

    const platformDiscountGross =
      getPlatformDiscountGross(
        shipment.items ||
          []
      );

    const vendorDiscountGross =
      getVendorDiscountGross(
        shipment.items ||
          []
      );

    const shipmentShipping =
      Number(
        shipment.price ||
          0
      );

    const shipmentTotal =
      shipmentSubtotal +
      shipmentShipping;

    /*
     * Pentru comenzile noi PF/PJ folosim
     * customerType din Order.
     *
     * Fallback-ul păstrează compatibilitatea
     * cu comenzile vechi.
     */
    const customerType =
      String(
        order?.customerType ||
          ""
      )
        .trim()
        .toUpperCase() ===
      "PJ"
        ? "PJ"
        : Boolean(
            address.companyName ||
              address.companyCui
          )
        ? "PJ"
        : "PF";

    const billing =
      await prisma.vendorBilling.findUnique({
        where: {
          vendorId,
        },
      });

    const vatStatus =
      billing?.vatStatus ||
      null;

    const vatRateStr =
      billing?.vatRate ||
      null;

    const vatRate =
      vatStatus ===
      "payer"
        ? Number(
            vatRateStr ||
              0
          )
        : 0;

    function splitGross(
      gross
    ) {
      const value =
        Number(
          gross ||
            0
        );

      if (
        !vatRate ||
        vatRate <= 0
      ) {
        return {
          net:
            dec(
              value
            ),

          vat:
            0,

          gross:
            dec(
              value
            ),
        };
      }

      const net =
        value /
        (
          1 +
          vatRate /
            100
        );

      const vat =
        value -
        net;

      return {
        net:
          dec(
            net
          ),

        vat:
          dec(
            vat
          ),

        gross:
          dec(
            value
          ),
      };
    }

    const itemsBreakdown =
      splitGross(
        shipmentSubtotal
      );

    const shippingBreakdown =
      splitGross(
        shipmentShipping
      );

    const totalBreakdown = {
      net:
        dec(
          itemsBreakdown.net +
            shippingBreakdown.net
        ),

      vat:
        dec(
          itemsBreakdown.vat +
            shippingBreakdown.vat
        ),

      gross:
        dec(
          shipmentTotal
        ),
    };

    let baseCommissionBps =
      0;

    let commissionBps =
      0;

    let activePlan =
      null;

    try {
      activePlan =
        await getActivePlanForVendor(
          vendorId
        );

      baseCommissionBps =
        Number(
          activePlan
            ?.commissionBps ||
            0
        );

      if (
        !Number.isFinite(
          baseCommissionBps
        ) ||
        baseCommissionBps <
          0
      ) {
        baseCommissionBps =
          0;
      }

      commissionBps =
        baseCommissionBps;
    } catch (error) {
      console.error(
        "getActivePlanForVendor failed:",
        error
      );

      baseCommissionBps =
        0;

      commissionBps =
        0;
    }

    /*
     * Comision de campanie (override) - dacă shipment-ul a
     * fost creat cu o atribuire de campanie validă la
     * checkout, are prioritate față de planul curent al
     * vendorului. Nu recalculăm din plan dacă shipment-ul
     * are deja acest snapshot.
     */
    const hasCampaignCommission =
      shipment.campaignCommissionBps !==
        null &&
      shipment.campaignCommissionBps !==
        undefined;

    if (hasCampaignCommission) {
      commissionBps =
        Number(
          shipment.campaignCommissionBps
        );
    }

    const commissionBaseGross =
      round2(
        shipmentSubtotal +
          platformDiscountGross +
          vendorDiscountGross
      );

    const detailVatFraction =
      vatRate > 0
        ? vatRate / 100
        : 0;

    /*
     * Sursă unică pentru comision - identică cu COD
     * (computeVendorEarningForShipment), CARD
     * (computeOrderSplits) și lista de comenzi.
     */
    const detailBreakdown =
      computeCommissionBreakdown({
        itemsOriginalGross:
          commissionBaseGross,

        itemsAfterDiscountGross:
          shipmentSubtotal,

        platformDiscountAmount:
          platformDiscountGross,

        commissionBps,

        vatFraction:
          detailVatFraction,
      });

    const itemsNet =
      detailBreakdown.itemsAfterDiscount;

    /*
     * IMPORTANT: commissionNet afișat = platformNet (ce
     * reține efectiv Artfest, după subvenția platformei).
     */
    const commissionNet =
      detailBreakdown.platformNet;

    const vendorNetBeforeShipping =
      detailBreakdown.vendorNet;

    const vendorFinancials = {
      planCode:
        activePlan?.code ||
        null,

      planName:
        activePlan?.name ||
        null,

      commissionBps,

      commissionSource:
        hasCampaignCommission
          ? "campaign"
          : "plan",

      commissionPercent:
        round2(
          commissionBps /
            100
        ),

      commissionRate:
        round2(
          commissionBps /
            10000
        ),

      itemsNet:
        round2(
          itemsNet
        ),

      commissionNet,

      vendorNetBeforeShipping,

      baseCommissionBps,

      platformDiscountGross:
        round2(
          platformDiscountGross
        ),

      vendorDiscountGross:
        round2(
          vendorDiscountGross
        ),

      commissionBaseGross:
        round2(
          commissionBaseGross
        ),

      itemsAfterDiscount:
        detailBreakdown.itemsAfterDiscount,

      commissionBase:
        detailBreakdown.commissionBase,

      commissionAmount:
        detailBreakdown.commissionAmount,

      platformSubsidyAmount:
        detailBreakdown.platformSubsidyAmount,

      platformNet:
        detailBreakdown.platformNet,
    };

    const productIdSet =
      new Set();

    for (
      const item of
      shipment.items ||
      []
    ) {
      if (
        item.productId
      ) {
        productIdSet.add(
          item.productId
        );
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
            (
              product
            ) => [
              product.id,

              Array.isArray(
                product.images
              ) &&
              product
                .images[0]
                ? product
                    .images[0]
                : null,
            ]
          )
        );
    }

    const messageThreads =
      order.messageThreads ||
      [];

    return res.json({
      id:
        order.id,

      orderNumber:
        order.orderNumber ||
        null,

      shortId:
        shipment.id
          .slice(
            -6
          )
          .toUpperCase(),

      createdAt:
        order.createdAt,

      storeName,

      serviceId:
        shipment.service
          ?.id ||
        null,

      serviceSlug:
        shipment.service
          ?.profile
          ?.slug ||
        null,

      subtotal:
        shipmentSubtotal,

      shippingTotal:
        shipmentShipping,

      total:
        shipmentTotal,

      priceBreakdown: {
        vatRate,
        vatStatus,

        items:
          itemsBreakdown,

        shipping:
          shippingBreakdown,

        total:
          totalBreakdown,

        vendorFinancials,
      },

      status:
        shipmentToUiStatus(
          shipment.status
        ),

      statusLabel: {
        new:
          "Nouă",

        preparing:
          "În pregătire",

        confirmed:
          "Confirmată (gata de predare)",

        shipped:
          "Predată curierului",

        fulfilled:
          "Finalizată",

        cancelled:
          "Anulată",
      }[
        shipmentToUiStatus(
          shipment.status
        )
      ],

      cancelReason:
        shipment.cancelReason ||
        null,

      cancelReasonNote:
        shipment.cancelReasonNote ||
        null,

      shippingAddress:
        address,

      /*
       * Date facturare + contact pentru PJ.
       */
      billingAddress:
        order.billingAddress ||
        null,

      contactPerson:
        order.contactPerson ||
        null,

      customerType,

      items:
        (
          shipment.items ||
          []
        ).map(
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

              platformDiscountPercent:
                Number(
                  item.platformDiscountPercent ||
                    0
                ),

              vendorDiscountPercent:
                Number(
                  item.vendorDiscountPercent ||
                    0
                ),

              platformDiscountAmount:
                Number(
                  item.platformDiscountAmount ||
                    0
                ),

              vendorDiscountAmount:
                Number(
                  item.vendorDiscountAmount ||
                    0
                ),

              promoCollectionId:
                item.promoCollectionId ||
                null,

              promoFundingSource:
                item.promoFundingSource ||
                null,

              homepageFeatureId:
                item.homepageFeatureId ||
                null,

              discountSource:
                item.discountSource ||
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
            };
          }
        ),

      vendorNotes:
        order.vendorNotes ||
        "",

      /*
       * =====================================================
       * PLATĂ
       * =====================================================
       */

      paymentMethod:
        paymentState
          .paymentMethod,

      paymentStatus:
        paymentState
          .paymentStatus,

      paidAt:
        order.paidAt ||
        null,

      waitingForCardPayment:
        paymentState
          .waitingForCardPayment,

      canProcess:
        paymentState
          .canProcess,

      deposit: {
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
      },

      shipment: {
        id:
          shipment.id,

        courierProvider:
          shipment.courierProvider,

        courierService:
          shipment.courierService,

        awb:
          shipment.awb,

        labelUrl:
          shipment.labelUrl,

        trackingUrl:
          shipment.trackingUrl,

        pickupScheduledAt:
          shipment.pickupScheduledAt,

        pickupDate:
          shipment.pickupDate,

        pickupSlotStart:
          shipment.pickupSlotStart,

        pickupSlotEnd:
          shipment.pickupSlotEnd,

        deliveredAt:
          shipment.deliveredAt ||
          null,

        refusedAt:
          shipment.refusedAt ||
          null,

        returnedAt:
          shipment.returnedAt ||
          null,

        parcels:
          shipment.parcels,

        weightKg:
          shipment.weightKg,

        lengthCm:
          shipment.lengthCm,

        widthCm:
          shipment.widthCm,

        heightCm:
          shipment.heightCm,

        consents:
          shipment.consents,
      },

      invoiceNumber:
        order.invoiceNumber ||
        null,

      invoiceDate:
        order.invoiceDate ||
        null,

      messageThreads,
    });
  }
);

/* ----------------------------------------------------
   POST /api/vendor/orders/:id/request-deposit
----------------------------------------------------- */
router.post(
  "/orders/:id/request-deposit",
  requireVendor,
  async (req, res) => {
    try {
      const vendorId =
        req.user.vendorId;

      const orderRef =
        String(
          req.params.id ||
            ""
        ).trim();

      const shipment =
        await findShipmentByOrderRef({
          vendorId,

          orderRef,

          include: {
            order: true,
            items: true,

           vendor: {
  select: {
    displayName: true,

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
        return res.status(404).json({
          error:
            "order_not_found",

          message:
            "Comanda nu a fost găsită.",
        });
      }

      if (
        shipment.order
          ?.paymentMethod !==
        "COD"
      ) {
        return res.status(409).json({
          error:
            "deposit_only_for_cod",

          message:
            "Avansul poate fi solicitat doar pentru comenzile ramburs.",
        });
      }

      if (
        shipment.status !==
        "PENDING"
      ) {
        return res.status(409).json({
          error:
            "deposit_order_already_started",

          message:
            "Avansul poate fi solicitat doar înainte de începerea comenzii.",
        });
      }

      const depositCanBeRequested =
  [
    "NOT_REQUESTED",
    "EXPIRED",
    "FAILED",
  ].includes(
    shipment.depositStatus
  );

if (!depositCanBeRequested) {
  return res.status(409).json({
    error:
      "deposit_already_requested",

    message:
      shipment.depositStatus === "PAID"
        ? "Avansul pentru această comandă a fost deja plătit."
        : "Există deja o solicitare de avans activă pentru această comandă.",
  });
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
console.log(
  "[REQUEST DEPOSIT STRIPE CHECK]",
  {
    vendorId,

    stripeAccountId:
      shipment.vendor
        ?.stripeAccountId,

    stripeChargesEnabled:
      shipment.vendor
        ?.stripeChargesEnabled,

    stripePayoutsEnabled:
      shipment.vendor
        ?.stripePayoutsEnabled,

    stripeDetailsSubmitted:
      shipment.vendor
        ?.stripeDetailsSubmitted,

    stripeConnectStatus:
      shipment.vendor
        ?.stripeConnectStatus,

    stripeReady,
  }
);
      if (!stripeReady) {
        return res.status(409).json({
          error:
            "stripe_not_active",

          message:
            "Activează plățile online înainte de a solicita avans.",
        });
      }

      const productsTotal =
        round2(
          (
            shipment.items ||
            []
          ).reduce(
            (
              sum,
              item
            ) =>
              sum +
              Number(
                item.price ||
                  0
              ) *
                Number(
                  item.qty ||
                    0
                ),
            0
          )
        );

      if (
        productsTotal <=
        0
      ) {
        return res.status(409).json({
          error:
            "invalid_order_total",

          message:
            "Valoarea produselor din comandă nu este validă.",
        });
      }

      const depositPercent =
        15;

      const depositRequestedAmount =
        round2(
          (
            productsTotal *
            depositPercent
          ) /
            100
        );

      const shippingAmount =
        round2(
          Number(
            shipment.price ||
              0
          )
        );

      const remainingCodAmount =
        round2(
          productsTotal +
            shippingAmount -
            depositRequestedAmount
        );

      const requestedAt =
        new Date();

      const expiresAt =
        new Date(
          requestedAt.getTime() +
            24 *
              60 *
              60 *
              1000
        );

      const updated =
        await prisma.shipment.update({
          where: {
            id:
              shipment.id,
          },

          data: {
            depositStatus:
              "PENDING",

            depositPercent,

            depositRequestedAmount,

            depositPaidAmount:
              null,

            remainingCodAmount,

            depositRequestedAt:
              requestedAt,

            depositPaidAt:
              null,

            depositExpiresAt:
              expiresAt,

            stripeDepositSessionId:
              null,

            stripeDepositPaymentIntentId:
              null,

            depositPaymentError:
              null,
          },
        });

      let payment;

      try {
        payment =
          await createDepositPaymentForShipment({
            shipmentId:
              updated.id,
          });
      } catch (
        paymentError
      ) {
        await prisma.shipment.update({
          where: {
            id:
              updated.id,
          },

          data: {
            depositStatus:
              "NOT_REQUESTED",

            depositPercent:
              null,

            depositRequestedAmount:
              null,

            depositPaidAmount:
              null,

            remainingCodAmount:
              null,

            depositRequestedAt:
              null,

            depositPaidAt:
              null,

            depositExpiresAt:
              null,

            stripeDepositSessionId:
              null,

            stripeDepositPaymentIntentId:
              null,

            depositMeta:
              null,

            depositPaymentError:
              String(
                paymentError
                  ?.message ||
                  paymentError
              ),
          },
        });

        throw paymentError;
      }

      try {
        await notifyUserDepositRequested({
          orderId:
            shipment.orderId,

          shipmentId:
            updated.id,
        });
      } catch (
        notificationError
      ) {
        console.error(
          "notifyUserDepositRequested failed:",
          notificationError
        );
      }

    try {
  const order =
    shipment.order;

  const shippingAddress =
    order?.shippingAddress ||
    {};

 let customerEmail =
  null;

let customerName =
  shippingAddress.name ||
  order?.customerName ||
  null;

/*
 * ================================================
 * CLIENT AUTENTIFICAT
 * ================================================
 *
 * Pentru un client cu cont folosim cu prioritate
 * emailul contului care a plasat comanda.
 *
 * Astfel evităm să trimitem accidental emailul
 * către o adresă greșită din shippingAddress.
 */
if (order?.userId) {
  const customerUser =
    await prisma.user.findUnique({
      where: {
        id:
          order.userId,
      },

      select: {
        email:
          true,

        name:
          true,
      },
    });

  customerEmail =
    customerUser?.email ||
    order?.customerEmail ||
    shippingAddress.email ||
    null;

  if (!customerName) {
    customerName =
      customerUser?.name ||
      null;
  }
} else {
  /*
   * ================================================
   * GUEST
   * ================================================
   *
   * Guest-ul nu are User în baza de date,
   * deci folosim emailul introdus la comandă.
   */
  customerEmail =
    order?.customerEmail ||
    shippingAddress.email ||
    null;
}

  if (customerEmail) {
    const frontendUrl =
      getFrontendUrl();

    let actionUrl =
      `${frontendUrl}/comanda/${encodeURIComponent(
        order.id
      )}#avans`;

    /*
     * ================================================
     * GUEST
     * ================================================
     *
     * Guest-ul nu are sesiune și nu poate folosi
     * ruta /api/user/...
     *
     * Îi generăm un token semnat valabil 24h,
     * strict pentru această comandă + shipment.
     */
    if (
      order?.isGuestOrder ===
        true ||
      !order?.userId
    ) {
      if (
        !process.env.JWT_SECRET
      ) {
        throw new Error(
          "JWT_SECRET missing for guest deposit access"
        );
      }

      const guestDepositToken =
        jwt.sign(
          {
            type:
              "guest_deposit_access",

            orderId:
              order.id,

            shipmentId:
              updated.id,
          },

          process.env.JWT_SECRET,

          {
            expiresIn:
              "24h",
          }
        );

      actionUrl =
        `${frontendUrl}/comanda-guest/${encodeURIComponent(
          order.id
        )}` +
        `?depositToken=${encodeURIComponent(
          guestDepositToken
        )}` +
        `#avans`;
    }

    await sendDepositRequestedEmail({
      to:
        customerEmail,

      userId:
        order?.userId ||
        null,

      orderId:
        order.id,

      orderNumber:
        order.orderNumber ||
        null,

      customerName:
        customerName ||
        "client",

      vendorName:
        shipment.vendor
          ?.displayName ||
        "Artizanul",

      depositPercent:
        updated.depositPercent,

      depositAmount:
        updated.depositRequestedAmount !=
        null
          ? Number(
              updated.depositRequestedAmount
            )
          : null,

      remainingCodAmount:
        updated.remainingCodAmount !=
        null
          ? Number(
              updated.remainingCodAmount
            )
          : null,

      expiresAt:
        updated.depositExpiresAt,

      currency:
        order.currency ||
        "RON",

      /*
       * Important:
       *
       * - user logat:
       *   /comanda/:id#avans
       *
       * - guest:
       *   /comanda-guest/:id?depositToken=...
       */
      actionUrl,
    });
  }
} catch (
  emailError
) {
  console.error(
    "sendDepositRequestedEmail failed:",
    emailError
  );
}

      ordersCache.clear();

      return res.json({
        ok:
          true,

        shipmentId:
          updated.id,

        payment: {
          provider:
            payment.provider,

          checkoutSessionId:
            payment.checkoutSessionId,

          /*
           * Acest URL este returnat vendorului
           * doar pentru debugging.
           *
           * Clientul îl va obține din ruta
           * protejată pay-deposit.
           */
          url:
            payment.url,
        },

        deposit: {
          status:
            updated.depositStatus,

          percent:
            updated.depositPercent,

          requestedAmount:
            updated.depositRequestedAmount !=
            null
              ? Number(
                  updated.depositRequestedAmount
                )
              : null,

          paidAmount:
            updated.depositPaidAmount !=
            null
              ? Number(
                  updated.depositPaidAmount
                )
              : null,

          remainingCodAmount:
            updated.remainingCodAmount !=
            null
              ? Number(
                  updated.remainingCodAmount
                )
              : null,

          requestedAt:
            updated.depositRequestedAt,

          paidAt:
            updated.depositPaidAt,

          expiresAt:
            updated.depositExpiresAt,
        },
      });
    } catch (error) {
      console.error(
        "Request deposit failed:",
        error
      );

      const knownErrors = {
        stripe_not_active:
          "Plățile online nu sunt active pentru acest magazin.",

        invalid_deposit_amount:
          "Suma avansului nu este validă.",

        deposit_not_pending:
          "Avansul nu este în așteptarea plății.",

        deposit_only_for_cod:
          "Avansul este disponibil doar pentru comenzile ramburs.",

        shipment_not_found:
          "Livrarea nu a fost găsită.",
      };

      const message =
        knownErrors[
          error?.message
        ] ||
        "Nu am putut solicita avansul.";

      return res.status(500).json({
        error:
          "request_deposit_failed",

        message,
      });
    }
  }
);

/* ----------------------------------------------------
   PATCH /api/vendor/orders/:id/status
----------------------------------------------------- */

router.patch(
  "/orders/:id/status",
  requireVendor,

  async (req, res) => {
    const vendorId =
      req.user.vendorId;

    const orderId =
      String(
        req.params.id
      );

    const nextUi =
      String(
        req.body?.status ||
        ""
      );

    let next =
      null;

    switch (
      nextUi
    ) {
      case "new":
        next =
          "PENDING";
        break;

      case "preparing":
        next =
          "PREPARING";
        break;

      case "confirmed":
        next =
          "READY_FOR_PICKUP";
        break;

      case "shipped":
        next =
          "IN_TRANSIT";
        break;

      case "fulfilled":
        next =
          "DELIVERED";
        break;

      case "cancelled":
        next =
          "REFUSED";
        break;

      default:
        next =
          null;
    }

    if (!next) {
      return res
        .status(400)
        .json({
          error:
            "bad_status",
        });
    }

    const cancelReason =
      req.body?.cancelReason ||
      null;

    const cancelReasonNote =
      req.body?.cancelReasonNote ||
      null;

    const s =
      await findShipmentByOrderRef({
        vendorId,

        orderRef:
          orderId,

        include: {
          order:
            true,
        },
      });

    if (!s) {
      return res
        .status(404)
        .json({
          error:
            "not_found",
        });
    }

const paymentState =
  computeVendorOrderPaymentState(
    s.order
  );

/*
 * =====================================================
 * CARD ONLINE NEPLĂTIT
 * =====================================================
 *
 * Blocăm doar procesarea comenzii.
 * Anularea trebuie să rămână posibilă.
 */

if (
  [
    "preparing",
    "confirmed",
    "shipped",
    "fulfilled",
  ].includes(
    nextUi
  ) &&
  paymentState
    .waitingForCardPayment
) {
  return res
    .status(409)
    .json({
      error:
        "card_payment_pending",

      message:
        "Clientul nu a finalizat încă plata cu cardul. Comanda poate fi procesată după confirmarea plății.",

      paymentMethod:
        paymentState
          .paymentMethod,

      paymentStatus:
        paymentState
          .paymentStatus,

      waitingForCardPayment:
        true,
    });
}


    /*
     * =====================================================
     * CARD ONLINE NEPLĂTIT
     * =====================================================
     */

    

    /*
     * =====================================================
     * AVANS COD NEPLĂTIT
     * =====================================================
     */

    if (
      nextUi ===
        "preparing" &&
      s.depositStatus ===
        "PENDING"
    ) {
      return res
        .status(409)
        .json({
          error:
            "deposit_payment_pending",

          message:
            "Nu poți începe comanda până când clientul nu plătește avansul.",
        });
    }

    /*
     * Lock AWB.
     */
    if (
      isAwaitingAwbLock(
        s
      )
    ) {
      return lock409(
        res
      );
    }

    /*
     * =====================================================
     * ANULARE
     * =====================================================
     */

    if (
      nextUi ===
        "cancelled" &&
      ![
        "PENDING",
        "PREPARING",
        "READY_FOR_PICKUP",
      ].includes(
        s.status
      )
    ) {
      return res
        .status(409)
        .json({
          error:
            "order_cannot_be_cancelled",

          message:
            s.status ===
              "REFUSED" ||
            s.status ===
              "RETURNED"
              ? "Comanda este deja anulată."
              : "Comanda nu mai poate fi anulată în această etapă.",
        });
    }

    let updatedShipment;

    try {
      updatedShipment =
        await prisma.$transaction(
          async (
            tx
          ) => {
            if (
              nextUi ===
              "cancelled"
            ) {
              /*
               * Actualizarea este condiționată.
               * Doar prima cerere de anulare
               * poate modifica shipment-ul.
               */
              const statusUpdate =
                await tx.shipment.updateMany({
                  where: {
                    id:
                      s.id,

                    status: {
                      in: [
                        "PENDING",
                        "PREPARING",
                        "READY_FOR_PICKUP",
                      ],
                    },
                  },

                  data: {
                    status:
                      "REFUSED",

                    cancelReason,

                    cancelReasonNote,

                    refusedAt:
                      new Date(),
                  },
                });

              if (
                statusUpdate.count !==
                1
              ) {
                throw new Error(
                  "shipment_already_cancelled_or_locked"
                );
              }

              /*
               * Stocul este restaurat numai
               * după actualizarea reușită.
               */
              await restoreShipmentStockAfterStatusChange(
                tx,
                s.id
              );
            } else {
              await tx.shipment.update({
                where: {
                  id:
                    s.id,
                },

                data: {
                  status:
                    next,
                },
              });
            }

            const updated =
              await tx.shipment.findUnique({
                where: {
                  id:
                    s.id,
                },

                include: {
                  order:
                    true,
                },
              });

            if (!updated) {
              throw new Error(
                "shipment_not_found"
              );
            }

            /*
             * Dacă toate shipment-urile sunt
             * anulate, anulăm și Order.
             */
            if (
              nextUi ===
              "cancelled"
            ) {
              const all =
                await tx.shipment.findMany({
                  where: {
                    orderId:
                      updated.orderId,
                  },

                  select: {
                    status:
                      true,
                  },
                });

              const allCancelled =
                all.every(
                  (
                    shipment
                  ) =>
                    [
                      "REFUSED",
                      "RETURNED",
                    ].includes(
                      shipment.status
                    )
                );

              if (
                allCancelled
              ) {
                await tx.order.update({
                  where: {
                    id:
                      updated.orderId,
                  },

                  data: {
                    status:
                      "CANCELLED",
                  },
                });
              }
            }

            return updated;
          }
        );
    } catch (
      error
    ) {
      console.error(
        "Order status update failed:",
        error
      );

      if (
        error?.message ===
        "shipment_already_cancelled_or_locked"
      ) {
        return res
          .status(409)
          .json({
            error:
              "shipment_already_cancelled_or_locked",

            message:
              "Comanda este deja anulată sau nu mai poate fi modificată.",
          });
      }

      if (
        error?.message ===
        "shipment_not_found"
      ) {
        return res
          .status(404)
          .json({
            error:
              "shipment_not_found",

            message:
              "Livrarea nu a fost găsită.",
          });
      }

      return res
        .status(500)
        .json({
          error:
            "order_status_update_failed",

          message:
            "Statusul comenzii nu a putut fi actualizat.",
        });
    }

    /*
     * =====================================================
     * LEDGER
     * =====================================================
     */

    try {
      if (
        updatedShipment.status ===
          "DELIVERED" ||
        updatedShipment.status ===
          "IN_TRANSIT"
      ) {
        await ensureSaleLedgerEntry({
          vendorId,

          shipmentId:
            updatedShipment.id,
        });
      }

      if (
        updatedShipment.status ===
          "REFUSED" ||
        updatedShipment.status ===
          "RETURNED"
      ) {
        await ensureRefundLedgerEntry({
          vendorId,

          shipmentId:
            updatedShipment.id,
        });
      }
    } catch (
      e
    ) {
      console.error(
        "Ledger update failed:",
        e
      );
    }

    /*
     * =====================================================
     * MESAJ ANULARE
     * =====================================================
     */

    if (
      nextUi ===
      "cancelled"
    ) {
      try {
        const o =
          updatedShipment.order ||
          s.order;

        const shippingAddress =
          o?.shippingAddress ||
          {};

        await sendOrderCancelledMessage({
          orderId:
            o.id,

          shipmentId:
            s.id,

          shortShipmentId:
            s.id
              .slice(
                -6
              )
              .toUpperCase(),

          userId:
            o.userId,

          vendorId,

          shippingAddress,

          cancelReason,

          cancelReasonNote,
        });
      } catch (
        e
      ) {
        console.error(
          "Eroare la sendOrderCancelledMessage:",
          e
        );
      }
    }

    /*
     * =====================================================
     * NOTIFICARE USER + EMAIL CURIER
     * =====================================================
     */

    try {
      const o =
        updatedShipment.order ||
        s.order;

      if (
        o?.userId
      ) {
        const userUiStatus =
          shipmentToUserUiStatus(
            updatedShipment.status
          );

        await notifyUserOnOrderStatusChange(
          o.id,
          userUiStatus
        );
      }

      if (
        updatedShipment.status ===
        "IN_TRANSIT"
      ) {
        const shippingAddress =
          o?.shippingAddress ||
          {};

        let to =
          shippingAddress.email ||
          null;

        if (
          !to &&
          o?.userId
        ) {
          const user =
            await prisma.user.findUnique({
              where: {
                id:
                  o.userId,
              },

              select: {
                email:
                  true,
              },
            });

          to =
            user?.email ||
            null;
        }

        if (to) {
          await sendShipmentPickupEmail({
            to,

            orderId:
              o.id,

            awb:
              updatedShipment.awb ||
              null,

            trackingUrl:
              updatedShipment.trackingUrl ||
              null,

            etaLabel:
              updatedShipment.pickupDate
                ? "azi/mâine"
                : null,

            slotLabel:
              updatedShipment.pickupSlotStart &&
              updatedShipment.pickupSlotEnd
                ? `${updatedShipment.pickupSlotStart
                    .toISOString()
                    .slice(
                      11,
                      16
                    )}-${updatedShipment.pickupSlotEnd
                    .toISOString()
                    .slice(
                      11,
                      16
                    )}`
                : null,

            userId:
              o.userId ||
              null,
          });
        }
      }
    } catch (
      e
    ) {
      console.error(
        "notify/email user on order status failed:",
        e
      );
    }

    ordersCache.clear();

    return res.json({
      ok:
        true,

      shipment:
        updatedShipment,
    });
  }
);

/* ----------------------------------------------------
   PATCH /api/vendor/orders/:id/notes
----------------------------------------------------- */
router.patch("/orders/:id/notes", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const orderId = String(req.params.id);

  const notes = String(req.body?.vendorNotes || "");

  const s = await findShipmentByOrderRef({
    vendorId,
    orderRef: orderId,
    include: { order: true },
  });

  if (!s) return res.status(404).json({ error: "not_found" });

  if (isAwaitingAwbLock(s)) {
    return lock409(res);
  }

  const updatedOrder = await prisma.order.update({
    where: { id: s.orderId },
    data: { vendorNotes: notes },
  });

  ordersCache.clear();
  res.json({ ok: true, vendorNotes: updatedOrder.vendorNotes });
});

/* ----------------------------------------------------
   POST /api/vendor/shipments/:id/schedule-pickup
----------------------------------------------------- */
router.post("/shipments/:id/schedule-pickup", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const id = String(req.params.id);

  const { consents = {}, pickup = {}, dimensions = {} } = req.body || {};

const s = await prisma.shipment.findFirst({
  where: {
    id,
    vendorId,
  },

  include: {
    order:
      true,
  },
});

if (!s) {
  return res
    .status(404)
    .json({
      error:
        "not_found",
    });
}

/*
 * =====================================================
 * CARD ONLINE NEPLĂTIT
 * =====================================================
 */

const paymentState =
  computeVendorOrderPaymentState(
    s.order
  );

if (
  paymentState
    .waitingForCardPayment
) {
  return res
    .status(409)
    .json({
      error:
        "card_payment_pending",

      message:
        "Clientul nu a finalizat încă plata cu cardul. Curierul poate fi programat după confirmarea plății.",

      paymentMethod:
        paymentState
          .paymentMethod,

      paymentStatus:
        paymentState
          .paymentStatus,
    });
}

const policy =
  await prisma.vendorPolicy.findFirst({
    where: { document: "SHIPPING_ADDENDUM", isActive: true },
  });

  if (policy) {
    const ok = await prisma.vendorAcceptance.findFirst({
      where: {
        vendorId,
        document: "SHIPPING_ADDENDUM",
        version: policy.version,
      },
    });

    if (!ok) {
      return res.status(412).json({
        error: "policy_not_accepted",
        policy: { version: policy.version, url: policy.url },
      });
    }
  }

  const now = new Date();
  const pickupDate = new Date(now);
  if (pickup.day === "tomorrow") pickupDate.setDate(pickupDate.getDate() + 1);

  const [startH, endH] = String(pickup.slot || "14-18")
    .split("-")
    .map((n) => parseInt(n, 10));

  const slotStart = new Date(pickupDate);
  slotStart.setHours(startH || 14, 0, 0, 0);

  const slotEnd = new Date(pickupDate);
  slotEnd.setHours(endH || 18, 0, 0, 0);

  const updated = await prisma.shipment.update({
    where: { id },
    data: {
      status: "PICKUP_SCHEDULED",
      consents,
      parcels: Number(dimensions.parcels || 1),
      weightKg: Number(dimensions.weightKg || 1),
      lengthCm: Number(dimensions.l || 0),
      widthCm: Number(dimensions.w || 0),
      heightCm: Number(dimensions.h || 0),
      pickupDate,
      pickupSlotStart: slotStart,
      pickupSlotEnd: slotEnd,
      pickupScheduledAt: now,
    },
    include: { order: true },
  });

  sseBroadcastToVendor(vendorId, "pickup_scheduled", {
    orderId: updated.orderId,
    shipmentId: updated.id,
    pickupScheduledAt: updated.pickupScheduledAt,
    pickupDate: updated.pickupDate,
    pickupSlotStart: updated.pickupSlotStart,
    pickupSlotEnd: updated.pickupSlotEnd,
    status: "confirmed",
  });

  const o = updated.order;
  const etaLabel = pickup.day === "today" ? "azi" : "mâine";
  const slotLabel = pickup.slot || "14-18";

  try {
    if (o?.id && o.userId) {
      await notifyUserOnShipmentPickupScheduled(o.id, updated.id);
    }
  } catch (e) {
    console.error("notifyUserOnShipmentPickupScheduled failed:", e);
  }

  ordersCache.clear();

  res.json({
    ok: true,
    shipmentId: updated.id,
    status: updated.status,
    eta: etaLabel,
    slot: slotLabel,
  });
});

/* ----------------------------------------------------
   GET label redirect
----------------------------------------------------- */
router.get("/shipments/:id/label", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const id = String(req.params.id);

  const s = await prisma.shipment.findFirst({ where: { id, vendorId } });

  if (!s) return res.status(404).json({ error: "not_found" });
  if (!s.labelUrl) return res.status(404).json({ error: "label_missing" });

  res.redirect(s.labelUrl);
});

/* ----------------------------------------------------
   💬 POST /api/vendor/orders/:id/thread
----------------------------------------------------- */
router.post("/orders/:id/thread", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const orderId = String(req.params.id);

  const s = await findShipmentByOrderRef({
    vendorId,
    orderRef: orderId,
    include: { order: true },
  });

  if (!s) return res.status(404).json({ error: "not_found" });

  const o = s.order;
  const addr = o.shippingAddress || {};
  const userId = o.userId || null;

  let thread = await prisma.messageThread.findFirst({
    where: { vendorId, orderId: o.id, userId },
  });

  if (!thread) {
    thread = await prisma.messageThread.create({
      data: {
        vendorId,
        userId,
        contactName: addr.name || null,
        contactEmail: addr.email || null,
        contactPhone: addr.phone || null,
        orderId: o.id,
      },
    });
  }

  res.json({ ok: true, threadId: thread.id });
});

/* ----------------------------------------------------
   🧾 GET /api/vendor/orders/:id/invoice
----------------------------------------------------- */
router.get("/orders/:id/invoice", requireVendor, async (req, res) => {
  try {
    const vendorId = req.user.vendorId;
    const orderId = String(req.params.id);

    const shipment = await findShipmentByOrderRef({
      vendorId,
      orderRef: orderId,
      include: { order: true, items: true },
    });

    if (!shipment || !shipment.order) {
      return res.status(404).json({ error: "order_not_found_for_vendor" });
    }

    const order = shipment.order;

    const billingProfile = await prisma.vendorBilling.findUnique({
      where: { vendorId },
    });

    const existing = await prisma.invoice.findFirst({
      // Pin explicit pe "query" - date de facturare.
      relationLoadStrategy: "query",
      where: {
        vendorId,
        orderId: order.id,
        direction: "VENDOR_TO_CLIENT",
      },
      include: { lines: true },
    });

    const shipping = order.shippingAddress || {};
    const isCompany = !!(shipping.companyName || shipping.companyCui);

    const customerName =
      (isCompany && (shipping.companyName || shipping.name)) ||
      shipping.name ||
      "";

    const customerAddressStr =
      shipping.address ||
      [shipping.street, shipping.city, shipping.county, shipping.postalCode]
        .filter(Boolean)
        .join(", ");

    const customerExtraIds = [
      shipping.companyCui ? `CUI ${shipping.companyCui}` : null,
      shipping.companyRegCom ? `Reg. Com. ${shipping.companyRegCom}` : null,
    ]
      .filter(Boolean)
      .join(" · ");

    const customerFullAddress = [customerAddressStr, customerExtraIds]
      .filter(Boolean)
      .join(" | ");

    if (existing) {
      const dto = {
        series: existing.series || "FA",
        number: existing.number || "",
        issueDate: existing.issueDate.toISOString().slice(0, 10),
        dueDate: existing.dueDate
          ? existing.dueDate.toISOString().slice(0, 10)
          : existing.issueDate.toISOString().slice(0, 10),
        currency: existing.currency || "RON",
        notes: existing.notes || "",
        vendor: billingProfile
          ? {
              name: billingProfile.companyName,
              cui: billingProfile.cui || "",
              regCom: billingProfile.regCom || "",
              address: billingProfile.address || "",
              iban: billingProfile.iban || "",
              bank: billingProfile.bank || "",
            }
          : null,
        customer: {
          name: existing.clientName || customerName,
          email: existing.clientEmail || shipping.email || "",
          phone: existing.clientPhone || shipping.phone || "",
          address: existing.clientAddress || customerFullAddress,
        },
        lines: (existing.lines || []).map((ln) => ({
          description: ln.description,
          qty: Number(ln.quantity || 0),
          unitPrice: Number(ln.unitNet || 0),
          vatRate: Number(ln.vatRate || 0),
        })),
      };

      return res.json({ invoice: dto });
    }

    const lines =
      shipment.items?.length > 0
        ? shipment.items.map((it) => ({
            description: it.title,
            qty: it.qty,
            unitPrice: Number(it.price || 0),
            vatRate: 19,
          }))
        : [
            {
              description: "Produse comandă",
              qty: 1,
              unitPrice: Number(order.total || 0),
              vatRate: 19,
            },
          ];

    const today = new Date().toISOString().slice(0, 10);

    const draft = {
      series: "FA",
      number: "",
      issueDate: today,
      dueDate: today,
      currency: order.currency || "RON",
      notes: "",
      vendor: billingProfile
        ? {
            name: billingProfile.companyName,
            cui: billingProfile.cui || "",
            regCom: billingProfile.regCom || "",
            address: billingProfile.address || "",
            iban: billingProfile.iban || "",
            bank: billingProfile.bank || "",
          }
        : null,
      customer: {
        name: customerName,
        email: shipping.email || "",
        phone: shipping.phone || "",
        address: customerFullAddress,
      },
      lines,
    };

    return res.json({ invoice: draft });
  } catch (err) {
    console.error("GET /orders/:id/invoice FAILED:", err);
    res.status(500).json({
      error: "invoice_draft_failed",
      message: err?.message || "Nu am putut încărca draftul de factură.",
    });
  }
});

/* ----------------------------------------------------
   🧾 POST /api/vendor/orders/:id/invoice
----------------------------------------------------- */
router.post("/orders/:id/invoice", requireVendor, async (req, res) => {
  try {
    const vendorId = req.user.vendorId;
    const orderId = String(req.params.id);

    const { invoice, sendEmail } = InvoicePayload.parse(req.body || {});

    const shipment = await findShipmentByOrderRef({
      vendorId,
      orderRef: orderId,
      include: { order: true },
    });

    if (!shipment || !shipment.order) {
      return res.status(404).json({ error: "order_not_found_for_vendor" });
    }

    if (isAwaitingAwbLock(shipment)) {
      return lock409(res);
    }

    const order = shipment.order;

    let totalNet = 0;
    let totalVat = 0;

    for (const ln of invoice.lines) {
      const base = Number(ln.qty || 0) * Number(ln.unitPrice || 0);
      const vat = (base * Number(ln.vatRate || 0)) / 100;
      totalNet += base;
      totalVat += vat;
    }
    const totalGross = totalNet + totalVat;

    const issueDate = new Date(invoice.issueDate);
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : issueDate;

    let invoiceStatus = "UNPAID";
    if (order.status === "PAID" || order.status === "FULFILLED") {
      invoiceStatus = "PAID";
    }

    const existing = await prisma.invoice.findFirst({
      // Pin explicit pe "query" - date de facturare.
      relationLoadStrategy: "query",
      where: {
        vendorId,
        orderId: order.id,
        direction: "VENDOR_TO_CLIENT",
      },
      include: { lines: true },
    });

    const number =
      invoice.number && invoice.number.trim().length > 0
        ? invoice.number.trim()
        : await getNextInvoiceNumber(vendorId);

    const commonData = {
      series: invoice.series || "FA",
      number,
      issueDate,
      dueDate,
      currency: invoice.currency || "RON",
      notes: invoice.notes || "",
      clientName: invoice.customer?.name || "",
      clientEmail: invoice.customer?.email || "",
      clientPhone: invoice.customer?.phone || "",
      clientAddress: invoice.customer?.address || "",
      totalNet,
      totalVat,
      totalGross,
      status: invoiceStatus,
      direction: "VENDOR_TO_CLIENT",
      type: "OTHER",
      periodFrom: null,
      periodTo: null,
    };

    const linesCreate = invoice.lines.map((ln) => {
      const qty = Number(ln.qty || 0);
      const unitNet = Number(ln.unitPrice || 0);
      const vatRate = Number(ln.vatRate || 0);
      const base = qty * unitNet;
      const vat = (base * vatRate) / 100;

      return {
        description: ln.description,
        quantity: qty,
        unitNet,
        vatRate,
        totalNet: base,
        totalVat: vat,
        totalGross: base + vat,
      };
    });

    let saved;
    if (existing) {
      saved = await prisma.invoice.update({
        where: { id: existing.id },
        data: {
          ...commonData,
          lines: {
            deleteMany: { invoiceId: existing.id },
            create: linesCreate,
          },
        },
        include: { lines: true },
      });
    } else {
      saved = await prisma.invoice.create({
        data: {
          ...commonData,
          vendorId,
          orderId: order.id,
          lines: { create: linesCreate },
        },
        include: { lines: true },
      });
    }

    const pdfUrl = saved.pdfUrl || null;

    if (sendEmail && saved.clientEmail) {
      try {
        // await mailer.sendInvoiceEmail({ to: saved.clientEmail, pdfUrl });
      } catch (e) {
        console.error("Failed to send invoice email:", e);
      }
    }

    try {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          invoiceNumber: saved.number,
          invoiceDate: saved.issueDate,
        },
      });
    } catch {}

    try {
      if (order.userId) {
        await notifyUserOnInvoiceIssued(order.id, saved.id);
      }
    } catch (e) {
      console.error("notifyUserOnInvoiceIssued failed:", e);
    }

    ordersCache.clear();

    res.json({ ok: true, invoiceId: saved.id, pdfUrl });
  } catch (err) {
    console.error("POST /orders/:id/invoice FAILED:", err);
    res.status(500).json({
      error: "invoice_save_failed",
      message: err?.message || "Nu am putut salva sau trimite factura.",
    });
  }
});

/* ----------------------------------------------------
   🆕 POST /api/vendor/orders/manual
----------------------------------------------------- */
router.post("/orders/manual", requireVendor, async (req, res) => {
  try {
    const vendorId = req.user.vendorId;

    const payload = ManualOrderInput.parse(req.body || {});
    const {
      customer,
      address,
      items,
      shippingPrice,
      paymentMethod,
      vendorNotes,
    } = payload;

    const defaultService = await prisma.vendorService.findFirst({
      where: {
        vendorId,
        type: { code: "products" },
      },
      orderBy: [
        { isActive: "desc" },
        { createdAt: "asc" },
      ],
      select: { id: true },
    });

    const subtotal = items.reduce(
      (sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0),
      0
    );
    const shippingTotal = Number(shippingPrice || 0);
    const total = subtotal + shippingTotal;

    const shippingAddress = {
      name: customer?.name || "",
      email: customer?.email || "",
      phone: customer?.phone || "",
      street: address?.street || "",
      city: address?.city || "",
      county: address?.county || "",
      postalCode: address?.postalCode || "",
    };

    let order;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        order = await prisma.order.create({
          data: {
            orderNumber: generateOrderNumber(),
            status: "PENDING",
            currency: "RON",
            subtotal,
            shippingTotal,
            total,
            paymentMethod,
            shippingAddress,
            vendorNotes: vendorNotes || "",
            userId: null,
          },
        });
        break;
      } catch (e) {
        if (e?.code === "P2002" && attempt < 2) continue;
        throw e;
      }
    }

    const shipment = await prisma.shipment.create({
      data: {
        vendorId,
        orderId: order.id,
        serviceId: defaultService?.id || null,
        status: "PENDING",
        price: shippingTotal,
        items: {
          create: items.map((it) => ({
            title: it.title,
            qty: it.qty,
            price: it.price,
          })),
        },
      },
      include: { items: true },
    });

    try {
      const shortId = shipment.id.slice(-6).toUpperCase();
      await createVendorNotification(vendorId, {
        type: "order",
        title: `Comandă manuală nouă (#${shortId})`,
        body: `Ai creat o comandă manuală pentru ${
          shippingAddress.name || "client"
        } – total ${total.toFixed(2)} RON.`,
        link: `/vendor/orders`,
      });
    } catch (err) {
      console.error("Nu am putut crea notificarea pentru comanda manuală:", err);
    }

    try {
      const to = shippingAddress.email || null;
      if (to) {
        await sendOrderConfirmationEmail({
          to,
          order,
          items: (items || []).map((it) => ({
            title: it.title,
            qty: it.qty,
            price: Number(it.price || 0),
          })),
        });
      }
    } catch (err) {
      console.error("sendOrderConfirmationEmail (manual) failed:", err);
    }

    ordersCache.clear();

    return res.status(201).json({
      ok: true,
      orderId: order.id,
      shipmentId: shipment.id,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({
        error: "invalid_payload",
        details: e.errors,
      });
    }
    console.error("POST /api/vendor/orders/manual failed:", e);
    return res.status(500).json({
      error: "server_error",
      message: "Nu am putut crea comanda manuală.",
    });
  }
});

/* ----------------------------------------------------
   POST /api/vendor/shipments/:id/mark-picked-up
----------------------------------------------------- */
router.post("/shipments/:id/mark-picked-up", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const id = String(req.params.id);

  const s = await prisma.shipment.findFirst({
    where: { id, vendorId },
    include: { order: true },
  });

  if (!s) return res.status(404).json({ error: "not_found" });

  if (s.status === "IN_TRANSIT") {
    return res.json({ ok: true, shipment: s, already: true });
  }

  if (!["PICKUP_SCHEDULED", "READY_FOR_PICKUP"].includes(s.status)) {
    return res.status(409).json({ error: "bad_status" });
  }

  const updated = await prisma.shipment.update({
    where: { id },
    data: { status: "IN_TRANSIT" },
    include: { order: true },
  });

  try {
    const o = updated.order;
    const shippingAddress = o?.shippingAddress || {};
    let to = shippingAddress.email || null;

    if (!to && o?.userId) {
      const user = await prisma.user.findUnique({
        where: { id: o.userId },
        select: { email: true },
      });
      to = user?.email || null;
    }

    if (to) {
      await sendShipmentPickupEmail({
        to,
        orderId: o.id,
        awb: updated.awb || null,
        trackingUrl: updated.trackingUrl || null,
        etaLabel: updated.pickupDate ? "azi/mâine" : null,
        slotLabel:
          updated.pickupSlotStart && updated.pickupSlotEnd
            ? `${updated.pickupSlotStart.toISOString().slice(11, 16)}-${updated.pickupSlotEnd
                .toISOString()
                .slice(11, 16)}`
            : null,
        userId: o.userId || null,
      });
    }
  } catch (e) {
    console.error("sendShipmentPickupEmail (mark-picked-up) failed:", e);
  }

  ordersCache.clear();
  return res.json({ ok: true, shipment: updated });
});

export default router;