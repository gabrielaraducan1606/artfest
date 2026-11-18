// backend/src/routes/vendorSamedayDeliveryRoutes.js
//
// „Livrare Sameday prin Artfest” - activarea per magazin, de către vânzător.
// Montat pe /api/vendor:
//   GET /stores/:serviceId/sameday-delivery   starea (eligibilitate, motive, activ)
//   PUT /stores/:serviceId/sameday-delivery   { enabled: true | false }
// Doar magazinele proprii (altfel 404). Eligibilitatea e verificată pe server la activare.

import { Router } from "express";
import { authRequired, enforceTokenVersion } from "../api/auth.js";
import { requireVendorAccount } from "../couriers/http.js";
import {
  SamedayDeliveryError,
  getStoreSamedayStatus,
  setStoreSamedayOptIn,
} from "../services/shipping/samedayStoreDelivery.js";

const router = Router();

function sendError(res, error, label) {
  if (error instanceof SamedayDeliveryError) {
    return res.status(error.status).json({ error: error.code, message: error.message, ...(error.reasons ? { reasons: error.reasons } : {}) });
  }
  console.error(`[vendorSamedayDelivery] ${label}:`, error?.code || error?.name || "Error");
  return res.status(500).json({ error: "server_error", message: "Nu am putut încărca setarea Sameday. Încearcă din nou." });
}

// middleware DOAR pe aceste rute (routerul e montat pe /api/vendor, comun cu alte rute)
const vendorOnly = [authRequired, enforceTokenVersion, requireVendorAccount];

router.get("/stores/:serviceId/sameday-delivery", ...vendorOnly, async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ sameday: await getStoreSamedayStatus({ vendorId: req.vendorId, serviceId: req.params.serviceId }) });
  } catch (error) {
    sendError(res, error, "GET");
  }
});

router.put("/stores/:serviceId/sameday-delivery", ...vendorOnly, async (req, res) => {
  try {
    const sameday = await setStoreSamedayOptIn({
      vendorId: req.vendorId,
      serviceId: req.params.serviceId,
      enabled: req.body?.enabled,
      userId: req.user?.sub || null,
    });
    res.json({ ok: true, sameday });
  } catch (error) {
    sendError(res, error, "PUT");
  }
});

export default router;
