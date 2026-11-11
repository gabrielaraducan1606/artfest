// backend/src/routes/adminCouriersRoutes.js
//
// Pagina Admin „Curieri” - DOAR ADMIN:
//   GET  /api/admin/couriers                     toți curierii (Sameday + „În curând”), fără apel extern
//   GET  /api/admin/couriers/:provider/status    starea unui curier, fără apel extern
//   GET  /api/admin/couriers/tracking?q=        istoricul tracking-ului (ShipmentTrackingEvent) după AWB /
//                                                nr. comandă / id expediere - doar citire, fără apel extern
//   POST /api/admin/couriers/:provider/check    verificare REALĂ read-only (Sameday: autentificare,
//                                                pickup-points, services); pauză minimă între verificări
// Nimic nu se scrie în DB / configurație; mediul nu se schimbă de aici.
// Răspunsurile trec printr-un allow-list (publicCourierStatus): niciun câmp
// neprevăzut (credentiale, token, cont criptat) nu poate ajunge în frontend.

import express from "express";

import { authRequired as defaultAuthRequired, enforceTokenVersion as defaultEnforceTokenVersion, requireRole as defaultRequireRole } from "../api/auth.js";
import { ADMIN_COURIER_ORDER, courierAdminService } from "../couriers/admin/courierAdminStatus.js";
import { searchAdminTimelines } from "../couriers/tracking/trackingTimeline.js";

const pick = (obj, keys) => (obj && typeof obj === "object" ? Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]])) : null);

const SERVICE_KEYS = ["active", "id", "name", "source"];
const PICKUP_KEYS = ["id", "alias", "address", "city", "county", "postalCode", "isDefault", "active", "isConfigured"];

/** Allow-list explicit al câmpurilor trimise frontend-ului. */
export function publicCourierStatus(item) {
  if (!item) return null;
  if (!item.implemented) return { provider: item.provider, name: item.name, implemented: false };
  const lc = item.lastCheck;
  const servicesOf = (s) => (s ? { HOME: pick(s.HOME, SERVICE_KEYS), LOCKER: pick(s.LOCKER, SERVICE_KEYS), PUDO: pick(s.PUDO, SERVICE_KEYS) } : null);
  return {
    provider: item.provider,
    name: item.name,
    implemented: true,
    status: item.status,
    environment: item.environment || null,
    environmentSource: item.environmentSource || null,
    productionCheckAllowed: Boolean(item.productionCheckAllowed),
    credentials: pick(item.credentials, ["env", "platformAccount", "testedWith"]),
    configuration: pick(item.configuration, ["pickupPointId", "contactPersonId", "homeServiceId", "lockerServiceId", "pudoServiceId"]),
    lastCheck: lc
      ? {
          status: lc.status,
          code: lc.code || null,
          message: lc.message || null,
          checkedAt: lc.checkedAt || null,
          durationMs: Number.isFinite(lc.durationMs) ? lc.durationMs : null,
          environment: lc.environment || null,
          testedWith: lc.credentials?.testedWith || null,
          issues: (lc.issues || []).map((i) => pick(i, ["code", "message"])),
          services: servicesOf(lc.services),
          allServices: (lc.allServices || []).map((s) => pick(s, ["id", "name", "deliveryType"])),
          pickupPoints: (lc.pickupPoints || []).map((p) => ({
            ...pick(p, PICKUP_KEYS),
            contacts: (p.contacts || []).map((c) => pick(c, ["id", "name", "isDefault"])),
          })),
        }
      : null,
  };
}

export function createAdminCouriersRouter({
  service = null,
  deps = {},
  db = null, // implicit: clientul Prisma comun (încărcat la prima căutare)
  authRequired = defaultAuthRequired,
  enforceTokenVersion = defaultEnforceTokenVersion,
  requireRole = defaultRequireRole,
} = {}) {
  const router = express.Router();
  const svc = () => service || courierAdminService();
  const known = new Set(ADMIN_COURIER_ORDER.map(([id]) => id));

  router.use(authRequired, enforceTokenVersion, requireRole("ADMIN"), (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  const providerOf = (req, res) => {
    const id = String(req.params.provider || "").toUpperCase();
    if (!known.has(id)) {
      res.status(404).json({ error: "courier_not_found", message: "Curierul nu există." });
      return null;
    }
    return id;
  };

  router.get("/", async (_req, res) => {
    try {
      const items = await svc().list(deps);
      return res.json({ items: items.map(publicCourierStatus) });
    } catch (error) {
      console.error("[admin/couriers] list:", error?.code || error?.name || "error");
      return res.status(500).json({ error: "couriers_status_failed", message: "Nu am putut încărca starea curierilor." });
    }
  });

  router.get("/tracking", async (req, res) => {
    try {
      const client = db || (await import("../db.js")).prisma;
      const results = await searchAdminTimelines(client, req.query.q);
      if (!results) return res.status(400).json({ error: "invalid_query", message: "Introdu un AWB, un număr de comandă sau id-ul expedierii." });
      return res.json({ results });
    } catch (error) {
      console.error("[admin/couriers] tracking:", error?.code || error?.name || "error");
      return res.status(500).json({ error: "tracking_failed", message: "Nu am putut încărca istoricul tracking-ului." });
    }
  });

  router.get("/:provider/status", async (req, res) => {
    const id = providerOf(req, res);
    if (!id) return undefined;
    try {
      return res.json({ courier: publicCourierStatus(await svc().describe(id, deps)) });
    } catch (error) {
      console.error("[admin/couriers] status:", error?.code || error?.name || "error");
      return res.status(500).json({ error: "couriers_status_failed", message: "Nu am putut încărca starea curierului." });
    }
  });

  router.post("/:provider/check", async (req, res) => {
    const id = providerOf(req, res);
    if (!id) return undefined;
    try {
      const out = await svc().check(id, deps);
      if (out.notImplemented) return res.status(409).json({ error: "courier_not_implemented", message: "Integrarea cu acest curier nu este disponibilă încă." });
      const courier = publicCourierStatus(await svc().describe(id, deps));
      if (out.throttled) {
        res.set("Retry-After", String(out.retryAfterSec));
        return res.status(429).json({ error: "check_rate_limited", message: `Poți verifica din nou peste ${out.retryAfterSec} secunde.`, retryAfterSec: out.retryAfterSec, courier });
      }
      return res.json({ courier });
    } catch (error) {
      console.error("[admin/couriers] check:", error?.code || error?.name || "error");
      return res.status(500).json({ error: "couriers_check_failed", message: "Verificarea nu a putut fi finalizată." });
    }
  });

  return router;
}

export default createAdminCouriersRouter();
