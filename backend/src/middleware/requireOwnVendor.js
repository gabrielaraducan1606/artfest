// src/middleware/requireOwnVendor.js
//
// Rutele care scriu în catalogul / conexiunile vânzătorului (importuri,
// magazine externe): lanțul standard Artfest (api/auth.js +
// middleware/vendorAccessRequired.js), plus:
//   - tokenul trebuie să conțină tokenVersion (toate tokenurile emise îl
//     conțin); fără el revocarea nu se poate verifica;
//   - doar un VENDOR cu magazinul propriu (ADMIN trece de
//     vendorAccessRequired, dar aici se lucrează pe datele vânzătorului);
//   - contul trebuie să fie ACTIVE (vendorAccessRequired respinge deja
//     locked / DELETED; aici și SUSPENDED).
// Setează req.authUser = { id, role } și req.vendor = { id, isActive }.

import { authRequired, enforceTokenVersion } from "../api/auth.js";
import { vendorAccessRequired } from "./vendorAccessRequired.js";

export function requireOwnVendor(req, res, next) {
  if (typeof req.user?.tv === "undefined") {
    return res.status(401).json({ error: "invalid_token" });
  }

  const vendor = req.meVendor;

  if (req.user.role !== "VENDOR" || !vendor) {
    return res.status(403).json({ error: "vendor_required" });
  }

  if (vendor.user?.status !== "ACTIVE") {
    return res.status(403).json({ error: "account_inactive" });
  }

  req.authUser = { id: vendor.userId, role: req.user.role };
  req.vendor = { id: vendor.id, isActive: vendor.isActive };

  next();
}

/** Lanțul complet, în ordine. */
export const ownVendorChain = [authRequired, enforceTokenVersion, vendorAccessRequired, requireOwnVendor];
