import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";
import { z } from "zod";

import { ensureShipmentSaleLedgers } from "../services/shipmentSaleLedger.js";
import {
  sseBroadcastToVendor,
  ensureRefundLedgerEntry,
  ensureInfluencerRefundLedgerEntry,
  ensureVendorReferralRefundLedgerEntry,
} from "./vendorOrdersRoutes.js";
import { notifyVendorOnAwbAssigned } from "../services/notifications.js";
import { buildAdminPickupsWhere } from "./adminPickupsFilters.js";
import {
  adminCancelAwb,
  adminRecoverReturnAwb,
  createReturnAwbForAdmin,
  previewReturnAwbForAdmin,
  getAwbLabelForAdmin,
  assertNoActiveCourierAwb,
  resolveAwbCancel,
  resolveUnknownAwb,
  toAdminAwb,
} from "../couriers/awb/awbService.js";
import { isCourierError } from "../couriers/errors.js";
import { requireCourierAwbLive, requireCourierIntegration, sendAwbLabelPdf } from "../couriers/http.js";
import { isCourierAwbLiveEnabled } from "../couriers/awbLive.js";
import {
  ReturnFlowError as ReturnShipmentFlowError,
  completeReturnShipment,
  createReturnShipment,
  sendReturnFlowError,
  setReturnCostBearer,
} from "../services/returnShipmentService.js";

// erorile serviciului AWB -> răspuns sanitizat (cod + mesaj fix)
function sendCourierError(res, e) {
  return res.status(e.httpStatus || 500).json({
    error: e.code,
    message: e.message,
    ...(e.fields?.length ? { fields: e.fields } : {}),
    ...(e.activeAwb ? { activeAwb: e.activeAwb } : {}),
  });
}
import { RETURN_REASONS, returnReasonLabel } from "../services/returnRequestRules.js";
import {
  notifyAdminReturnStatusChange,
  returnRequestDeliveryUnconfirmed,
  returnRequestHasActiveAwb,
} from "../services/returnRequestService.js";
import { publicNotices, resendReturnNotice } from "../services/returnNotices.js";
import { awbCancelStateOf } from "../couriers/awb/activeAwbGuard.js";

