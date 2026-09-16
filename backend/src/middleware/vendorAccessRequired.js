// src/api/vendorAccessRequired.js
import { prisma } from "../db.js";

/**
 * Middleware: acces DOAR pentru:
 * - ADMIN (bypass total - are nevoie de acces la rute vendor pentru
 *   administrare/inspecție, independent de contul lui personal);
 * - SAU un user pentru care există un Vendor ACTIV în DB, asociat
 *   userId-ului din sesiune.
 *
 * Scop:
 * - Protejează rute de tip /api/vendor/*, /api/onboarding/* etc.
 *
 * ÎNTĂRIRE (audit 2026-09-16, bug "ștergere cont vânzător nu are
 * efect"): versiunea anterioară avea un shortcut care accepta
 * NECONDIȚIONAT orice JWT cu `role: "VENDOR"`, FĂRĂ să verifice
 * starea reală din DB - un vendor dezactivat/anonimizat (Vendor.isActive
 * = false, User.status = "DELETED"/locked = true) rămânea cu acces
 * complet la dashboard atât timp cât sesiunea (JWT) veche era încă
 * validă (până la expirarea naturală, 7 zile) - contul "șters" nu
 * era de fapt inaccesibil.
 *
 * Acum: rolul din JWT NU mai e suficient - se verifică ÎNTOTDEAUNA
 * (pentru non-ADMIN) starea REALĂ din DB: Vendor.isActive !== false
 * ȘI User.locked !== true ȘI User.status !== "DELETED". Se
 * folosește ÎMPREUNĂ cu enforceTokenVersion (api/auth.js) pe toate
 * rutele care aplică acest middleware - enforceTokenVersion respinge
 * tokenul vechi dacă tokenVersion nu mai corespunde (schimbare de
 * parolă, ștergere cont etc.), iar acest middleware respinge accesul
 * chiar dacă tokenul e tehnic valid, dar contul nu mai e activ.
 */
export async function vendorAccessRequired(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "unauthorized" });
    }

    if (req.user.role === "ADMIN") {
      return next();
    }

    const userId = req.user.sub || req.user.id;

    const v = await prisma.vendor.findUnique({
      where: { userId },
      include: {
        user: {
          select: { locked: true, status: true },
        },
      },
    });

    if (!v) {
      return res.status(403).json({ error: "forbidden_vendor_mw" });
    }

    if (v.isActive === false) {
      return res.status(403).json({ error: "vendor_deactivated" });
    }

    if (v.user?.locked === true || v.user?.status === "DELETED") {
      return res.status(403).json({ error: "account_deleted" });
    }

    // Atașăm vendorul pe req ca să nu mai facem query în handler.
    req.meVendor = v;
    return next();
  } catch (e) {
    console.error("vendorAccessRequired error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
