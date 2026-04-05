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
} from "../services/notifications.js";
import {
  sendShipmentPickupEmail,
  sendOrderConfirmationEmail,
} from "../lib/mailer.js";

const prisma = new PrismaClient();
const router = express.Router();

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
      status: "active",
      endAt: { gt: now },
    },
    include: { plan: true },
    orderBy: { endAt: "desc" },
  });

  if (sub?.plan) return sub.plan;

  const starter = await prisma.subscriptionPlan.findUnique({
    where: { code: "starter" },
  });

  return starter ?? { code: "starter", name: "Starter", commissionBps: 0 };
}

/* ----------------------------------------------------
   ✅ Ledger helpers (earnings)
----------------------------------------------------- */
function round2(n) {
  return Number.parseFloat(Number(n || 0).toFixed(2));
}

/**
 * Calculează earning-ul vendorului pe shipment, folosind aceeași logică ca în GET /orders/:id:
 * - items subtotal gross -> net în funcție de TVA vendor
 * - comision pe itemsNet (bps din plan)
 * - vendorNet = itemsNet - commissionNet
 *
 * Notă: shipping NU intră în earning vendor.
 */
async function computeVendorEarningForShipment({ vendorId, shipmentId }) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: { items: true, order: true },
  });
  if (!shipment) throw new Error("shipment_not_found");

  const billing = await prisma.vendorBilling.findUnique({ where: { vendorId } });
  const vatStatus = billing?.vatStatus || null;
  const vatRate = vatStatus === "payer" ? Number(billing?.vatRate || 0) : 0;

  const subtotalGross = (shipment.items || []).reduce(
    (sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0),
    0
  );

  const itemsNet =
    vatRate > 0 ? subtotalGross / (1 + vatRate / 100) : subtotalGross;

  const plan = await getActivePlanForVendor(vendorId);
  let commissionBps = Number(plan?.commissionBps || 0);
  if (!Number.isFinite(commissionBps) || commissionBps < 0) commissionBps = 0;

  const commissionNet = round2((itemsNet * commissionBps) / 10000);
  const vendorNet = round2(itemsNet - commissionNet);

  return {
    currency: shipment.order?.currency || "RON",
    orderId: shipment.orderId,
    itemsNet: round2(itemsNet),
    commissionNet,
    vendorNet,
    vatStatus,
    vatRate,
    commissionBps,
  };
}