// Clientul e anunțat cu aceleași texte / mecanisme ca la acțiunile
// vânzătorului (best-effort: statusul e deja salvat).
async function notifyClientOfAdminReturnChange(args) {
  try {
    await notifyAdminReturnStatusChange({ db: prisma, ...args });
  } catch (error) {
    console.error("[admin returns] client notification failed:", error?.message || error);
  }
}

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

    // implicit: ridicări programate (neschimbat); source=courier: expedierile cu
    // AWB generat prin integrare (OUTBOUND + RETURN) - vezi adminPickupsFilters.js
    const { where, orderBy } = buildAdminPickupsWhere(req.query, qWhere);

    const [rows, total] = await Promise.all([
      prisma.shipment.findMany({
        where,
        orderBy,
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

    // ultimul AWB generat prin integrarea de curier, per expediere (o singură interogare)
    const courierAwbRows = rows?.length
      ? await prisma.courierAwb.findMany({
          where: { shipmentId: { in: rows.map((s) => s.id) } },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const latestAwbByShipment = new Map();
    for (const r of courierAwbRows) {
      if (!latestAwbByShipment.has(r.shipmentId)) latestAwbByShipment.set(r.shipmentId, r);
    }

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
        courierAwb: toAdminAwb(latestAwbByShipment.get(s.id) || null, s),

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

    const courierAwbs = await prisma.courierAwb.findMany({
      where: { shipmentId: s.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return res.json({ shipment: s, courierAwbs: courierAwbs.map((r) => toAdminAwb(r, s)) });
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

// coletul RETURN pe rutele de ridicare obișnuite: refuzat (AWB Sameday de retur, cost,
// anulare și închidere au rutele lor: /returns/*, /pickups/:id/return-awb*)
const RETURN_SHIPMENT_ADMIN_FLOW = Object.freeze({
  error: "return_shipment_admin_flow",
  message: "Coletul de retur se gestionează din secțiunea Retururi (Transport retur), nu din acțiunile de ridicare obișnuite.",
});

router.patch("/pickups/:shipmentId/courier", requireAdmin, async (req, res) => {
  try {
    const shipmentId = String(req.params.shipmentId);
    const payload = SetCourierPayload.parse(req.body || {});

    const existing = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        status: true,
        pickupScheduledAt: true,
        courierProvider: true,
        courierService: true,
        awb: true,
        labelUrl: true,
        trackingUrl: true,
        direction: true,
      },
    });

    if (!existing) return res.status(404).json({ error: "not_found" });
    // coletul RETURN are fluxul lui (AWB Sameday de retur, Transport retur)
    if (existing.direction === "RETURN") return res.status(409).json(RETURN_SHIPMENT_ADMIN_FLOW);

    if (!["READY_FOR_PICKUP", "PICKUP_SCHEDULED"].includes(existing.status)) {
      return res.status(409).json({ error: "invalid_status" });
    }

    // datele de curier/AWB nu se schimbă manual peste un AWB activ din integrare
    // (programarea ridicării rămâne permisă)
    // doar valorile care chiar se SCHIMBĂ (formularul admin le retrimite pe toate)
    const changes = (key) => payload[key] !== undefined && (payload[key] ?? null) !== (existing[key] ?? null);
    const touchesAwbData =
      changes("awb") ||
      changes("labelUrl") ||
      changes("trackingUrl") ||
      changes("courierProvider") ||
      (payload.courierService ?? null) !== (existing.courierService ?? null);
    if (touchesAwbData) {
      try {
        await assertNoActiveCourierAwb(prisma, shipmentId);
      } catch (e) {
        if (isCourierError(e)) return sendCourierError(res, e);
        throw e;
      }
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

    try {
      await assertNoActiveCourierAwb(prisma, shipmentId);
    } catch (e) {
      if (isCourierError(e)) return sendCourierError(res, e);
      throw e;
    }

    const existing = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, pickupScheduledAt: true, direction: true },
    });

    if (!existing) return res.status(404).json({ error: "not_found" });
    // AWB-ul de retur se generează doar prin /return-awb (contractul Artfest), nu manual
    if (existing.direction === "RETURN") return res.status(409).json(RETURN_SHIPMENT_ADMIN_FLOW);

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
   POST /api/admin/pickups/:shipmentId/courier-awb/:awbId/resolve
   Body: { outcome: "FAILED" | "CREATED", awbNumber?, note? }
   Doar pentru AWB-uri UNKNOWN (generare neconfirmată de curier), după
   verificarea manuală în contul curierului. Auditat (admin + notă).
------------------------------------------- */
router.post("/pickups/:shipmentId/courier-awb/:awbId/resolve", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await resolveUnknownAwb(
      {
        shipmentId: String(req.params.shipmentId),
        awbId: String(req.params.awbId),
        outcome: String(body.outcome || ""),
        awbNumber: body.awbNumber,
        note: body.note,
        adminUserId: req.user?.id || null,
      },
      prisma
    );
    return res.json({ ok: true, ...result });
  } catch (e) {
    if (isCourierError(e)) return sendCourierError(res, e);
    console.error("POST /api/admin/pickups/:shipmentId/courier-awb/:awbId/resolve FAILED:", e?.name || "Error", e?.code || "");
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   POST /api/admin/pickups/:shipmentId/courier-awb/:awbId/cancel
   Body: { note? }
   Anulare AWB din Admin - o singură încercare (fără retry automat). Pe o
   anulare neconfirmată (UNKNOWN) = „Reîncearcă anularea”: doar 204 confirmă;
   404 / 405 / timeout lasă starea neconfirmată. Comutatorul general
   COURIER_INTEGRATION_ENABLED se aplică (apel la curier).
------------------------------------------- */
router.post("/pickups/:shipmentId/courier-awb/:awbId/cancel", requireAdmin, requireCourierIntegration, async (req, res) => {
  try {
    const result = await adminCancelAwb(
      {
        shipmentId: String(req.params.shipmentId),
        awbId: String(req.params.awbId),
        note: req.body?.note,
        adminUserId: req.user?.id || null,
      },
      prisma
    );
    return res.json({ ok: true, ...result });
  } catch (e) {
    if (isCourierError(e)) return sendCourierError(res, e);
    console.error("POST /api/admin/pickups/:shipmentId/courier-awb/:awbId/cancel FAILED:", e?.name || "Error", e?.code || "");
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   GET /api/admin/pickups/:shipmentId/awb-label
   Eticheta PDF a AWB-ului generat de Artfest (outbound sau retur) - ADMIN.
   Doar citire la curier; comutatorul general COURIER_INTEGRATION_ENABLED.
------------------------------------------- */
router.get("/pickups/:shipmentId/awb-label", requireAdmin, requireCourierIntegration, async (req, res) => {
  try {
    const label = await getAwbLabelForAdmin(
      {
        shipmentId: String(req.params.shipmentId),
        format: String(req.query.format || "A6").toUpperCase() === "A4" ? "A4" : "A6",
      },
      prisma
    );
    if (!label) return res.status(404).json({ error: "awb_missing", message: "Expedierea nu are un AWB generat de Artfest." });
    return sendAwbLabelPdf(res, label);
  } catch (e) {
    if (isCourierError(e)) return sendCourierError(res, e);
    console.error("GET /api/admin/pickups/:shipmentId/awb-label FAILED:", e?.name || "Error", e?.code || "");
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   POST /api/admin/pickups/:shipmentId/courier-awb/:awbId/resolve-cancel
   Body: { outcome: "CANCELLED" | "ACTIVE", note? }
   Doar pentru o anulare neconfirmată (cancelState UNKNOWN), după verificarea
   AWB-ului în contul curierului. Fără apel la curier. Auditat.
------------------------------------------- */
router.post("/pickups/:shipmentId/courier-awb/:awbId/resolve-cancel", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await resolveAwbCancel(
      {
        shipmentId: String(req.params.shipmentId),
        awbId: String(req.params.awbId),
        outcome: String(body.outcome || ""),
        note: body.note,
        adminUserId: req.user?.id || null,
      },
      prisma
    );
    return res.json({ ok: true, ...result });
  } catch (e) {
    if (isCourierError(e)) return sendCourierError(res, e);
    console.error("POST /api/admin/pickups/:shipmentId/courier-awb/:awbId/resolve-cancel FAILED:", e?.name || "Error", e?.code || "");
    return res.status(500).json({ error: "server_error" });
  }
});

// stările din care Admin poate marca „Livrat” / „Refuzat” (aceleași ca înainte)
const ADMIN_DELIVERABLE_STATUSES = ["AWB", "IN_TRANSIT", "PICKUP_SCHEDULED", "READY_FOR_PICKUP"];
// stările din care Admin poate marca „Returnat la expeditor” (aceleași ca înainte; include REFUSED)
const ADMIN_RETURNABLE_STATUSES = ["REFUSED", ...ADMIN_DELIVERABLE_STATUSES];

/* ------------------------------------------
   PATCH /api/admin/pickups/:shipmentId/delivered
------------------------------------------- */
router.patch("/pickups/:shipmentId/delivered", requireAdmin, async (req, res) => {
  try {
    const shipmentId = String(req.params.shipmentId);

    const existing = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, vendorId: true, orderId: true, direction: true },
    });
    if (!existing) return res.status(404).json({ error: "not_found" });

    if (!ADMIN_DELIVERABLE_STATUSES.includes(existing.status)) {
      return res.status(409).json({ error: "invalid_status" });
    }

    // Colet RETURN (client -> vendor) livrat: NU e vânzare - fără SALE,
    // fără comision, fără finalizarea comenzii (vezi isReturnShipment).
    const isReturn = existing.direction === "RETURN";

    /*
     * ATOMIC, condiționat de starea curentă: o expediere trecută între timp
     * în REFUSED / RETURNED (ex. „Refuzat” simultan) sau deja livrată NU e
     * suprascrisă; doar o tranziție confirmată ajunge la FULFILLED / ledger.
     */
    const transition = await prisma.shipment.updateMany({
      where: { id: shipmentId, status: { in: ADMIN_DELIVERABLE_STATUSES } },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
        refusedAt: null,
        returnedAt: null,
      },
    });
    if (transition.count !== 1) {
      return res.status(409).json({ error: "invalid_status" });
    }

    const updated = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, status: true, orderId: true, vendorId: true, deliveredAt: true },
    });

    // FULFILLED se decide doar pe coletele de vânzare (OUTBOUND)
    const all = await prisma.shipment.findMany({
      where: { orderId: updated.orderId, direction: "OUTBOUND" },
      select: { status: true },
    });
    const allDelivered = all.length > 0 && all.every((s) => s.status === "DELIVERED");
    if (!isReturn && allDelivered) {
      await prisma.order.update({
        where: { id: updated.orderId },
        data: { status: "FULFILLED" },
      });
    }

    /*
     * LEDGER (audit 2026-09-14, Bug 1 CRITICAL) - identic ca declanșator
     * și ordine cu PATCH /api/vendor/orders/:id/status (vendorOrdersRoutes.js):
     * status -> DELIVERED trebuie să creeze exact aceleași 3 intrări de
     * ledger, indiferent dacă livrarea e confirmată de vendor sau de
     * admin din pagina Pickups. Reutilizăm STRICT helper-ele canonice -
     * niciun calcul nou. Toate 3 sunt idempotente (upsert pe shipmentId,
     * update: {}) - un al doilea apel pe același shipment nu creează
     * nimic în plus. Non-blocant: dacă ledger-ul eșuează, statusul deja
     * scris rămâne (nu-l rulăm într-o tranzacție comună cu ledger-ul -
     * helper-ele nu acceptă `db`/tx, la fel ca în vendorOrdersRoutes.js),
     * dar eroarea e logată clar pentru reconciliere manuală.
     * Coletul RETURN sare complet peste ledger (helper-ele au și ele gardă).
     * Din 2026-11-03: prin logica comună services/shipmentSaleLedger.js
     * (aceleași 3 helper-e; CARD online -> SALE doar din webhook).
     */
    if (!isReturn) try {
      const ledger = await ensureShipmentSaleLedgers({ shipmentId: updated.id });
      if (!ledger.ok) {
        console.error("[admin/pickups delivered] ledger SALE incomplet (de reconciliat):", updated.id, ledger.reason);
      }
    } catch (ledgerError) {
      console.error(
        "[admin/pickups delivered] ledger creation failed:",
        updated.id,
        ledgerError
      );
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

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { id: true, status: true, vendorId: true, orderId: true, direction: true },
      });
      if (!existing) {
        throw Object.assign(new Error("not_found"), { code: "NOT_FOUND" });
      }
      // coletul RETURN: refuzul de livrare nu se aplică (flux separat de retur)
      if (existing.direction === "RETURN") {
        throw Object.assign(new Error("return_shipment_admin_flow"), { code: "RETURN_ADMIN_FLOW" });
      }

      if (!ADMIN_DELIVERABLE_STATUSES.includes(existing.status)) {
        throw Object.assign(new Error("invalid_status"), { code: "INVALID_STATUS" });
      }

      /*
       * ATOMIC, condiționat de starea curentă: o expediere livrată între
       * timp („Livrat” simultan) NU devine REFUSED și nu primește REFUND;
       * tranzacția se oprește înaintea intrărilor de ledger.
       */
      const transition = await tx.shipment.updateMany({
        where: { id: shipmentId, status: { in: ADMIN_DELIVERABLE_STATUSES } },
        data: {
          status: "REFUSED",
          refusedAt: new Date(),
          deliveredAt: null,
          returnedAt: null,
        },
      });
      if (transition.count !== 1) {
        throw Object.assign(new Error("invalid_status"), { code: "INVALID_STATUS" });
      }

      const updatedShipment = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { id: true, status: true, orderId: true, vendorId: true, refusedAt: true },
      });

      await ensureRefundLedgerEntry({
        vendorId: updatedShipment.vendorId,
        shipmentId: updatedShipment.id,
        db: tx,
      });
      await ensureInfluencerRefundLedgerEntry({
        shipmentId: updatedShipment.id,
        db: tx,
      });

      /*
       * Bug 2 CRITICAL (audit 2026-09-14) - lipsea complet aici; fără
       * acest apel, un referral cross-vendor rămânea încasat de
       * promoter chiar și după ce vânzarea era anulată din pagina
       * admin de Pickups. Fail-open intern (no-op dacă shipmentul nu
       * are referrerVendorId) - la fel ca celelalte două de mai sus.
       */
      await ensureVendorReferralRefundLedgerEntry({
        shipmentId: updatedShipment.id,
        db: tx,
      });

      return updatedShipment;
    });

    sseBroadcastToVendor(updated.vendorId, "shipment_status", {
      orderId: updated.orderId,
      shipmentId: updated.id,
      status: updated.status,
      refusedAt: updated.refusedAt,
    });

    return res.json({ ok: true, shipment: updated });
  } catch (err) {
    if (err?.code === "NOT_FOUND") return res.status(404).json({ error: "not_found" });
    if (err?.code === "RETURN_ADMIN_FLOW") return res.status(409).json(RETURN_SHIPMENT_ADMIN_FLOW);
    if (err?.code === "INVALID_STATUS") return res.status(409).json({ error: "invalid_status" });
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

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { id: true, status: true, vendorId: true, orderId: true, direction: true },
      });
      if (!existing) {
        throw Object.assign(new Error("not_found"), { code: "NOT_FOUND" });
      }
      // coletul RETURN: „returnat la expeditor” nu se aplică (flux separat de retur)
      if (existing.direction === "RETURN") {
        throw Object.assign(new Error("return_shipment_admin_flow"), { code: "RETURN_ADMIN_FLOW" });
      }

      if (!ADMIN_RETURNABLE_STATUSES.includes(existing.status)) {
        throw Object.assign(new Error("invalid_status"), { code: "INVALID_STATUS" });
      }

      /*
       * ATOMIC, condiționat de starea curentă: o expediere livrată între
       * timp („Livrat” simultan) sau deja returnată NU e suprascrisă și nu
       * primește REFUND; tranzacția se oprește înaintea intrărilor de ledger.
       * (DELIVERED -> RETURNED rămâne doar pe rutele comerciale dedicate:
       * refund CARD, corecția de comision COD.)
       */
      const transition = await tx.shipment.updateMany({
        where: { id: shipmentId, direction: "OUTBOUND", status: { in: ADMIN_RETURNABLE_STATUSES } },
        data: {
          status: "RETURNED",
          returnedAt: new Date(),
          deliveredAt: null,
        },
      });
      if (transition.count !== 1) {
        throw Object.assign(new Error("invalid_status"), { code: "INVALID_STATUS" });
      }

      const updatedShipment = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: { id: true, status: true, orderId: true, vendorId: true, returnedAt: true },
      });

      await ensureRefundLedgerEntry({
        vendorId: updatedShipment.vendorId,
        shipmentId: updatedShipment.id,
        db: tx,
      });
      await ensureInfluencerRefundLedgerEntry({
        shipmentId: updatedShipment.id,
        db: tx,
      });

      /*
       * Bug 2 CRITICAL (audit 2026-09-14) - lipsea complet aici; fără
       * acest apel, un referral cross-vendor rămânea încasat de
       * promoter chiar și după ce vânzarea era anulată din pagina
       * admin de Pickups. Fail-open intern (no-op dacă shipmentul nu
       * are referrerVendorId) - la fel ca celelalte două de mai sus.
       */
      await ensureVendorReferralRefundLedgerEntry({
        shipmentId: updatedShipment.id,
        db: tx,
      });

      return updatedShipment;
    });

    sseBroadcastToVendor(updated.vendorId, "shipment_status", {
      orderId: updated.orderId,
      shipmentId: updated.id,
      status: updated.status,
      returnedAt: updated.returnedAt,
    });

    return res.json({ ok: true, shipment: updated });
  } catch (err) {
    if (err?.code === "NOT_FOUND") return res.status(404).json({ error: "not_found" });
    if (err?.code === "RETURN_ADMIN_FLOW") return res.status(409).json(RETURN_SHIPMENT_ADMIN_FLOW);
    if (err?.code === "INVALID_STATUS") return res.status(409).json({ error: "invalid_status" });
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

    // cele mai vechi cereri NEW primele (vânzător care nu răspunde)
    const orderBy = status === "NEW" ? { createdAt: "asc" } : { createdAt: "desc" };

    const [rows, total, statusGroups] = await Promise.all([
      prisma.returnRequest.findMany({
        where,
        orderBy,
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
          returnMethod: true,
          costBearer: true,

          order: { select: { orderNumber: true, createdAt: true, total: true, shippingAddress: true } },
          vendor: { select: { id: true, displayName: true, email: true, user: { select: { email: true } } } },
          user: { select: { id: true, email: true, name: true } },

          photos: true,
          notesUser: true,
          items: { select: { id: true, title: true, qty: true } },

          originalShipmentId: true,
          returnShipments: { select: { id: true, direction: true, status: true, awb: true, pickupScheduledAt: true } },
        },
      }),
      prisma.returnRequest.count({ where }),
      // numărătoare pe status (toate cererile, fără filtre) pentru tab-ul Admin
      prisma.returnRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    const counts = { ALL: 0 };

    for (const group of statusGroups) {
      counts[group.status] = group._count._all;
      counts.ALL += group._count._all;
    }

    // ultimul mesaj legat de retur (etichetat return:<id>:... în threadul comenzii)
    const ids = rows.map((r) => r.id);
    const returnMessages = ids.length
      ? await prisma.message.findMany({
          where: { OR: ids.map((rid) => ({ clientMessageId: { startsWith: `return:${rid}:` } })) },
          orderBy: { createdAt: "desc" },
          select: { body: true, createdAt: true, authorType: true, threadId: true, clientMessageId: true },
        })
      : [];

    const lastMessageById = new Map();

    for (const m of returnMessages) {
      const rid = String(m.clientMessageId).split(":")[1];
      if (!lastMessageById.has(rid)) lastMessageById.set(rid, m);
    }

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
        reasonLabel: returnReasonLabel(r.reasonCode),
        reasonKind: RETURN_REASONS[r.reasonCode]?.kind || null,
        reasonText: r.reasonText || null,
        notesUser: r.notesUser || null,
        photos: r.photos || [],
        items: r.items || [],

        guest: !r.userId,
        updatedAt: r.updatedAt,
        returnMethod: r.returnMethod || null,
        costBearer: r.costBearer || null,
        lastMessage: (() => {
          const m = lastMessageById.get(r.id);
          return m
            ? { body: m.body, createdAt: m.createdAt, from: m.authorType === "VENDOR" ? "VENDOR" : "CLIENT", threadId: m.threadId }
            : null;
        })(),

        originalShipmentId: r.originalShipmentId,
        returnShipments: r.returnShipments || [],
        hasReturnShipment: (r.returnShipments || []).some((s) => s.direction === "RETURN"),
      };
    });

    return res.json({ total, counts, items });
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

        // retur Sameday: metoda + adresa confirmată de client + cine suportă transportul
        returnMethod: true,
        pickupAddress: true,
        costBearer: true,
        costDecidedAt: true,
        costDecidedById: true,

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
            parcels: true,
            weightKg: true,
            delivery: {
              select: { recipientName: true, recipientPhone: true, cityName: true, countyName: true, address: true, serviceId: true },
            },
            courierAwbs: {
              orderBy: { createdAt: "desc" },
              take: 5,
              select: { id: true, status: true, awbNumber: true, errorMessage: true, createdAt: true, updatedAt: true, providerMeta: true },
            },
          },
        },
      },
    });

    if (!rr) return res.status(404).json({ error: "not_found" });
    // starea anulării AWB-ului (fără providerMeta brut în răspuns)
    const returnShipments = (rr.returnShipments || []).map((s) => ({
      ...s,
      weightKg: s.weightKg != null ? Number(s.weightKg) : null,
      hasDelivery: !!s.delivery,
      courierAwbs: (s.courierAwbs || []).map(({ providerMeta, ...a }) => ({
        ...a,
        cancelState: a.status === "CREATED" ? awbCancelStateOf({ ...a, providerMeta }) || null : null,
        // notificările persistente ale acestui AWB (stare, încercări, retrimitere posibilă)
        notices: publicNotices(providerMeta),
      })),
    }));
    return res.json({ returnRequest: { ...rr, returnShipments } });
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
  // opțional: mesaj pentru client (motiv / informații cerute / instrucțiuni)
  message: z.string().trim().max(2000).optional().nullable(),
  // excepție EXPLICITĂ: închidere cu AWB de retur activ, fără livrare confirmată de curier
  override: z.boolean().optional(),
  overrideReason: z.string().trim().max(500).optional().nullable(),
});

