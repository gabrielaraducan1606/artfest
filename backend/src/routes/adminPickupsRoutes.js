import express from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

import { sseBroadcastToVendor } from "./vendorOrdersRoutes.js";
import { notifyVendorOnAwbAssigned } from "../services/notifications.js";

const prisma = new PrismaClient();
const router = express.Router();

/* ---------------------------
   Attach req.user from token
---------------------------- */
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
      select: { id: true, email: true, role: true },
    });

    if (user) req.user = user;
  } catch {
    // ignore
  }
  next();
});

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/* ------------------------------------------
   GET /api/admin/pickups
   - keep ALL shipments that entered pickup flow (pickupScheduledAt != null)
   - status optional filter
   - direction optional filter: OUTBOUND | RETURN
   - q in Prisma (pagination + total ok)
   ✅ include order.orderNumber and allow search by it
------------------------------------------- */
router.get("/pickups", requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();
    const direction = String(req.query.direction || "").trim(); // OUTBOUND | RETURN
    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "20", 10)));

    const qWhere = q
      ? {
          OR: [
            { awb: { contains: q, mode: "insensitive" } },
            { id: { contains: q, mode: "insensitive" } },
            { orderId: { contains: q, mode: "insensitive" } },
            {
              order: {
                is: { orderNumber: { contains: q, mode: "insensitive" } },
              },
            },
            { courierProvider: { contains: q, mode: "insensitive" } },
            { courierService: { contains: q, mode: "insensitive" } },
            {
              vendor: {
                is: {
                  OR: [
                    { displayName: { contains: q, mode: "insensitive" } },
                    { email: { contains: q, mode: "insensitive" } },
                    {
                      user: {
                        is: { email: { contains: q, mode: "insensitive" } },
                      },
                    },
                  ],
                },
              },
            },
          ],
        }
      : null;

    const where = {
      pickupScheduledAt: { not: null },
      ...(status ? { status } : {}),
      ...(direction ? { direction } : {}),
      ...(from || to
        ? {
            pickupScheduledAt: {
              not: null,
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: endOfDay(to) } : {}),
            },
          }
        : {}),
      ...(qWhere ? qWhere : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.shipment.findMany({
        where,
        orderBy: { pickupScheduledAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderId: true,
          vendorId: true,
          status: true,

          // ✅ NEW: returns support
          direction: true,
          returnRequestId: true,

          courierProvider: true,
          courierService: true,

          awb: true,
          pickupDate: true,
          pickupSlotStart: true,
          pickupSlotEnd: true,
          pickupScheduledAt: true,

          parcels: true,
          weightKg: true,
          lengthCm: true,
          widthCm: true,
          heightCm: true,

          labelUrl: true,
          trackingUrl: true,

          order: {
            select: {
              orderNumber: true,
              shippingAddress: true,
              createdAt: true,
              total: true,
              paymentMethod: true,
            },
          },

          vendor: {
            select: {
              id: true,
              displayName: true,
              email: true,
              user: { select: { email: true } },
            },
          },
        },
      }),
      prisma.shipment.count({ where }),
    ]);

    const items = (rows || []).map((s) => {
      const addr = s.order?.shippingAddress || {};
      const vendorEmail = s.vendor?.email || s.vendor?.user?.email || null;

      return {
        shipmentId: s.id,
        shortShipmentId: String(s.id).slice(-6).toUpperCase(),

        orderId: s.orderId,
        orderNumber: s.order?.orderNumber || null,

        vendorId: s.vendorId,
        vendorName: s.vendor?.displayName || "",
        vendorEmail,

        status: s.status,

        // ✅ NEW: returns support
        direction: s.direction,
        returnRequestId: s.returnRequestId || null,

        courierProvider: s.courierProvider || null,
        courierService: s.courierService || null,

        awb: s.awb,
        labelUrl: s.labelUrl,
        trackingUrl: s.trackingUrl,

        pickupScheduledAt: s.pickupScheduledAt,
        pickupDate: s.pickupDate,
        pickupSlotStart: s.pickupSlotStart,
        pickupSlotEnd: s.pickupSlotEnd,

        parcels: s.parcels,
        weightKg: s.weightKg,
        lengthCm: s.lengthCm,
        widthCm: s.widthCm,
        heightCm: s.heightCm,

        customerName: addr?.name || "",
        customerPhone: addr?.phone || "",
        customerEmail: addr?.email || "",
        customerCity: addr?.city || "",
        customerAddress:
          addr?.address || [addr?.street, addr?.city, addr?.county, addr?.postalCode].filter(Boolean).join(", "),
      };
    });

    return res.json({ total, items });
  } catch (err) {
    console.error("GET /api/admin/pickups FAILED:", err);
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "Internal Server Error",
    });
  }
});

