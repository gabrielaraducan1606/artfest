// ./src/routes/vendorOrdersRoutes.js  (ESM)
import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = express.Router();

/* -------------------------------------------
   Middleware local: atașează req.user dacă există token
   - caută token în cookie: token / access_token
   - sau în Authorization: Bearer <jwt>
   ------------------------------------------- */
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
      select: { id: true, email: true, role: true, vendor: { select: { id: true } } },
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
    // token lipsă/invalid/expirat -> mergem mai departe fără user
  }
  next();
});

// Dacă ai deja middleware-ul tău de auth, importă-l și folosește-l.
// Aici păstrăm un guard minimal:
function requireVendor(req, res, next) {
  // DEV helper: permite bypass dacă nu ai login încă (doar local)
  if (!req.user && process.env.NODE_ENV !== "production" && process.env.DEV_VENDOR_ID) {
    req.user = { id: "dev", email: "dev@local", role: "VENDOR", vendorId: process.env.DEV_VENDOR_ID };
  }
  if (!req.user || req.user.role !== "VENDOR" || !req.user.vendorId) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

/* helpers map UI <-> DB */
function uiToShipmentStatus(ui) {
  switch (ui) {
    case "new":        return "PENDING";
    case "preparing":  return "PREPARING";
    case "confirmed":  return "READY_FOR_PICKUP";
    case "fulfilled":  return "DELIVERED";
    case "cancelled":  return "RETURNED";
    default: return null;
  }
}
function shipmentToUiStatus(st) {
  switch (st) {
    case "PENDING":           return "new";
    case "PREPARING":         return "preparing";
    case "READY_FOR_PICKUP":
    case "PICKUP_SCHEDULED":  return "confirmed";
    case "DELIVERED":         return "fulfilled";
    case "RETURNED":          return "cancelled";
    default:                  return "new";
  }
}

/* GET /api/vendor/orders */
router.get("/orders", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const q = String(req.query.q || "").trim();
  const statusUi = String(req.query.status || "");
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to   = req.query.to   ? new Date(String(req.query.to))   : null;
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "20", 10)));

  const where = {
    vendorId,
    ...(statusUi ? { status: uiToShipmentStatus(statusUi) } : {}),
    ...(from || to ? {
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to   ? { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) } : {}),
      },
    } : {}),
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
    const addr = s.order?.shippingAddress || {};
    return {
      id: s.orderId,
      shortId: s.id.slice(-6).toUpperCase(),
      createdAt: s.createdAt,
      customerName: addr.name || "",
      customerPhone: addr.phone || "",
      customerEmail: addr.email || "",
      address: addr,
      status: shipmentToUiStatus(s.status),
      total: s.order?.total,
      shipmentId: s.id,
      shipmentStatus: s.status,
      awb: s.awb,
      labelUrl: s.labelUrl,
      pickupDate: s.pickupDate,
      pickupSlotStart: s.pickupSlotStart,
      pickupSlotEnd: s.pickupSlotEnd,
    };
  });

  if (q) {
    const Q = q.toLowerCase();
    items = items.filter((r) =>
      (r.customerName || "").toLowerCase().includes(Q) ||
      (r.customerPhone || "").toLowerCase().includes(Q) ||
      (r.customerEmail || "").toLowerCase().includes(Q) ||
      (r.id || "").toLowerCase().includes(Q) ||
      (r.shortId || "").toLowerCase().includes(Q)
    );
  }

  res.json({ total, items });
});

/* GET /api/vendor/orders/:id */
router.get("/orders/:id", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const orderId = String(req.params.id);

  const s = await prisma.shipment.findFirst({
    where: { orderId, vendorId },
    include: { order: true, items: true },
  });
  if (!s) return res.status(404).json({ error: "not_found" });

  const o = s.order;
  res.json({
    id: o.id,
    shortId: s.id.slice(-6).toUpperCase(),
    createdAt: o.createdAt,
    subtotal: o.subtotal,
    shippingTotal: o.shippingTotal,
    total: o.total,
    status: shipmentToUiStatus(s.status),
    statusLabel: {
      new: "Nouă",
      preparing: "În pregătire",
      confirmed: "Confirmată (gata de predare)",
      fulfilled: "Finalizată",
      cancelled: "Anulată",
    }[shipmentToUiStatus(s.status)],
    shippingAddress: o.shippingAddress,
    items: s.items.map((it) => ({ id: it.id, title: it.title, qty: it.qty, price: it.price })),
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
  });
});

/* PATCH /api/vendor/orders/:id/status */
router.patch("/orders/:id/status", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const orderId = String(req.params.id);
  const nextUi = String(req.body?.status || "");
  const next = uiToShipmentStatus(nextUi);
  if (!next) return res.status(400).json({ error: "bad_status" });

  const s = await prisma.shipment.findFirst({ where: { orderId, vendorId } });
  if (!s) return res.status(404).json({ error: "not_found" });

  const updated = await prisma.shipment.update({ where: { id: s.id }, data: { status: next } });
  res.json({ ok: true, shipment: updated });
});

/* POST /api/vendor/shipments/:id/schedule-pickup */
router.post("/shipments/:id/schedule-pickup", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const id = String(req.params.id);
  const { consents = {}, pickup = {}, dimensions = {} } = req.body || {};

  const s = await prisma.shipment.findFirst({ where: { id, vendorId }, include: { order: true } });
  if (!s) return res.status(404).json({ error: "not_found" });

  // (opțional) verificare addendum
  const policy = await prisma.vendorPolicy.findFirst({ where: { document: "SHIPPING_ADDENDUM", isActive: true } });
  if (policy) {
    const ok = await prisma.vendorAcceptance.findFirst({ where: { vendorId, document: "SHIPPING_ADDENDUM", version: policy.version } });
    if (!ok) return res.status(412).json({ error: "policy_not_accepted", policy: { version: policy.version, url: policy.url } });
  }

  const now = new Date();
  const pickupDate = new Date(now);
  if (pickup.day === "tomorrow") pickupDate.setDate(pickupDate.getDate() + 1);
  const [startH, endH] = String(pickup.slot || "14-18").split("-").map((n) => parseInt(n, 10));
  const slotStart = new Date(pickupDate); slotStart.setHours(startH || 14, 0, 0, 0);
  const slotEnd   = new Date(pickupDate); slotEnd.setHours(endH || 18, 0, 0, 0);

  // TODO: integrare reală curier – momentan simulăm
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
      awb, labelUrl, trackingUrl,
      courierProvider: "YOUR_PROVIDER",
      courierService: "standard24h",
    },
  });

  res.json({
    ok: true,
    awb: updated.awb,
    eta: pickup.day === "today" ? "azi" : "mâine",
    slot: pickup.slot || "14-18",
    labelUrl: updated.labelUrl,
    trackingUrl: updated.trackingUrl,
  });
});

/* GET /api/vendor/shipments/:id/label */
router.get("/shipments/:id/label", requireVendor, async (req, res) => {
  const vendorId = req.user.vendorId;
  const id = String(req.params.id);
  const s = await prisma.shipment.findFirst({ where: { id, vendorId } });
  if (!s) return res.status(404).json({ error: "not_found" });
  if (!s.labelUrl) return res.status(404).json({ error: "label_missing" });
  res.redirect(s.labelUrl);
});

export default router;
