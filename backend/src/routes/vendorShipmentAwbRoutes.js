// backend/src/routes/vendorShipmentAwbRoutes.js

import { Router } from "express";
import { authRequired, optionalAuth } from "../api/auth.js";
import { prisma } from "../db.js";
import {
  requireVendorAccount,
  courierApiLimiter,
  handleCourier,
  requireCourierIntegration,
  requireCourierAwbLive,
  isCourierIntegrationEnabled,
} from "../couriers/http.js";
import { isCourierAwbLiveEnabled } from "../couriers/awbLive.js";
import {
  previewAwb,
  createAwbForShipment,
  getAwbStatus,
  getAwbLabel,
  cancelAwbForShipment,
  recoverUnknownAwb,
  isArtfestLabelUrl,
} from "../couriers/awb/awbService.js";
import { loadVendorShipmentTimeline } from "../couriers/tracking/trackingTimeline.js";

/*
 * AWB pentru expedierile vendorului (montat pe /api/vendor, ÎNAINTEA
 * vendorOrdersRoutes):
 *   POST /shipments/:id/awb/preview  - previzualizare + blockere (nu creează nimic)
 *   POST /shipments/:id/awb          - creare (header Idempotency-Key obligatoriu;
 *                                      în plus COURIER_AWB_LIVE_ENABLED=true)
 *   GET  /shipments/:id/awb          - statusul AWB curent
 *   GET  /shipments/:id/awb/tracking - istoricul tracking-ului (ShipmentTrackingEvent),
 *                                      doar citire, doar expedierea proprie
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
    // awbLiveEnabled: doar UX (butonul „Generează AWB”); protecția e pe server
    res.json({ preview: { ...preview, awbLiveEnabled: isCourierAwbLiveEnabled() } });
  })
);

router.post(
  "/shipments/:id/awb",
  authRequired,
  requireVendorAccount,
  // AWB real oprit (COURIER_AWB_LIVE_ENABLED) -> 503, fără niciun apel la curier
  requireCourierAwbLive,
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

// istoricul tracking-ului: DOAR expedierea vendorului autentificat (altfel 404),
// câmpuri filtrate (fără chei interne / date de deschidere locker)
router.get(
  "/shipments/:id/awb/tracking",
  authRequired,
  requireVendorAccount,
  handle(async (req, res) => {
    const out = await loadVendorShipmentTimeline(prisma, { vendorId: req.vendorId, shipmentId: req.params.id });
    if (!out) return res.status(404).json({ error: "shipment_not_found", message: "Expedierea nu există." });
    res.set("Cache-Control", "no-store");
    return res.json(out);
  })
);

// numele fișierului: doar caractere sigure (numărul AWB vine de la curier)
export function labelFilename(awbNumber) {
  const safe = String(awbNumber || "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 60);
  return `AWB-${safe || "eticheta"}.pdf`;
}

/*
 * Eticheta AWB (PDF A6, descărcată de la Sameday prin backend - frontend-ul
 * nu apelează niciodată curierul, tokenul nu iese din server):
 *   neautentificat -> 401; utilizator fără magazin -> 403;
 *   Shipment-ul altui vendor -> 404; AWB în curs / neconfirmat -> 409;
 *   AWB generat de Artfest -> PDF; fără AWB Artfest -> handlerul existent
 *   (vendorOrdersRoutes: labelUrl setat manual de admin, altfel 404).
 * Eticheta NU depinde de COURIER_AWB_LIVE_ENABLED (doar citire); cu
 * integrarea oprită, un AWB Artfest primește 503 (fără redirect în buclă:
 * labelUrl-ul lui e chiar această rută).
 */
router.get("/shipments/:id/label", optionalAuth, async (req, res, next) => {
  if (!req.user?.sub) return res.status(401).json({ error: "unauthenticated" });
  try {
    const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.sub }, select: { id: true } });
    if (!vendor) return res.status(403).json({ error: "vendor_only" });
    req.vendorId = vendor.id;

    const owned = await prisma.shipment.findFirst({
      where: { id: String(req.params.id || ""), vendorId: vendor.id },
      select: { id: true, labelUrl: true },
    });
    if (!owned) return res.status(404).json({ error: "shipment_not_found", message: "Expedierea nu a fost găsită." });
    const artfestLabel = isArtfestLabelUrl(owned.id, owned.labelUrl);

    if (!isCourierIntegrationEnabled()) {
      if (!artfestLabel) return next(); // eticheta manuală (admin)
      return res.status(503).json({ error: "courier_integration_disabled", message: "Integrarea de curierat este în curs de activare." });
    }

    return handle(async (rq, rs) => {
      const label = await getAwbLabel({
        vendorId: rq.vendorId,
        shipmentId: rq.params.id,
        // A6 implicit; A4 doar intern (?format=A4)
        format: String(rq.query.format || "A6").toUpperCase() === "A4" ? "A4" : "A6",
      });
      if (!label) {
        if (!artfestLabel) return next(); // fără AWB Artfest -> handlerul existent
        return rs.status(404).json({ error: "awb_missing", message: "Expedierea nu are un AWB generat pentru care să descarci eticheta." });
      }

      rs.setHeader("Content-Type", "application/pdf");
      rs.setHeader("Content-Disposition", `attachment; filename="${labelFilename(label.awbNumber)}"`);
      rs.setHeader("Content-Length", String(label.buffer.length));
      rs.setHeader("Cache-Control", "private, no-store");
      rs.setHeader("X-Content-Type-Options", "nosniff");
      rs.send(label.buffer);
    })(req, res);
  } catch (e) {
    return next(e);
  }
});

export default router;
