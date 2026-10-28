// backend/src/routes/vendorShipmentAwbRoutes.js

import { Router } from "express";
import { authRequired, optionalAuth } from "../api/auth.js";
import { prisma } from "../db.js";
import {
  requireVendorAccount,
  courierApiLimiter,
  handleCourier,
  requireCourierIntegration,
  isCourierIntegrationEnabled,
} from "../couriers/http.js";
import {
  previewAwb,
  createAwbForShipment,
  getAwbStatus,
  getAwbLabel,
  cancelAwbForShipment,
  recoverUnknownAwb,
} from "../couriers/awb/awbService.js";

/*
 * AWB pentru expedierile vendorului (montat pe /api/vendor, ÎNAINTEA
 * vendorOrdersRoutes):
 *   POST /shipments/:id/awb/preview  - previzualizare + blockere (nu creează nimic)
 *   POST /shipments/:id/awb          - creare (header Idempotency-Key obligatoriu)
 *   GET  /shipments/:id/awb          - statusul AWB curent
 *   POST /shipments/:id/awb/recover  - „Verifică din nou la Sameday” pentru un AWB
 *                                      neconfirmat (după clientInternalReference);
 *                                      nu creează niciodată un AWB
 *   POST /shipments/:id/awb/cancel   - anulare (doar înainte de predarea coletului;
 *                                      starea se schimbă doar după confirmarea curierului)
 *   GET  /shipments/:id/label        - PDF-ul etichetei (AWB generat de Artfest);
 *                                      altfel lasă cererea să continue spre
 *                                      handlerul existent (labelUrl manual, admin).
 *
 * codAmount / adrese / serviciu NU se acceptă din request - se calculează pe
 * server (adresa de ridicare a vendorului și destinatarul vin din DB).
 */

const router = Router();
const limiter = courierApiLimiter({ max: 40 });
// previzualizarea se încarcă automat în detaliul comenzii (doar citiri la
// curier) - limită separată, ca navigarea să nu blocheze generarea/anularea
const previewLimiter = courierApiLimiter({ max: 120 });
const handle = (fn) => handleCourier(fn, "vendorShipmentAwbRoutes");

// flag backend (COURIER_INTEGRATION_ENABLED): /awb, /awb/preview, /awb/cancel
router.use("/shipments/:id/awb", requireCourierIntegration);

// doar câmpurile permise vendorului (fără codAmount / adrese / sume / serviciu)
function pickAwbInput(body = {}) {
  // contul și serviciul de curier sunt ale Artfest (PLATFORM) - vendorul nu le alege
  const allowed = ["parcels", "weightKg", "lengthCm", "widthCm", "heightCm"];
  const out = {};
  for (const key of allowed) if (body[key] !== undefined) out[key] = body[key];
  return out;
}

router.post(
  "/shipments/:id/awb/preview",
  authRequired,
  requireVendorAccount,
  previewLimiter,
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

router.post(
  "/shipments/:id/awb/recover",
  authRequired,
  requireVendorAccount,
  limiter,
  handle(async (req, res) => {
    res.json(
      await recoverUnknownAwb({
        vendorId: req.vendorId,
        userId: req.user?.sub || null,
        shipmentId: req.params.id,
      })
    );
  })
);

router.post(
  "/shipments/:id/awb/cancel",
  authRequired,
  requireVendorAccount,
  limiter,
  handle(async (req, res) => {
    res.json(
      await cancelAwbForShipment({
        vendorId: req.vendorId,
        userId: req.user?.sub || null,
        shipmentId: req.params.id,
      })
    );
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
  // integrare oprită -> handlerul existent (labelUrl manual setat de admin)
  if (!isCourierIntegrationEnabled()) return next();
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
        // A6 implicit; A4 doar intern (?format=A4)
        format: String(rq.query.format || "A6").toUpperCase() === "A4" ? "A4" : "A6",
      });
      if (!label) return next(); // fără AWB Artfest -> handlerul existent

      rs.setHeader("Content-Type", "application/pdf");
      rs.setHeader("Content-Disposition", `attachment; filename="AWB-${label.awbNumber}.pdf"`);
      rs.setHeader("Cache-Control", "private, no-store");
      rs.send(label.buffer);
    })(req, res);
  } catch (e) {
    return next(e);
  }
});

export default router;
