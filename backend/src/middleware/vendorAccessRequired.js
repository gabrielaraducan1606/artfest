// backend/src/middleware/vendorAccessRequired.js
import { prisma } from "../db.js";

/**
 * Permite accesul dacă:
 *  - tokenul are role VENDOR/ADMIN, sau
 *  - utilizatorul are deja un Vendor în DB (chiar dacă role-ul din JWT e încă USER).
 * Pune vendorul în req.meVendor ca să eviți query-uri duplicate în rute.
 */
export async function vendorAccessRequired(req, res, next) {
  try {
    if (req.user?.role === "VENDOR" || req.user?.role === "ADMIN") return next();
    const v = await prisma.vendor.findUnique({ where: { userId: req.user.sub } });
    if (v) { req.meVendor = v; return next(); }
    return res.status(403).json({ error: "forbidden" });
  } catch {
    return res.status(500).json({ error: "server_error" });
  }
}
