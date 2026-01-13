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

const dec = (n) => Number.parseFloat(Number(n || 0).toFixed(2));
const isPostgres =
  (process.env.DATABASE_URL || "").startsWith("postgres://") ||
  (process.env.DATABASE_URL || "").startsWith("postgresql://");

/* ----------------------------------------------------
   Tiny cache (TTL) pentru listă (reduce load, “instant feel”)
----------------------------------------------------- */
const ORDERS_CACHE_TTL_MS = 3000; // 3 sec
const ordersCache = new Map(); // key -> { ts, payload }

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
  // prevenim creștere nelimitată
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
  } catch {
    /* ignorăm erorile */
  }

  next();
});

/* ----------------------------------------------------
   Guard VENDOR
----------------------------------------------------- */
function requireVendor(req, res, next) {
  // dev bypass
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
    case "confirmed":
      return "READY_FOR_PICKUP";
    case "fulfilled":
      return "DELIVERED";
    case "cancelled":
      return "RETURNED";
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
      return "confirmed";
    case "DELIVERED":
      return "fulfilled";
    case "RETURNED":
      return "cancelled";
    default:
      return "new";
  }
}

/* ----------------------------------------------------
   🎫 Zod schema pentru facturi (InvoiceModal)
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

/* helper pentru număr factură */
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

/* ----------------------------------------------------
   Helper: unread meta per orderId
   - Postgres: 1 query (rapid)
   - fallback: Promise.all counts (concurent)
----------------------------------------------------- */
async function getThreadMetaByOrderId({ vendorId, orderIds }) {
  if (!orderIds?.length) return new Map();

  const threads = await prisma.messageThread.findMany({
    where: { vendorId, orderId: { in: orderIds } },
    select: { id: true, orderId: true, vendorLastReadAt: true },
  });

  if (!threads.length) return new Map();

  // ✅ Postgres: single query join+count cu vendorLastReadAt per thread
  if (isPostgres) {
    const threadIds = threads.map((t) => t.id);

    // Note: queryRaw sigur aici pentru perf. Ajustează numele tabelelor dacă diferă.
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

    // Dacă există thread fără mesaje, queryRaw poate întoarce unreadCount 0, dar tot îl include
    // însă păstrăm oricum meta minimal:
    for (const t of threads) {
      if (!map.has(t.orderId)) {
        map.set(t.orderId, { threadId: t.id, unreadCount: 0 });
      }
    }

    return map;
  }

  // ✅ Fallback (alte DB): counts in paralel (mult mai rapid decât for+await)
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
   (OPTIMIZAT)
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

  // tiny cache key (vendor + querystring)
  const cacheKey = `v:${vendorId}|q:${q}|st:${statusUi}|f:${from ? from.toISOString() : ""}|t:${
    to ? to.toISOString() : ""
  }|p:${page}|ps:${pageSize}`;

  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  const where = {
    vendorId,
    ...(statusUi ? { status: uiToShipmentStatus(statusUi) } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: endOfDay(to) } : {}),
          },
        }
      : {}),
  };

  // ✅ select minim (mai rapid decât include: true)
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

        // shipping price per shipment (vendor)
        price: true,

        // curier
        awb: true,
        labelUrl: true,
        pickupDate: true,
        pickupSlotStart: true,
        pickupSlotEnd: true,

        // items minimal pentru subtotal
        items: { select: { qty: true, price: true } },

        // order minimal pentru tabel
        order: {
          select: {
            paymentMethod: true,
            vendorNotes: true,
            invoiceNumber: true,
            invoiceDate: true,
            shippingAddress: true, // JSON; dacă devine prea mare, denormalizează name/email/phone în Shipment
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
      id: s.orderId, // Order.id, folosit în /orders/:id
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
      awb: s.awb,
      labelUrl: s.labelUrl,
      pickupDate: s.pickupDate,
      pickupSlotStart: s.pickupSlotStart,
      pickupSlotEnd: s.pickupSlotEnd,

      vendorNotes: o.vendorNotes || "",
      paymentMethod: o.paymentMethod || null,

      invoiceNumber: o.invoiceNumber || null,
      invoiceDate: o.invoiceDate || null,

      messageThreadId: null,
      messageUnreadCount: 0,
    };
  });

  // ✅ q filter (păstrat ca înainte pentru compatibilitate)
  // NOTĂ: ideal e să muți în DB (mai ales dacă ai multe comenzi).
  if (q) {
    const Q = q.toLowerCase();
    items = items.filter(
      (r) =>
        (r.customerName || "").toLowerCase().includes(Q) ||
        (r.customerPhone || "").toLowerCase().includes(Q) ||
        (r.customerEmail || "").toLowerCase().includes(Q) ||
        (r.id || "").toLowerCase().includes(Q) ||
        (r.shortId || "").toLowerCase().includes(Q)
    );
  }

  // ✅ meta mesaje: fără N+1 secvențial
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