async function ensureSaleLedgerEntry({ vendorId, shipmentId }) {
  const earning = await computeVendorEarningForShipment({ vendorId, shipmentId });

  return prisma.vendorEarningEntry.upsert({
    where: { shipmentId },
    update: {},
    create: {
      vendorId,
      shipmentId,
      orderId: earning.orderId,
      type: "SALE",
      occurredAt: new Date(),
      currency: earning.currency,
      itemsNet: earning.itemsNet,
      commissionNet: earning.commissionNet,
      vendorNet: earning.vendorNet,
      meta: {
        source: "shipment_status_fulfilled",
        vatStatus: earning.vatStatus,
        vatRate: earning.vatRate,
        commissionBps: earning.commissionBps,
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
      return "fulfilled";
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
  if (st === "DELIVERED") return "DELIVERED";
  if (st === "RETURNED") return "RETURNED";
  if (st === "REFUSED") return "CANCELED";
  if (["AWB", "IN_TRANSIT"].includes(st)) return "SHIPPED";
  if (["PREPARING", "READY_FOR_PICKUP", "PICKUP_SCHEDULED"].includes(st))
    return "PROCESSING";
  return "PENDING";
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
router.get("/orders", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;

  const q = String(req.query.q || "").trim();
  const statusUi = String(req.query.status || "");
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;

  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(req.query.pageSize || "20", 10))
  );

  const cacheKey = `v:${vendorId}|q:${q}|st:${statusUi}|f:${
    from ? from.toISOString() : ""
  }|t:${to ? to.toISOString() : ""}|p:${page}|ps:${pageSize}`;

  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  const where = {
    vendorId,
    ...(statusUi === "confirmed"
      ? { status: { in: ["READY_FOR_PICKUP", "PICKUP_SCHEDULED", "AWB"] } }
      : statusUi === "fulfilled"
      ? { status: { in: ["IN_TRANSIT", "DELIVERED"] } }
      : statusUi === "cancelled"
      ? { status: { in: ["RETURNED", "REFUSED"] } }
      : statusUi
      ? { status: uiToShipmentStatus(statusUi) }
      : {}),
  };

  if (q) {
    where.OR = [
      { orderId: { contains: q } },
      { order: { orderNumber: { contains: q, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.shipment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        orderId: true,
        createdAt: true,
        status: true,
        price: true,
        courierProvider: true,
        courierService: true,
        awb: true,
        labelUrl: true,
        pickupDate: true,
        pickupSlotStart: true,
        pickupSlotEnd: true,
        pickupScheduledAt: true,
        deliveredAt: true,
        refusedAt: true,
        returnedAt: true,
        items: { select: { qty: true, price: true } },
        order: {
          select: {
            orderNumber: true,
            paymentMethod: true,
            vendorNotes: true,
            invoiceNumber: true,
            invoiceDate: true,
            shippingAddress: true,
          },
        },
      },
    }),
    prisma.shipment.count({ where }),
  ]);

  let items = rows.map((s) => {
    const o = s.order || {};
    const addr = o.shippingAddress || {};

    const shipmentSubtotal = (s.items || []).reduce(
      (sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0),
      0
    );
    const shipmentShipping = Number(s.price || 0);
    const shipmentTotal = shipmentSubtotal + shipmentShipping;

    return {
      id: s.orderId,
      orderNumber: o.orderNumber || null,
      shortId: String(s.id).slice(-6).toUpperCase(),
      createdAt: s.createdAt,
      customerName: addr.name || "",
      customerPhone: addr.phone || "",
      customerEmail: addr.email || "",
      address: addr,
      status: shipmentToUiStatus(s.status),
      total: shipmentTotal,
      shipmentId: s.id,
      shipmentStatus: s.status,
      courierProvider: s.courierProvider || null,
      courierService: s.courierService || null,
      awb: s.awb,
      labelUrl: s.labelUrl,
      pickupScheduledAt: s.pickupScheduledAt,
      pickupDate: s.pickupDate,
      pickupSlotStart: s.pickupSlotStart,
      pickupSlotEnd: s.pickupSlotEnd,
      deliveredAt: s.deliveredAt || null,
      refusedAt: s.refusedAt || null,
      returnedAt: s.returnedAt || null,
      vendorNotes: o.vendorNotes || "",
      paymentMethod: o.paymentMethod || null,
      invoiceNumber: o.invoiceNumber || null,
      invoiceDate: o.invoiceDate || null,
      messageThreadId: null,
      messageUnreadCount: 0,
    };
  });

  if (items.length > 0) {
    const orderIds = items.map((i) => i.id);
    const metaByOrderId = await getThreadMetaByOrderId({ vendorId, orderIds });

    items = items.map((it) => {
      const meta = metaByOrderId.get(it.id);
      if (!meta) return it;
      return {
        ...it,
        messageThreadId: meta.threadId,
        messageUnreadCount: meta.unreadCount,
      };
    });
  }

  const payload = { total, items };
  cacheSet(cacheKey, payload);
  res.json(payload);
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
router.get("/orders/:id", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const orderId = String(req.params.id);

  const s = await findShipmentByOrderRef({
    vendorId,
    orderRef: orderId,
    include: {
      order: {
        include: {
          messageThreads: {
            where: { vendorId },
            select: {
              id: true,
              internalNote: true,
              followUpAt: true,
              leadStatus: true,
              contactName: true,
              contactPhone: true,
            },
          },
        },
      },
      items: true,
    },
  });

  if (!s) return res.status(404).json({ error: "not_found" });

  const o = s.order;
  const addr = o?.shippingAddress || {};

  const shipmentSubtotal = s.items.reduce(
    (sum, it) => sum + Number(it.price || 0) * it.qty,
    0
  );
  const shipmentShipping = Number(s.price || 0);
  const shipmentTotal = shipmentSubtotal + shipmentShipping;

  const isCompany = !!(addr.companyName || addr.companyCui);
  const customerType = isCompany ? "PJ" : "PF";

  const billing = await prisma.vendorBilling.findUnique({
    where: { vendorId },
  });

  const vatStatus = billing?.vatStatus || null;
  const vatRateStr = billing?.vatRate || null;
  const vatRate = vatStatus === "payer" ? Number(vatRateStr || 0) : 0;

  function splitGross(gross) {
    const g = Number(gross || 0);
    if (!vatRate || vatRate <= 0) {
      return { net: dec(g), vat: 0, gross: dec(g) };
    }
    const net = g / (1 + vatRate / 100);
    const vat = g - net;
    return { net: dec(net), vat: dec(vat), gross: dec(g) };
  }

  const itemsBreakdown = splitGross(shipmentSubtotal);
  const shippingBreakdown = splitGross(shipmentShipping);
  const totalBreakdown = {
    net: dec(itemsBreakdown.net + shippingBreakdown.net),
    vat: dec(itemsBreakdown.vat + shippingBreakdown.vat),
    gross: dec(shipmentTotal),
  };

  let commissionBps = 0;
  try {
    const plan = await getActivePlanForVendor(vendorId);
    commissionBps = Number(plan?.commissionBps || 0);
    if (!Number.isFinite(commissionBps) || commissionBps < 0) commissionBps = 0;
  } catch (e) {
    console.error("getActivePlanForVendor failed:", e);
    commissionBps = 0;
  }

  const itemsNet = Number(itemsBreakdown?.net || 0);
  const commissionNet = round2((itemsNet * commissionBps) / 10000);
  const vendorNetBeforeShipping = round2(itemsNet - commissionNet);

  const vendorFinancials = {
    commissionBps,
    commissionRate: round2(commissionBps / 10000),
    itemsNet: round2(itemsNet),
    commissionNet,
    vendorNetBeforeShipping,
  };

  const messageThreads = o.messageThreads || [];

  res.json({
    id: o.id,
    orderNumber: o.orderNumber || null,
    shortId: s.id.slice(-6).toUpperCase(),
    createdAt: o.createdAt,
    subtotal: shipmentSubtotal,
    shippingTotal: shipmentShipping,
    total: shipmentTotal,
    priceBreakdown: {
      vatRate,
      vatStatus,
      items: itemsBreakdown,
      total: totalBreakdown,
      vendorFinancials,
    },
    status: shipmentToUiStatus(s.status),
    statusLabel: {
      new: "Nouă",
      preparing: "În pregătire",
      confirmed: "Confirmată (gata de predare)",
      fulfilled: "Finalizată",
      cancelled: "Anulată",
    }[shipmentToUiStatus(s.status)],
    shippingAddress: addr,
    customerType,
    items: s.items.map((it) => ({
      id: it.id,
      title: it.title,
      qty: it.qty,
      price: it.price,
    })),
    vendorNotes: o.vendorNotes || "",
    paymentMethod: o.paymentMethod || null,
    shipment: {
      id: s.id,
      courierProvider: s.courierProvider,
      courierService: s.courierService,
      awb: s.awb,
      labelUrl: s.labelUrl,
      trackingUrl: s.trackingUrl,
      pickupScheduledAt: s.pickupScheduledAt,
      pickupDate: s.pickupDate,
      pickupSlotStart: s.pickupSlotStart,
      pickupSlotEnd: s.pickupSlotEnd,
      deliveredAt: s.deliveredAt || null,
      refusedAt: s.refusedAt || null,
      returnedAt: s.returnedAt || null,
      parcels: s.parcels,
      weightKg: s.weightKg,
      lengthCm: s.lengthCm,
      widthCm: s.widthCm,
      heightCm: s.heightCm,
      consents: s.consents,
    },
    invoiceNumber: o.invoiceNumber || null,
    invoiceDate: o.invoiceDate || null,
    messageThreads,
  });
});

/* ----------------------------------------------------
   PATCH /api/vendor/orders/:id/status
----------------------------------------------------- */
router.patch("/orders/:id/status", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const orderId = String(req.params.id);

  const nextUi = String(req.body?.status || "");

  let next = null;
  switch (nextUi) {
    case "new":
      next = "PENDING";
      break;
    case "preparing":
      next = "PREPARING";
      break;
    case "confirmed":
      next = "READY_FOR_PICKUP";
      break;
    case "fulfilled":
      next = "DELIVERED";
      break;
    case "cancelled":
      next = "REFUSED";
      break;
    default:
      next = null;
  }

  if (!next) return res.status(400).json({ error: "bad_status" });

  const cancelReason = req.body?.cancelReason || null;
  const cancelReasonNote = req.body?.cancelReasonNote || null;

  const s = await findShipmentByOrderRef({
    vendorId,
    orderRef: orderId,
    include: { order: true },
  });
  if (!s) return res.status(404).json({ error: "not_found" });

  if (isAwaitingAwbLock(s)) {
    return lock409(res);
  }

  const updatedShipment = await prisma.shipment.update({
    where: { id: s.id },
    data: { status: next },
    include: { order: true },
  });

  if (nextUi === "cancelled") {
    const all = await prisma.shipment.findMany({
      where: { orderId: updatedShipment.orderId },
      select: { status: true },
    });

    const allCancelled = all.every((x) =>
      ["REFUSED", "RETURNED"].includes(x.status)
    );

    if (allCancelled) {
      await prisma.order.update({
        where: { id: updatedShipment.orderId },
        data: { status: "CANCELLED" },
      });
    }
  }

  try {
    if (updatedShipment.status === "DELIVERED") {
      await ensureSaleLedgerEntry({ vendorId, shipmentId: updatedShipment.id });
    }

    if (updatedShipment.status === "REFUSED" || updatedShipment.status === "RETURNED") {
      await ensureRefundLedgerEntry({ vendorId, shipmentId: updatedShipment.id });
    }
  } catch (e) {
    console.error("Ledger update failed:", e);
  }

  if (nextUi === "cancelled") {
    try {
      const o = s.order;
      const shippingAddress = o?.shippingAddress || {};

      await sendOrderCancelledMessage({
        orderId: o.id,
        shipmentId: s.id,
        shortShipmentId: s.id.slice(-6).toUpperCase(),
        userId: o.userId,
        vendorId,
        shippingAddress,
        cancelReason,
        cancelReasonNote,
      });
    } catch (e) {
      console.error("Eroare la sendOrderCancelledMessage:", e);
    }
  }

  try {
    const o = s.order;
    if (o?.userId) {
      const userUiStatus = shipmentToUserUiStatus(updatedShipment.status);
      await notifyUserOnOrderStatusChange(o.id, userUiStatus);
    }
  } catch (e) {
    console.error("notifyUserOnOrderStatusChange failed:", e);
  }

  ordersCache.clear();
  res.json({ ok: true, shipment: updatedShipment });
});

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
    where: { id, vendorId },
    include: { order: true },
  });

  if (!s) return res.status(404).json({ error: "not_found" });

  const policy = await prisma.vendorPolicy.findFirst({
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