router.patch("/returns/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);
    const { status, message, override, overrideReason } = SetReturnStatusPayload.parse(req.body || {});

    const rr = await prisma.returnRequest.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!rr) return res.status(404).json({ error: "not_found" });

    // cu AWB de retur activ: fără respingere / redeschidere (transportul NU se
    // anulează implicit - întâi anularea AWB-ului, explicit)
    if (["REJECTED", "NEW", "IN_REVIEW"].includes(status) && status !== rr.status && (await returnRequestHasActiveAwb(prisma, id))) {
      return res.status(409).json({
        error: "return_awb_active",
        message: "Cererea are un AWB de retur activ. Anulează întâi AWB-ul (secțiunea Transport retur), apoi schimbă statusul.",
      });
    }

    // închidere = produsul a ajuns la vânzător. Cu AWB de retur activ, fără livrare
    // confirmată de curier: doar ca excepție explicită (override + motiv), auditată
    if (status === "CLOSED" && rr.status !== "CLOSED" && (await returnRequestDeliveryUnconfirmed(prisma, id))) {
      if (!override || !String(overrideReason || "").trim()) {
        return res.status(409).json({
          error: "return_delivery_unconfirmed",
          message:
            "Curierul nu a confirmat livrarea coletului de retur. Închiderea e posibilă doar ca excepție explicită, cu motivul verificării (ex. confirmarea scrisă a vânzătorului).",
        });
      }
      const audited = await auditReturnCloseOverride(prisma, id, { adminUserId: req.user?.id || null, reason: String(overrideReason).trim() });
      if (!audited) {
        return res.status(409).json({
          error: "return_awb_cancel_pending",
          message: "AWB-ul de retur are o anulare în curs sau neconfirmată. Rezolv-o întâi, apoi închide cererea.",
        });
      }
    }

    // PICKUP_REQUESTED = curierul are AWB confirmat; se setează automat după AWB,
    // nu manual (altfel clientul ar aștepta un curier care nu vine)
    if (status === "PICKUP_REQUESTED" && rr.status !== "PICKUP_REQUESTED") {
      const confirmed = await prisma.courierAwb.count({
        where: { status: "CREATED", shipment: { returnRequestId: id, direction: "RETURN" } },
      });
      if (!confirmed) {
        return res.status(409).json({
          error: "pickup_requested_requires_awb",
          message: "Statusul „ridicare prin curier” se setează automat după confirmarea AWB-ului de retur.",
        });
      }
    }

    const updated = await prisma.returnRequest.update({
      where: { id },
      data: { status },
      select: { id: true, status: true, updatedAt: true },
    });

    await notifyClientOfAdminReturnChange({
      returnRequestId: id,
      previousStatus: rr.status,
      status,
      message,
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
   PATCH /api/admin/returns/:id/cost-bearer
   Body: { costBearer: VENDOR | CUSTOMER | ARTFEST | SPLIT }
   Decizie EXPLICITĂ (faultParty nu decide nimic); fără sume / rețineri.
   Blocată cât există un AWB de retur activ.
------------------------------------------- */
router.patch("/returns/:id/cost-bearer", requireAdmin, async (req, res) => {
  try {
    const result = await setReturnCostBearer({
      db: prisma,
      returnRequestId: String(req.params.id),
      costBearer: String(req.body?.costBearer || ""),
      adminUserId: req.user?.id || null,
    });
    return res.json({ ok: true, returnRequest: result });
  } catch (err) {
    if (err instanceof ReturnShipmentFlowError) return sendReturnFlowError(res, err);
    console.error("PATCH /api/admin/returns/:id/cost-bearer FAILED:", err?.code || err?.name || "Error");
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   POST /api/admin/returns/:id/create-shipment
   Body: { parcels, weightKg, lengthCm?, widthCm?, heightCm? }
   Creează Shipment RETURN + ShipmentDelivery (adresa confirmată de client),
   ATOMIC: rândul cererii blocat (FOR UPDATE), verificarea expedierii
   existente după blocare -> o singură expediere la cereri simultane.
   Doar cerere APPROVED cu HOME_PICKUP + adresă confirmată. Statusul cererii
   NU se schimbă aici (PICKUP_REQUESTED doar după AWB confirmat).
------------------------------------------- */
router.post("/returns/:id/create-shipment", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const shipment = await createReturnShipment({
      db: prisma,
      returnRequestId: String(req.params.id),
      input: {
        parcels: body.parcels,
        weightKg: body.weightKg,
        lengthCm: body.lengthCm,
        widthCm: body.widthCm,
        heightCm: body.heightCm,
      },
    });
    return res.status(201).json({ ok: true, shipment });
  } catch (err) {
    if (err instanceof ReturnShipmentFlowError) return sendReturnFlowError(res, err);
    console.error("POST /api/admin/returns/:id/create-shipment FAILED:", err?.code || err?.name || "Error");
    return res.status(500).json({ error: "server_error" });
  }
});

/*
 * Auditul excepției de închidere: intrare în providerMeta.audit a AWB-ului activ
 * (append atomic în SQL, updatedAt incrementat; niciodată pe un AWB cu anulare
 * în curs / neconfirmată). -> false dacă nu s-a putut audita.
 */
async function auditReturnCloseOverride(db, returnRequestId, { adminUserId, reason }) {
  const entry = JSON.stringify({ action: "return_closed_override", actor: "admin", userId: adminUserId, note: reason.slice(0, 500), at: new Date().toISOString() });
  const n = await db.$executeRaw`
    UPDATE "CourierAwb" a
       SET "providerMeta" = jsonb_set(COALESCE(a."providerMeta", '{}'::jsonb), '{audit}',
             COALESCE(a."providerMeta"->'audit', '[]'::jsonb) || jsonb_build_array(${entry}::jsonb), true),
           "updatedAt" = NOW()
      FROM "Shipment" s
     WHERE s."id" = a."shipmentId" AND s."returnRequestId" = ${String(returnRequestId)} AND s."direction"::text = 'RETURN'
       AND a."status"::text IN ('REQUESTED', 'CREATED', 'UNKNOWN')
       AND (a."providerMeta"->>'cancelState') IS NULL`;
  return n > 0;
}

/* ------------------------------------------
   POST /api/admin/returns/:id/complete-shipment
   Retur VECHI: completează DOAR ce lipsește (livrarea din adresa confirmată de
   client, coletele / greutatea). Nu suprascrie date existente. Fără AWB activ.
------------------------------------------- */
router.post("/returns/:id/complete-shipment", requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await completeReturnShipment({
      db: prisma,
      returnRequestId: String(req.params.id),
      input: { parcels: body.parcels, weightKg: body.weightKg, lengthCm: body.lengthCm, widthCm: body.widthCm, heightCm: body.heightCm },
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ReturnShipmentFlowError) return sendReturnFlowError(res, err);
    console.error("POST /api/admin/returns/:id/complete-shipment FAILED:", err?.code || err?.name || "Error");
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   POST /api/admin/returns/:id/notices/:awbId/:kind/resend
   Retrimitere EXPLICITĂ a unei notificări UNCERTAIN / FAILED (poate dubla un
   email deja livrat - de aceea nu e automată). Auditată în starea notificării.
------------------------------------------- */
router.post("/returns/:id/notices/:awbId/:kind/resend", requireAdmin, async (req, res) => {
  try {
    const kind = String(req.params.kind);
    if (!["confirmed", "cancelled"].includes(kind)) return res.status(400).json({ error: "notice_kind_invalid" });
    const out = await resendReturnNotice({
      db: prisma,
      returnRequestId: String(req.params.id),
      awbId: String(req.params.awbId),
      kind,
      adminUserId: req.user?.id || null,
    });
    if (!out.ok) {
      return res.status(out.code === "notice_not_found" ? 404 : 409).json({
        error: out.code,
        message: out.code === "notice_not_resendable" ? "Notificarea nu este în starea în care se poate retrimite." : "Notificarea nu a putut fi retrimisă.",
      });
    }
    return res.json({ ok: true, state: out.state });
  } catch (err) {
    console.error("POST /api/admin/returns/:id/notices resend FAILED:", err?.code || err?.name || "Error");
    return res.status(500).json({ error: "server_error" });
  }
});

/* ------------------------------------------
   AWB de RETUR (Sameday service 10) - DOAR Admin, contractul Artfest:
   POST /api/admin/pickups/:shipmentId/return-awb/preview  blockere + date (fără creare)
   POST /api/admin/pickups/:shipmentId/return-awb          creare (Idempotency-Key obligatoriu;
                                                           în plus COURIER_AWB_LIVE_ENABLED=true)
   POST /api/admin/pickups/:shipmentId/return-awb/recover  „Verifică din nou la Sameday” (UNKNOWN)
   Doar Shipment RETURN (altfel 404). Comutatorul COURIER_INTEGRATION_ENABLED.
------------------------------------------- */
router.post("/pickups/:shipmentId/return-awb/preview", requireAdmin, requireCourierIntegration, async (req, res) => {
  try {
    const preview = await previewReturnAwbForAdmin({ shipmentId: String(req.params.shipmentId) }, prisma);
    return res.json({ preview: { ...preview, awbLiveEnabled: isCourierAwbLiveEnabled() } });
  } catch (e) {
    if (isCourierError(e)) return sendCourierError(res, e);
    console.error("POST /api/admin/pickups/:shipmentId/return-awb/preview FAILED:", e?.name || "Error", e?.code || "");
    return res.status(500).json({ error: "server_error" });
  }
});

router.post("/pickups/:shipmentId/return-awb", requireAdmin, requireCourierIntegration, requireCourierAwbLive, async (req, res) => {
  try {
    const result = await createReturnAwbForAdmin(
      {
        shipmentId: String(req.params.shipmentId),
        adminUserId: req.user?.id || null,
        idempotencyKey: req.get("Idempotency-Key"),
      },
      prisma
    );
    return res.status(result.replayed ? 200 : 201).json(result);
  } catch (e) {
    if (isCourierError(e)) {
      return res.status(e.httpStatus || 500).json({
        error: e.code,
        message: e.message,
        ...(e.blockers?.length ? { blockers: e.blockers } : {}),
        ...(e.fields?.length ? { fields: e.fields } : {}),
      });
    }
    console.error("POST /api/admin/pickups/:shipmentId/return-awb FAILED:", e?.name || "Error", e?.code || "");
    return res.status(500).json({ error: "server_error" });
  }
});

router.post("/pickups/:shipmentId/return-awb/recover", requireAdmin, requireCourierIntegration, async (req, res) => {
  try {
    const result = await adminRecoverReturnAwb(
      { shipmentId: String(req.params.shipmentId), adminUserId: req.user?.id || null },
      prisma
    );
    return res.json(result);
  } catch (e) {
    if (isCourierError(e)) return sendCourierError(res, e);
    console.error("POST /api/admin/pickups/:shipmentId/return-awb/recover FAILED:", e?.name || "Error", e?.code || "");
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
