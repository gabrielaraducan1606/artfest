// backend/src/routes/adminSamedayDeliveryRoutes.js
//
// Admin: livrarea Sameday prin Artfest per magazin. Montat pe /api/admin/sameday-delivery:
//   GET /stores                       magazinele cu opțiunea activată / restricționate + starea contului Artfest
//   PUT /stores/:serviceId            { disabled: true | false } - restricția Artfest
// Restricția NU dezactivează magazinul (status, produse, livrarea vânzătorului rămân neschimbate).

import { Router } from "express";
import { authRequired, enforceTokenVersion, requireRole } from "../api/auth.js";
import {
  SamedayDeliveryError,
  listSamedayStoresForAdmin,
  setStoreSamedayAdminDisabled,
} from "../services/shipping/samedayStoreDelivery.js";

const router = Router();

router.use(authRequired, enforceTokenVersion, requireRole("ADMIN"));

function sendError(res, error, label) {
  if (error instanceof SamedayDeliveryError) {
    return res.status(error.status).json({ error: error.code, message: error.message });
  }
  console.error(`[adminSamedayDelivery] ${label}:`, error?.code || error?.name || "Error");
  return res.status(500).json({ error: "server_error" });
}

router.get("/stores", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await listSamedayStoresForAdmin());
  } catch (error) {
    sendError(res, error, "GET /stores");
  }
});

router.put("/stores/:serviceId", async (req, res) => {
  try {
    const result = await setStoreSamedayAdminDisabled({
      serviceId: req.params.serviceId,
      disabled: req.body?.disabled,
      adminId: req.user?.sub || req.user?.id || null,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    sendError(res, error, "PUT /stores/:serviceId");
  }
});

export default router;
