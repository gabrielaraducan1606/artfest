// backend/src/routes/adminGpsrRoutes.js
//
// Evidența GPSR în Admin - DOAR citire, DOAR ADMIN:
//   GET /api/admin/gpsr/products/:id         - „Conformitate GPSR” a unui produs
//   GET /api/admin/gpsr/vendors/:id          - „Informări și confirmări GPSR” ale vânzătorului
//   GET /api/admin/gpsr/notice-versions      - versiunile informării (curentă + anterioare)
// Nicio rută nu modifică date și nu trimite notificări.
import { Router } from "express";

import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion, requireRole } from "../api/auth.js";
import { listGpsrNoticeVersions } from "../lib/gpsrDeclaration.js";
import { ADMIN_GPSR_FILTERS, getProductGpsrForAdmin, getVendorGpsrForAdmin } from "../services/gpsrAdmin.js";

const router = Router();
router.use(authRequired, enforceTokenVersion, requireRole("ADMIN"));

router.get("/notice-versions", (_req, res) => {
  res.json({ ok: true, versions: listGpsrNoticeVersions(), filters: ADMIN_GPSR_FILTERS });
});

router.get("/products/:id", async (req, res) => {
  try {
    const data = await getProductGpsrForAdmin(prisma, req.params.id);
    if (!data) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true, gpsr: data });
  } catch (e) {
    console.error("GET /admin/gpsr/products/:id error:", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

router.get("/vendors/:id", async (req, res) => {
  try {
    const data = await getVendorGpsrForAdmin(prisma, req.params.id);
    if (!data) return res.status(404).json({ error: "not_found" });
    return res.json({ ok: true, gpsr: data });
  } catch (e) {
    console.error("GET /admin/gpsr/vendors/:id error:", e?.message || e);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
