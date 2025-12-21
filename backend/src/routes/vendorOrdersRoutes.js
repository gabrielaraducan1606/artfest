// backend/src/routes/vendorOrdersRoutes.js  (ESM)
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { z } from "zod"; // ✅ pentru validarea facturii
import { sendOrderCancelledMessage } from "../services/orderMessaging.js";
import {
  createVendorNotification,
  notifyUserOnOrderStatusChange,
  notifyUserOnInvoiceIssued,
  notifyUserOnShipmentPickupScheduled,
} from "../services/notifications.js"; // 🔔 nou
import { sendShipmentPickupEmail, sendOrderConfirmationEmail } from "../lib/mailer.js";

const prisma = new PrismaClient();
const router = express.Router();
const dec = (n) => Number.parseFloat(Number(n || 0).toFixed(2));

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
  vatRate: z.number().nonnegative(), // procent (ex: 19)
});

const InvoiceInput = z.object({
  series: z.string().optional(),
  number: z.string().optional(),
  issueDate: z.string(), // yyyy-mm-dd
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

  const where = {
    vendorId,
    ...(statusUi ? { status: uiToShipmentStatus(statusUi) } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: from } : {}),
            ...(to
              ? {
                  lte: new Date(new Date(to).setHours(23, 59, 59, 999)),
                }
              : {}),
          },
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.shipment.findMany({
      where,
      include: { order: true, items: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.shipment.count({ where }),
  ]);

  let items = rows.map((s) => {
    const o = s.order;
    const addr = o?.shippingAddress || {};

    // subtotal DOAR pentru produsele din shipment-ul acestui vendor
    const shipmentSubtotal = s.items.reduce(
      (sum, it) => sum + Number(it.price || 0) * it.qty,
      0
    );
    const shipmentShipping = Number(s.price || 0);
    const shipmentTotal = shipmentSubtotal + shipmentShipping;

    return {
      id: s.orderId, // Order.id, folosit în /orders/:id
      shortId: s.id.slice(-6).toUpperCase(),
      createdAt: s.createdAt,

      customerName: addr.name || "",
      customerPhone: addr.phone || "",
      customerEmail: addr.email || "",
      address: addr,

      status: shipmentToUiStatus(s.status),
      total: shipmentTotal, // total pentru acest vendor

      // info curier
      shipmentId: s.id,
      shipmentStatus: s.status,
      awb: s.awb,
      labelUrl: s.labelUrl,
      pickupDate: s.pickupDate,
      pickupSlotStart: s.pickupSlotStart,
      pickupSlotEnd: s.pickupSlotEnd,

      // notițe + plată
      vendorNotes: o?.vendorNotes || "",
      paymentMethod: o?.paymentMethod || null, // CARD / COD

      // info factură (folosite în tabel)
      invoiceNumber: o?.invoiceNumber || null,
      invoiceDate: o?.invoiceDate || null,

      // 💬 placeholder – completăm mai jos
      messageThreadId: null,
      messageUnreadCount: 0,
    };
  });

  // 💬 atașăm info de mesaje (thread + număr necitite) pentru fiecare comandă
  if (items.length > 0) {
    const orderIds = items.map((i) => i.id);

    // luăm thread-urile legate de aceste comenzi
    const threads = await prisma.messageThread.findMany({
      where: {
        vendorId,
        orderId: { in: orderIds },
      },
      select: {
        id: true,
        orderId: true,
        vendorLastReadAt: true,
      },
    });

    // calculăm necitite per thread (doar mesaje care NU sunt de la vendor)
    const threadMetaByOrderId = new Map();

    for (const t of threads) {
      const unreadCount = await prisma.message.count({
        where: {
          threadId: t.id,
          NOT: { authorType: "VENDOR" },
          ...(t.vendorLastReadAt
            ? { createdAt: { gt: t.vendorLastReadAt } }
            : {}),
        },
      });

      threadMetaByOrderId.set(t.orderId, {
        threadId: t.id,
        unreadCount,
      });
    }

    items = items.map((it) => {
      const meta = threadMetaByOrderId.get(it.id);
      if (!meta) return it;
      return {
        ...it,
        messageThreadId: meta.threadId,
        messageUnreadCount: meta.unreadCount,
      };
    });
  }

  // filtrare text liber
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

  res.json({ total, items });
});