/* ------------------------------------------
   GET /api/admin/pickups/:shipmentId
------------------------------------------- */
router.get("/pickups/:shipmentId", requireAdmin, async (req, res) => {
  try {
    const shipmentId = String(req.params.shipmentId);

    const s = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        orderId: true,
        vendorId: true,
        status: true,

        direction: true,
        returnRequestId: true,

        courierProvider: true,
        courierService: true,

        awb: true,
        labelUrl: true,
        trackingUrl: true,

        pickupDate: true,
        pickupSlotStart: true,
        pickupSlotEnd: true,
        pickupScheduledAt: true,

        consents: true,
        parcels: true,
        weightKg: true,
        lengthCm: true,
        widthCm: true,
        heightCm: true,

        deliveredAt: true,
        refusedAt: true,
        returnedAt: true,

        createdAt: true,
        updatedAt: true,

        vendor: {
          select: {
            id: true,
            displayName: true,
            email: true,
            phone: true,
            address: true,
            user: { select: { email: true } },
          },
        },

        order: {
          select: {
            id: true,
            orderNumber: true,
            createdAt: true,
            total: true,
            paymentMethod: true,
            shippingAddress: true,
            vendorNotes: true,
            adminNotes: true,
          },
        },

        items: {
          select: {
            id: true,
            title: true,
            qty: true,
            price: true,
          },
        },

        // optional: dacă e legat de returnRequest, aducem sumar
        returnRequest: {
          select: { id: true, status: true, reasonCode: true, createdAt: true },
        },
      },
    });

    if (!s) return res.status(404).json({ error: "not_found" });
    return res.json({ shipment: s });
  } catch (err) {
    console.error("GET /api/admin/pickups/:shipmentId FAILED:", err);
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "Internal Server Error",
    });
  }
});

/* ------------------------------------------
   PATCH /api/admin/pickups/:shipmentId/courier
------------------------------------------- */
const SetCourierPayload = z.object({
  courierProvider: z.string().trim().min(2).max(64),
  courierService: z.string().trim().min(1).max(64).optional().nullable(),

  awb: z.string().trim().min(3).max(64).optional().nullable(),
  labelUrl: z.string().trim().url().optional().nullable(),
  trackingUrl: z.string().trim().url().optional().nullable(),

  pickupDate: z.string().datetime().optional().nullable(),
  pickupSlotStart: z.string().datetime().optional().nullable(),
  pickupSlotEnd: z.string().datetime().optional().nullable(),

  status: z.enum(["READY_FOR_PICKUP", "PICKUP_SCHEDULED"]).optional().nullable(),
});