/* ----------------------------------------------------
   GET /api/vendor/orders/:id
   (păstrat aproape identic)
----------------------------------------------------- */
router.get("/orders/:id", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const orderId = String(req.params.id);

  const s = await prisma.shipment.findFirst({
    where: { orderId, vendorId },
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

  const messageThreads = o.messageThreads || [];

  res.json({
    id: o.id,
    shortId: s.id.slice(-6).toUpperCase(),
    createdAt: o.createdAt,

    subtotal: shipmentSubtotal,
    shippingTotal: shipmentShipping,
    total: shipmentTotal,

    priceBreakdown: {
      vatRate,
      vatStatus,
      items: itemsBreakdown,
      shipping: shippingBreakdown,
      total: totalBreakdown,
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
      pickupDate: s.pickupDate,
      pickupSlotStart: s.pickupSlotStart,
      pickupSlotEnd: s.pickupSlotEnd,
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
  const next = uiToShipmentStatus(nextUi);
  if (!next) return res.status(400).json({ error: "bad_status" });

  const cancelReason = req.body?.cancelReason || null;
  const cancelReasonNote = req.body?.cancelReasonNote || null;

  const s = await prisma.shipment.findFirst({
    where: { orderId, vendorId },
    include: { order: true },
  });

  if (!s) return res.status(404).json({ error: "not_found" });

  const updatedShipment = await prisma.shipment.update({
    where: { id: s.id },
    data: {
      status: next,
    },
  });

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
      const vendorUiStatus = shipmentToUiStatus(updatedShipment.status);
      await notifyUserOnOrderStatusChange(o.id, vendorUiStatus);
    }
  } catch (e) {
    console.error("notifyUserOnOrderStatusChange failed:", e);
  }

  // invalidează cache rapid (simplu)
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

  const s = await prisma.shipment.findFirst({
    where: { orderId, vendorId },
    include: { order: true },
  });

  if (!s) return res.status(404).json({ error: "not_found" });

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

  const awb = "AWB" + id.slice(-8).toUpperCase();
  const labelUrl = `https://labels.example/${awb}.pdf`;
  const trackingUrl = `https://track.example/${awb}`;

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
      awb,
      labelUrl,
      trackingUrl,
      courierProvider: "YOUR_PROVIDER",
      courierService: "standard24h",
    },
    include: { order: true },
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

  try {
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
        awb: updated.awb,
        trackingUrl: updated.trackingUrl,
        etaLabel,
        slotLabel,
      });
    }
  } catch (e) {
    console.error("sendShipmentPickupEmail failed:", e);
  }

  ordersCache.clear();

  res.json({
    ok: true,
    awb: updated.awb,
    eta: etaLabel,
    slot: slotLabel,
    labelUrl: updated.labelUrl,
    trackingUrl: updated.trackingUrl,
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

  const s = await prisma.shipment.findFirst({
    where: { orderId, vendorId },
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
   (păstrat)
----------------------------------------------------- */
router.get("/orders/:id/invoice", requireVendor, async (req, res) => {
  try {
    const vendorId = req.user.vendorId;
    const orderId = String(req.params.id);

    const shipment = await prisma.shipment.findFirst({
      where: { orderId, vendorId },
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
      [
        shipping.street,
        shipping.city,
        shipping.county,
        shipping.postalCode,
      ]
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

    const shipment = await prisma.shipment.findFirst({
      where: { orderId, vendorId },
      include: { order: true },
    });

    if (!shipment || !shipment.order) {
      return res.status(404).json({ error: "order_not_found_for_vendor" });
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
    } catch {
      // ok
    }

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
    const { customer, address, items, shippingPrice, paymentMethod, vendorNotes } =
      payload;

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

    const order = await prisma.order.create({
      data: {
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

export default router;