/* ----------------------------------------------------
   GET /api/vendor/orders/:id
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
            where: { vendorId }, // doar thread-urile acestui vendor
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

  // subtotal DOAR pentru produsele din shipment-ul acestui vendor
  const shipmentSubtotal = s.items.reduce(
    (sum, it) => sum + Number(it.price || 0) * it.qty,
    0
  );
  const shipmentShipping = Number(s.price || 0);
  const shipmentTotal = shipmentSubtotal + shipmentShipping;

  // PF / PJ – la fel ca la user
  const isCompany = !!(addr.companyName || addr.companyCui);
  const customerType = isCompany ? "PJ" : "PF";

  // 🔹 TVA vendor – din VendorBilling
  const billing = await prisma.vendorBilling.findUnique({
    where: { vendorId },
  });

  const vatStatus = billing?.vatStatus || null; // "payer" | "non_payer"
  const vatRateStr = billing?.vatRate || null; // "19" | "9" | ...
  const vatRate = vatStatus === "payer" ? Number(vatRateStr || 0) : 0;

  function splitGross(gross) {
    const g = Number(gross || 0);
    if (!vatRate || vatRate <= 0) {
      return {
        net: dec(g),
        vat: 0,
        gross: dec(g),
      };
    }
    const net = g / (1 + vatRate / 100);
    const vat = g - net;
    return {
      net: dec(net),
      vat: dec(vat),
      gross: dec(g),
    };
  }

  const itemsBreakdown = splitGross(shipmentSubtotal);
  const shippingBreakdown = splitGross(shipmentShipping);
  const totalBreakdown = {
    net: dec(itemsBreakdown.net + shippingBreakdown.net),
    vat: dec(itemsBreakdown.vat + shippingBreakdown.vat),
    gross: dec(shipmentTotal),
  };

  // 👇 lista de thread-uri (cu internalNote)
  const messageThreads = o.messageThreads || [];

  res.json({
    id: o.id,
    shortId: s.id.slice(-6).toUpperCase(),
    createdAt: o.createdAt,

    subtotal: shipmentSubtotal,
    shippingTotal: shipmentShipping,
    total: shipmentTotal,

    // 🔹 breakdown produse / TVA / transport
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
    customerType, // PF / PJ – pentru UI

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

    // info factură
    invoiceNumber: o.invoiceNumber || null,
    invoiceDate: o.invoiceDate || null,

    // thread-uri legate de comanda asta (inclusiv internalNote)
    messageThreads,
  });
});

/* ----------------------------------------------------
   PATCH /api/vendor/orders/:id/status
   👉 aici notificăm userul despre schimbarea statusului
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
    include: {
      order: true,
    },
  });

  if (!s) return res.status(404).json({ error: "not_found" });

  const updatedShipment = await prisma.shipment.update({
    where: { id: s.id },
    data: {
      status: next,
      // aici poți salva cancelReason / cancelReasonNote dacă ai coloane
    },
  });

  // dacă statusul devine "cancelled" → trimitem mesaj automat
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

  // 🔔 notificare către USER despre noul status (best-effort)
  try {
    const o = s.order;
    if (o?.userId) {
      const vendorUiStatus = shipmentToUiStatus(updatedShipment.status);
      await notifyUserOnOrderStatusChange(o.id, vendorUiStatus);
    }
  } catch (e) {
    console.error("notifyUserOnOrderStatusChange failed:", e);
  }

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

  res.json({
    ok: true,
    vendorNotes: updatedOrder.vendorNotes,
  });
});

/* ----------------------------------------------------
   POST /api/vendor/shipments/:id/schedule-pickup
   👉 aici notificăm userul despre curier / AWB
----------------------------------------------------- */
router.post(
  "/shipments/:id/schedule-pickup",
  requireVendor,
  async (req, res) => {
    const vendorId = req.user.vendorId;
    const id = String(req.params.id);

    const { consents = {}, pickup = {}, dimensions = {} } = req.body || {};

    const s = await prisma.shipment.findFirst({
      where: { id, vendorId },
      include: { order: true },
    });

    if (!s) return res.status(404).json({ error: "not_found" });

    // verificare addendum
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

    if (pickup.day === "tomorrow") {
      pickupDate.setDate(pickupDate.getDate() + 1);
    }

    const [startH, endH] = String(pickup.slot || "14-18")
      .split("-")
      .map((n) => parseInt(n, 10));

    const slotStart = new Date(pickupDate);
    slotStart.setHours(startH || 14, 0, 0, 0);

    const slotEnd = new Date(pickupDate);
    slotEnd.setHours(endH || 18, 0, 0, 0);

    // simulăm curierul
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
      include: {
        order: true,
      },
    });

    const o = updated.order;

    const etaLabel = pickup.day === "today" ? "azi" : "mâine";
    const slotLabel = pickup.slot || "14-18";

    // 🔔 notificare in-app către USER că a fost programată ridicarea / AWB
    try {
      if (o?.id && o.userId) {
        await notifyUserOnShipmentPickupScheduled(o.id, updated.id);
      }
    } catch (e) {
      console.error("notifyUserOnShipmentPickupScheduled failed:", e);
    }

    // ✉️ email către client: „comanda a fost predată curierului”
    try {
      const shippingAddress = o?.shippingAddress || {};
      let to = shippingAddress.email || null;

      // fallback: dacă nu avem email în shippingAddress, luăm din user
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
      // nu dăm fail la request doar pentru că nu a mers mailul
    }

    res.json({
      ok: true,
      awb: updated.awb,
      eta: etaLabel,       // ex: "azi" / "mâine"
      slot: slotLabel,     // ex: "14-18"
      labelUrl: updated.labelUrl,
      trackingUrl: updated.trackingUrl,
    });
  }
);

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
   Vendorul pornește / deschide conversația cu clientul
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

  // căutăm un thread existent pentru acest vendor + comandă + user
  let thread = await prisma.messageThread.findFirst({
    where: {
      vendorId,
      orderId: o.id,
      userId,
    },
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
   Draft / factură existentă (pentru InvoiceModal)
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

    // 🔹 PF vs PJ pentru client
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

    // draft nou din ShipmentItem
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
   Salvează & (opțional) trimite factura
   👉 aici notificăm userul că are factură
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

    // calculăm totalurile
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
          lines: {
            create: linesCreate,
          },
        },
        include: { lines: true },
      });
    }

    // TODO: generare PDF reală
    const pdfUrl = saved.pdfUrl || null;

    // opțional: trimiți mail clientului
    if (sendEmail && saved.clientEmail) {
      try {
        // aici poți integra mailer real
        // await mailer.sendInvoiceEmail({ to: saved.clientEmail, pdfUrl });
      } catch (e) {
        console.error("Failed to send invoice email:", e);
      }
    }

    // opțional: updatăm Order cu invoiceNumber / invoiceDate pentru UI
    try {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          invoiceNumber: saved.number,
          invoiceDate: saved.issueDate,
        },
      });
    } catch {
      // dacă nu ai câmpurile în schema, nu vrem să crape endpoint-ul
    }

    // 🔔 notificare către USER despre factură (best-effort)
    try {
      if (order.userId) {
        await notifyUserOnInvoiceIssued(order.id, saved.id);
      }
    } catch (e) {
      console.error("notifyUserOnInvoiceIssued failed:", e);
    }

    res.json({
      ok: true,
      invoiceId: saved.id,
      pdfUrl,
    });
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
   Vendorul creează o comandă manuală (order + shipment)
   + trimite email de confirmare către client (best-effort)
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

    // Order general (fără userId => comandă manuală, creată de vendor)
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

        // ⚠️ păstrează doar dacă Order.userId e nullable în Prisma
        userId: null,
      },
    });

    // Shipment specific vendorului curent
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
      include: {
        items: true,
      },
    });

    // 🔔 Notificare pentru vendor despre comanda manuală
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

    // ✉️ Email către client: confirmare comandă (best-effort)
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
          // opțional: dacă vrei să pui adrese retur:
          // storeAddresses: { ... }
        });
      }
    } catch (err) {
      console.error("sendOrderConfirmationEmail (manual) failed:", err);
      // nu crăpăm endpoint-ul dacă mailul nu se trimite
    }

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