router.patch("/pickups/:shipmentId/courier", requireAdmin, async (req, res) => {
  try {
    const shipmentId = String(req.params.shipmentId);
    const payload = SetCourierPayload.parse(req.body || {});

    const existing = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, pickupScheduledAt: true },
    });

    if (!existing) return res.status(404).json({ error: "not_found" });

    if (!["READY_FOR_PICKUP", "PICKUP_SCHEDULED"].includes(existing.status)) {
      return res.status(409).json({ error: "invalid_status" });
    }

    if (payload.awb) {
      const dup = await prisma.shipment.findFirst({
        where: { awb: payload.awb, NOT: { id: shipmentId } },
        select: { id: true },
      });
      if (dup) return res.status(409).json({ error: "awb_duplicate" });
    }

    if (payload.pickupSlotStart && payload.pickupSlotEnd) {
      const st = new Date(payload.pickupSlotStart);
      const en = new Date(payload.pickupSlotEnd);
      if (!(en > st)) {
        return res.status(400).json({ error: "invalid_pickup_window" });
      }
    }

    const updated = await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        courierProvider: payload.courierProvider,
        courierService: payload.courierService ?? null,

        ...(payload.awb !== undefined ? { awb: payload.awb } : {}),
        ...(payload.labelUrl !== undefined ? { labelUrl: payload.labelUrl } : {}),
        ...(payload.trackingUrl !== undefined ? { trackingUrl: payload.trackingUrl } : {}),

        ...(payload.pickupDate !== undefined
          ? { pickupDate: payload.pickupDate ? new Date(payload.pickupDate) : null }
          : {}),
        ...(payload.pickupSlotStart !== undefined
          ? { pickupSlotStart: payload.pickupSlotStart ? new Date(payload.pickupSlotStart) : null }
          : {}),
        ...(payload.pickupSlotEnd !== undefined
          ? { pickupSlotEnd: payload.pickupSlotEnd ? new Date(payload.pickupSlotEnd) : null }
          : {}),

        ...(payload.status ? { status: payload.status } : {}),
      },
      select: {
        id: true,
        vendorId: true,
        orderId: true,
        pickupScheduledAt: true,

        status: true,
        courierProvider: true,
        courierService: true,
        awb: true,
        labelUrl: true,
        trackingUrl: true,
        pickupDate: true,
        pickupSlotStart: true,
        pickupSlotEnd: true,
        updatedAt: true,
      },
    });

    if (updated.awb) {
      sseBroadcastToVendor(updated.vendorId, "awb", {
        orderId: updated.orderId,
        shipmentId: updated.id,
        awb: updated.awb,
        labelUrl: updated.labelUrl || null,
        trackingUrl: updated.trackingUrl || null,
        pickupScheduledAt: updated.pickupScheduledAt || null,
      });

      notifyVendorOnAwbAssigned(updated.orderId, updated.id).catch((e) => {
        console.error("[notifyVendorOnAwbAssigned] failed:", e?.message || e);
      });
    } else {
      sseBroadcastToVendor(updated.vendorId, "courier_updated", {
        orderId: updated.orderId,
        shipmentId: updated.id,
        courierProvider: updated.courierProvider,
        courierService: updated.courierService,
        pickupDate: updated.pickupDate,
        pickupSlotStart: updated.pickupSlotStart,
        pickupSlotEnd: updated.pickupSlotEnd,
      });
    }

    return res.json({ ok: true, shipment: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid_payload", details: err.errors });
    }
    console.error("PATCH /api/admin/pickups/:shipmentId/courier FAILED:", err);
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "Internal Server Error",
    });
  }
});

/* ------------------------------------------
   PATCH /api/admin/pickups/:shipmentId/awb
------------------------------------------- */
const SetAwbPayload = z.object({
  awb: z.string().trim().min(3).max(64),
  labelUrl: z.string().trim().url().optional().nullable(),
  trackingUrl: z.string().trim().url().optional().nullable(),
});

