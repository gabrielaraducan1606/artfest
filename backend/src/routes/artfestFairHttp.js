// backend/src/routes/artfestFairHttp.js
//
// Middleware-uri comune pentru rutele de vendor ale Târgului Artfest.

import { prisma } from "../db.js";
import { FairError } from "../services/artfestFairService.js";
import { loadFairRulesDraft } from "../lib/artfestFairRules.js";

/*
 * Draftul regulamentului, doar pentru citire (vendor / Admin autentificat).
 * NU e documentul oficial: nu are termsUrl, nu se acceptă și nu se indexează.
 */
export function sendFairRulesDraft(_req, res) {
  try {
    const draft = loadFairRulesDraft();
    res.set("Cache-Control", "no-store");
    res.set("X-Robots-Tag", "noindex, nofollow");
    if (!draft) return res.status(404).json({ error: "draft_not_found", message: "Draftul regulamentului nu este disponibil." });
    return res.json({
      ...draft,
      official: false,
      notice: "Draft de lucru - NU este versiunea oficială a regulamentului și nu reprezintă documentul acceptat la înscriere.",
    });
  } catch (error) {
    console.error("[artfestFair] rules draft:", error?.message || error);
    return res.status(500).json({ error: "server_error", message: "Nu am putut încărca draftul." });
  }
}

export function getRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || null;
}

// vendorId DOAR din sesiune
export async function requireVendor(req, res, next) {
  try {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: req.user?.sub },
      select: { id: true },
    });
    if (!vendor) return res.status(403).json({ error: "vendor_only" });
    req.vendorId = vendor.id;
    next();
  } catch (error) {
    next(error);
  }
}

const PASSTHROUGH = ["fields", "currentStatus", "problems", "productId", "available", "requested", "item"];

export function handleFair(fn, tag = "artfestFair") {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (error instanceof FairError) {
        const extra = {};
        for (const key of PASSTHROUGH) if (error[key] !== undefined) extra[key] = error[key];
        return res.status(error.status).json({ error: error.code, message: error.message, ...extra });
      }
      // codul Prisma (ex. P2028 = tranzacție expirată) ajută la diagnostic
      console.error(`[${tag}]`, req.method, req.originalUrl, error?.code || "", error?.message || error);
      return res.status(500).json({ error: "server_error", message: "A apărut o eroare. Încearcă din nou." });
    }
  };
}
