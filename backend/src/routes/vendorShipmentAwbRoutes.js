// backend/src/routes/vendorShipmentAwbRoutes.js

import { Router } from "express";
import { authRequired, optionalAuth } from "../api/auth.js";
import { prisma } from "../db.js";
import { requireVendorAccount, courierApiLimiter, handleCourier } from "../couriers/http.js";
import {
  previewAwb,
  createAwbForShipment,
  getAwbStatus,
  getAwbLabel,
} from "../couriers/awb/awbService.js";

/*
 * AWB pentru expedierile vendorului (montat pe /api/vendor, ÎNAINTEA
 * vendorOrdersRoutes):
 *   POST /shipments/:id/awb/preview  - previzualizare + blockere (nu creează nimic)
 *   POST /shipments/:id/awb          - creare (header Idempotency-Key obligatoriu)
 *   GET  /shipments/:id/awb          - statusul AWB curent
 *   GET  /shipments/:id/label        - PDF-ul etichetei (AWB generat de Artfest);
 *                                      altfel lasă cererea să continue spre
 *                                      handlerul existent (labelUrl manual, admin).
 *
 * codAmount NU se acceptă din request - se calculează pe server.
 */

const router = Router();
const limiter = courierApiLimiter({ max: 40 });
const handle = (fn) => handleCourier(fn, "vendorShipmentAwbRoutes");

// doar câmpurile permise vendorului (fără codAmount / adrese / sume)
function pickAwbInput(body = {}) {
  const allowed = ["courierAccountId", "serviceId", "parcels", "weightKg", "lengthCm", "widthCm", "heightCm"];
  const out = {};
  for (const key of allowed) if (body[key] !== undefined) out[key] = body[key];
  return out;
}

router.post(
  "/shipments/:id/awb/preview",
  authRequired,
  requireVendorAccount,
  limiter,
  handle(async (req, res) => {
    const preview = await previewAwb({
      vendorId: req.vendorId,
      shipmentId: req.params.id,
      input: pickAwbInput(req.body),
    });
    res.json({ preview });
  })
);

router.post(
  "/shipments/:id/awb",
  authRequired,
  requireVendorAccount,
  limiter,
  handle(async (req, res) => {
    const result = await createAwbForShipment({
      vendorId: req.vendorId,
      userId: req.user?.sub || null,
      shipmentId: req.params.id,
      input: pickAwbInput(req.body),
      idempotencyKey: req.get("Idempotency-Key"),
    });
    res.status(result.replayed ? 200 : 201).json(result);
  })
);

router.get(
  "/shipments/:id/awb",
  authRequired,
  requireVendorAccount,
  handle(async (req, res) => {
    res.json(await getAwbStatus({ vendorId: req.vendorId, shipmentId: req.params.id }));
  })
);

/*
 * Etichetă. Autentificare opțională aici: dacă nu identificăm vendorul
 * (ex. alt cookie folosit de vendorOrdersRoutes) sau nu există AWB generat
 * de Artfest, cererea continuă spre handlerul existent (next()).
 */
router.get("/shipments/:id/label", optionalAuth, async (req, res, next) => {
  try {
    const vendor = req.user?.sub
      ? await prisma.vendor.findUnique({ where: { userId: req.user.sub }, select: { id: true } })
      : null;
    if (!vendor) return next();

    req.vendorId = vendor.id;
    return handle(async (rq, rs) => {
      const label = await getAwbLabel({
        vendorId: rq.vendorId,
        shipmentId: rq.params.id,
        format: String(rq.query.format || "A6").toUpperCase(),
      });
      if (!label) return next(); // fără AWB Artfest -> handlerul existent

      rs.setHeader("Content-Type", "application/pdf");
      rs.setHeader("Content-Disposition", `inline; filename="AWB-${label.awbNumber}.pdf"`);
      rs.setHeader("Cache-Control", "private, no-store");
      rs.send(label.buffer);
    })(req, res);
  } catch (e) {
    return next(e);
  }
});

export default router;