router.patch("/pickups/:shipmentId/awb", requireAdmin, async (req, res) => {
  try {
    const shipmentId = String(req.params.shipmentId);
    const { awb, labelUrl = null, trackingUrl = null } = SetAwbPayload.parse(req.body || {});

    const existing = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, pickupScheduledAt: true },
    });

    if (!existing) return res.status(404).json({ error: "not_found" });

    if (!["READY_FOR_PICKUP", "PICKUP_SCHEDULED"].includes(existing.status)) {
      return res.status(409).json({ error: "invalid_status" });
    }

    const dup = await prisma.shipment.findFirst({
      where: { awb, NOT: { id: shipmentId } },
      select: { id: true },
    });
    if (dup) return res.status(409).json({ error: "awb_duplicate" });

    const updated = await prisma.shipment.update({
      where: { id: shipmentId },
      data: { awb, labelUrl, trackingUrl },
      select: {
        id: true,
        vendorId: true,
        orderId: true,
        pickupScheduledAt: true,

        awb: true,
        labelUrl: true,
        trackingUrl: true,
        status: true,
        updatedAt: true,
      },
    });

    sseBroadcastToVendor(updated.vendorId, "awb", {
      orderId: updated.orderId,
      shipmentId: updated.id,
      awb: updated.awb,
      labelUrl: updated.labelUrl || null,
      trackingUrl: updated.trackingUrl || null,
      pickupScheduledAt: updated.pickupScheduledAt || null,
    });

    notifyVendorOnAwbAssigned(updated.orderId, updated.id).catch((e) => {
      console.error("[notifyVendorOnAwbAssigned] failed:", e?.message || e);
    });

    return res.json({ ok: true, shipment: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid_payload", details: err.errors });
    }
    console.error("PATCH /api/admin/pickups/:shipmentId/awb FAILED:", err);
    return res.status(500).json({
      error: "server_error",
      message: err?.message || "Internal Server Error",
    });
  }
});

