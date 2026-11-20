// backend/src/routes/adminSamedayDeliveryRoutes.js
//
// Admin: livrarea Sameday prin Artfest per magazin. Montat pe /api/admin/sameday-delivery:
//   GET /stores                       magazinele cu opțiunea activată / restricționate + starea contului Artfest
//   PUT /stores/:serviceId            { disabled: true | false } - restricția Artfest
//   GET /config                       tariful simplu Artfest pe metodă (coșuri cu produse fără greutate)
//   PUT /config/:method               { amountLei } - gol = neconfigurat
// Restricția NU dezactivează magazinul (status, produse, livrarea vânzătorului rămân neschimbate).

import { Router } from "express";
import { authRequired, enforceTokenVersion, requireRole } from "../api/auth.js";
import {
  SamedayDeliveryError,
  listSamedayStoresForAdmin,
  setStoreSamedayAdminDisabled,
} from "../services/shipping/samedayStoreDelivery.js";
import { prisma } from "../db.js";
import { ArtfestConfigError, loadArtfestSamedayConfig, saveArtfestMethodAmount } from "../services/shipping/artfestSamedayConfig.js";

const router = Router();

router.use(authRequired, enforceTokenVersion, requireRole("ADMIN"));

function sendError(res, error, label) {
  if (error instanceof SamedayDeliveryError || error instanceof ArtfestConfigError) {
    return res.status(error.status).json({ error: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) });
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

const adminId = (req) => req.user?.sub || req.user?.id || null;

router.get("/config", async (_req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ config: await loadArtfestSamedayConfig(prisma) });
  } catch (error) {
    sendError(res, error, "GET /config");
  }
});

router.put("/config/:method", async (req, res) => {
  try {
    const saved = await saveArtfestMethodAmount({ db: prisma, method: req.params.method, amountLei: req.body?.amountLei, adminId: adminId(req) });
    res.json({ ok: true, config: saved });
  } catch (error) {
    sendError(res, error, "PUT /config/:method");
  }
});

export default router;
