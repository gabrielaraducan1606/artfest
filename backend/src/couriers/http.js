// backend/src/couriers/http.js

import rateLimit from "express-rate-limit";
import { prisma } from "../db.js";
import { isCourierError } from "./errors.js";

/*
 * Helperi HTTP comuni rutelor de curier (conturi, adrese, AWB).
 */

/*
 * Flag backend pentru integrarea de curierat a VENDORILOR (conturi, adrese
 * de ridicare, generare / anulare AWB, etichete Artfest):
 *   COURIER_INTEGRATION_ENABLED = "1" / "true"  -> pornit
 *                               = "0" / "false" -> oprit
 *   nesetat -> pornit DOAR când NODE_ENV=development (backend/.env local);
 *              Render rulează cu NODE_ENV=production (Dockerfile) => OPRIT
 *              până la setarea explicită a variabilei.
 * Rutele de admin (vizualizare / rezolvare AWB UNKNOWN) nu depind de flag.
 */
export function isCourierIntegrationEnabled(env = process.env) {
  const raw = String(env.COURIER_INTEGRATION_ENABLED ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return env.NODE_ENV === "development";
}

export function requireCourierIntegration(_req, res, next) {
  if (isCourierIntegrationEnabled()) return next();
  return res.status(503).json({
    error: "courier_integration_disabled",
    message: "Integrarea de curierat este în curs de activare.",
  });
}

// req.user (din authRequired / optionalAuth) -> req.vendorId; 403 dacă nu e vendor
export async function requireVendorAccount(req, res, next) {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: req.user?.sub },
      select: { id: true },
    });
    if (!vendor) return res.status(403).json({ error: "vendor_only" });
    req.vendorId = vendor.id;
    next();
  } catch (e) {
    next(e);
  }
}

// operațiile care contactează API-ul curierului
export function courierApiLimiter({ max, windowMs = 10 * 60 * 1000 } = {}) {
  return rateLimit({
    windowMs,
    max: Number(process.env.COURIER_API_RATE_LIMIT_MAX) || max || 20,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `courier:${req.vendorId}`,
    handler: (_req, res) =>
      res.status(429).json({
        error: "too_many_requests",
        message: "Prea multe încercări. Încearcă din nou peste câteva minute.",
      }),
  });
}

/*
 * Erorile de curier -> răspuns sanitizat (mesaj fix + câmpuri + blockere).
 * Altceva -> 500 generic; în log doar tipul erorii (mesajul poate conține
 * date din request).
 */
export function handleCourier(fn, logLabel = "couriers") {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (isCourierError(e)) {
        return res.status(e.httpStatus || 500).json({
          error: e.code,
          message: e.message,
          ...(e.fields?.length ? { fields: e.fields } : {}),
          ...(Array.isArray(e.blockers) ? { blockers: e.blockers } : {}),
          ...(e.preview ? { preview: e.preview } : {}),
        });
      }
      console.error(
        `[${logLabel}] ${req.method} ${req.route?.path} failed:`,
        e?.name || "Error",
        e?.code || ""
      );
      return res.status(500).json({ error: "server_error" });
    }
  };
}
