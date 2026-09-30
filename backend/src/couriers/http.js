// backend/src/couriers/http.js

import rateLimit from "express-rate-limit";
import { prisma } from "../db.js";
import { isCourierError } from "./errors.js";

/*
 * Helperi HTTP comuni rutelor de curier (conturi, adrese, AWB).
 */

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