/* ------------------------------------------
   PATCH /api/admin/pickups/:shipmentId/delivered
------------------------------------------- */
router.patch("/pickups/:shipmentId/delivered", requireAdmin, async (req, res) => {
  try {
    const shipmentId = String(req.params.shipmentId);

    const existing = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, vendorId: true, orderId: true },
    });
    if (!existing) return res.status(404).json({ error: "not_found" });

    if (!["AWB", "IN_TRANSIT", "PICKUP_SCHEDULED", "READY_FOR_PICKUP"].includes(existing.status)) {
      return res.status(409).json({ error: "invalid_status" });
    }

    const updated = await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        refusedAt: null,
        returnedAt: null,
      },
      select: { id: true, status: true, orderId: true, vendorId: true, deliveredAt: true },
    });

    const all = await prisma.shipment.findMany({
      where: { orderId: updated.orderId },
      select: { status: true },
    });
    const allDelivered = all.length > 0 && all.every((s) => s.status === "DELIVERED");
    if (allDelivered) {
      await prisma.order.update({
        where: { id: updated.orderId },
        data: { status: "FULFILLED" },
      });
    }

    sseBroadcastToVendor(updated.vendorId, "shipment_status", {
      orderId: updated.orderId,
      shipmentId: updated.id,
      status: updated.status,
      deliveredAt: updated.deliveredAt,
    });

    return res.json({ ok: true, shipment: updated });
  } catch (err) {
    console.error("PATCH delivered FAILED:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   PATCH /api/admin/pickups/:shipmentId/refused
------------------------------------------- */
router.patch("/pickups/:shipmentId/refused", requireAdmin, async (req, res) => {
  try {
    const shipmentId = String(req.params.shipmentId);

    const existing = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, vendorId: true, orderId: true },
    });
    if (!existing) return res.status(404).json({ error: "not_found" });

    if (!["AWB", "IN_TRANSIT", "PICKUP_SCHEDULED", "READY_FOR_PICKUP"].includes(existing.status)) {
      return res.status(409).json({ error: "invalid_status" });
    }

    const updated = await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        status: "REFUSED",
        refusedAt: new Date(),
        deliveredAt: null,
        returnedAt: null,
      },
      select: { id: true, status: true, orderId: true, vendorId: true, refusedAt: true },
    });

    sseBroadcastToVendor(updated.vendorId, "shipment_status", {
      orderId: updated.orderId,
      shipmentId: updated.id,
      status: updated.status,
      refusedAt: updated.refusedAt,
    });

    return res.json({ ok: true, shipment: updated });
  } catch (err) {
    console.error("PATCH refused FAILED:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   PATCH /api/admin/pickups/:shipmentId/returned
------------------------------------------- */
router.patch("/pickups/:shipmentId/returned", requireAdmin, async (req, res) => {
  try {
    const shipmentId = String(req.params.shipmentId);

    const existing = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, vendorId: true, orderId: true },
    });
    if (!existing) return res.status(404).json({ error: "not_found" });

    if (!["REFUSED", "IN_TRANSIT", "AWB", "PICKUP_SCHEDULED", "READY_FOR_PICKUP"].includes(existing.status)) {
      return res.status(409).json({ error: "invalid_status" });
    }

    const updated = await prisma.shipment.update({
      where: { id: shipmentId },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        deliveredAt: null,
      },
      select: { id: true, status: true, orderId: true, vendorId: true, returnedAt: true },
    });

    sseBroadcastToVendor(updated.vendorId, "shipment_status", {
      orderId: updated.orderId,
      shipmentId: updated.id,
      status: updated.status,
      returnedAt: updated.returnedAt,
    });

    return res.json({ ok: true, shipment: updated });
  } catch (err) {
    console.error("PATCH returned FAILED:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/* =========================================================
   RETURNS (ReturnRequest) — Admin endpoints
========================================================= */

/* ------------------------------------------
   GET /api/admin/returns
   query:
     - q (id / orderNumber / vendorName / reasonCode)
     - status
     - page/pageSize
------------------------------------------- */
router.get("/returns", requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || "20", 10)));

    const where = {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" } },
              { orderId: { contains: q, mode: "insensitive" } },
              { vendorId: { contains: q, mode: "insensitive" } },
              { reasonCode: { contains: q, mode: "insensitive" } },
              { reasonText: { contains: q, mode: "insensitive" } },
              {
                order: { is: { orderNumber: { contains: q, mode: "insensitive" } } },
              },
              {
                vendor: { is: { displayName: { contains: q, mode: "insensitive" } } },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.returnRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,

          orderId: true,
          vendorId: true,
          userId: true,

          reasonCode: true,
          reasonText: true,

          order: { select: { orderNumber: true, createdAt: true, total: true, shippingAddress: true } },
          vendor: { select: { id: true, displayName: true, email: true, user: { select: { email: true } } } },
          user: { select: { id: true, email: true, name: true } },

          originalShipmentId: true,
          returnShipments: { select: { id: true, direction: true, status: true, awb: true, pickupScheduledAt: true } },
        },
      }),
      prisma.returnRequest.count({ where }),
    ]);

    const items = rows.map((r) => {
      const addr = r.order?.shippingAddress || {};
      const vendorEmail = r.vendor?.email || r.vendor?.user?.email || null;
      const customerEmail = r.user?.email || addr?.email || "";

      return {
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,

        orderId: r.orderId,
        orderNumber: r.order?.orderNumber || null,

        vendorId: r.vendorId,
        vendorName: r.vendor?.displayName || "",
        vendorEmail,

        customerEmail,
        customerName: addr?.name || r.user?.name || "",

        reasonCode: r.reasonCode,
        reasonText: r.reasonText || null,

        originalShipmentId: r.originalShipmentId,
        returnShipments: r.returnShipments || [],
        hasReturnShipment: (r.returnShipments || []).some((s) => s.direction === "RETURN"),
      };
    });

    return res.json({ total, items });
  } catch (err) {
    console.error("GET /api/admin/returns FAILED:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   GET /api/admin/returns/:id
------------------------------------------- */
router.get("/returns/:id", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);

    const rr = await prisma.returnRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,

        reasonCode: true,
        reasonText: true,
        faultParty: true,
        resolutionWanted: true,
        notesUser: true,
        photos: true,

        orderId: true,
        vendorId: true,
        userId: true,

        order: { select: { id: true, orderNumber: true, total: true, paymentMethod: true, shippingAddress: true } },
        vendor: { select: { id: true, displayName: true, email: true, address: true, city: true } },
        user: { select: { id: true, email: true, name: true } },

        originalShipmentId: true,
        originalShipment: {
          select: {
            id: true,
            status: true,
            awb: true,
            deliveredAt: true,
            items: { select: { id: true, title: true, qty: true, price: true, productId: true } },
          },
        },

        items: { select: { id: true, productId: true, title: true, qty: true, price: true, shipmentItemId: true } },

        returnShipments: {
          select: {
            id: true,
            direction: true,
            status: true,
            awb: true,
            labelUrl: true,
            trackingUrl: true,
            pickupScheduledAt: true,
            pickupDate: true,
            pickupSlotStart: true,
            pickupSlotEnd: true,
          },
        },
      },
    });

    if (!rr) return res.status(404).json({ error: "not_found" });
    return res.json({ returnRequest: rr });
  } catch (err) {
    console.error("GET /api/admin/returns/:id FAILED:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   PATCH /api/admin/returns/:id/status
------------------------------------------- */
const SetReturnStatusPayload = z.object({
  status: z.enum(["NEW", "IN_REVIEW", "APPROVED", "REJECTED", "PICKUP_REQUESTED", "CLOSED"]),
});

router.patch("/returns/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const { status } = SetReturnStatusPayload.parse(req.body || {});

    const rr = await prisma.returnRequest.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!rr) return res.status(404).json({ error: "not_found" });

    const updated = await prisma.returnRequest.update({
      where: { id },
      data: { status },
      select: { id: true, status: true, updatedAt: true },
    });

    return res.json({ ok: true, returnRequest: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid_payload", details: err.errors });
    }
    console.error("PATCH /api/admin/returns/:id/status FAILED:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   POST /api/admin/returns/:id/create-shipment
   Creează shipment RETURN + îl pune în pickup flow.
   - Dacă există deja shipment RETURN, return 409.
------------------------------------------- */
const CreateReturnShipmentPayload = z.object({
  // opțional: admin poate seta direct statusul inițial
  status: z.enum(["READY_FOR_PICKUP", "PICKUP_SCHEDULED"]).optional().nullable(),
  pickupScheduledAt: z.string().datetime().optional().nullable(),
});

router.post("/returns/:id/create-shipment", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const payload = CreateReturnShipmentPayload.parse(req.body || {});

    const rr = await prisma.returnRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        orderId: true,
        vendorId: true,
        originalShipmentId: true,
        items: { select: { title: true, qty: true, price: true, productId: true } },
        returnShipments: { select: { id: true, direction: true } },
      },
    });
    if (!rr) return res.status(404).json({ error: "not_found" });

    const already = (rr.returnShipments || []).some((s) => s.direction === "RETURN");
    if (already) return res.status(409).json({ error: "return_shipment_exists" });

    // create shipment + items din ReturnRequestItem
    const created = await prisma.shipment.create({
      data: {
        orderId: rr.orderId,
        vendorId: rr.vendorId,

        method: "COURIER",
        status: payload.status || "READY_FOR_PICKUP",

        direction: "RETURN",
        returnRequestId: rr.id,

        pickupScheduledAt: payload.pickupScheduledAt ? new Date(payload.pickupScheduledAt) : new Date(),

        items: {
          create: rr.items.map((it) => ({
            productId: it.productId || null,
            title: it.title,
            qty: it.qty,
            price: it.price,
          })),
        },
      },
      select: {
        id: true,
        orderId: true,
        vendorId: true,
        status: true,
        direction: true,
        returnRequestId: true,
        pickupScheduledAt: true,
        items: { select: { id: true, title: true, qty: true, price: true } },
      },
    });

    // (opțional) update status ReturnRequest -> PICKUP_REQUESTED
    const rrUpdated = await prisma.returnRequest.update({
      where: { id: rr.id },
      data: { status: "PICKUP_REQUESTED" },
      select: { id: true, status: true, updatedAt: true },
    });

    return res.json({ ok: true, shipment: created, returnRequest: rrUpdated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "invalid_payload", details: err.errors });
    }
    console.error("POST /api/admin/returns/:id/create-shipment FAILED:", err);
    return res.status(500).json({ error: "server_error", message: err?.message || "Internal Server Error" });
  }
});

export default router;
