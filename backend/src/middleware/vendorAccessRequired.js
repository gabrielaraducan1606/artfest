// src/api/vendorAccessRequired.js
import { prisma } from "../db.js";

/**
 * Middleware: acces DOAR pentru:
 * - user cu rol VENDOR sau ADMIN
 * - SAU user pentru care există un Vendor în DB (vendor asociat userId-ului).
 *
 * Scop:
 * - Protejează rute de tip /api/vendor/*, /api/onboarding/* etc.
 */
export async function vendorAccessRequired(req, res, next) {
  try {
    console.log("=== vendorAccessRequired ===");
    console.log("req.user =", req.user);

    if (!req.user) {
      console.log("NU există req.user -> nu e autentificat corect");
      return res.status(401).json({ error: "unauthorized" });
    }

    // Shortcut: dacă rolul este deja VENDOR sau ADMIN, permitem accesul direct
    if (req.user.role === "VENDOR" || req.user.role === "ADMIN") {
      console.log("Role ok:", req.user.role, "-> next()");
      return next();
    }

    const userId = req.user.sub || req.user.id;

    // Dacă rolul nu e VENDOR/ADMIN, verificăm direct tabela Vendor
    const v = await prisma.vendor.findUnique({
      where: { userId },
    });

    console.log("vendor găsit în DB =", v);

    if (v) {
      // Atașăm vendorul pe req ca să nu mai facem query în handler
      req.meVendor = v;
      return next();
    }

    console.log("NU există Vendor pentru userId =", userId);
    return res.status(403).json({ error: "forbidden_vendor_mw" });
  } catch (e) {
    console.error("vendorAccessRequired error:", e);
    return res.status(500).json({ error: "server_error" });
  }
}
