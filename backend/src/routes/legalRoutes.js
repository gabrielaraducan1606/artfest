// backend/src/server/routes/legal.js

import { Router } from "express";
import {
  getLegalMeta,
  getLegalHtml,
  postVendorAccept,
} from "../api/legal.js";
import { authRequired } from "../api/auth.js";

const router = Router();

// API pentru meta (Register folosește /api/legal?types=tos,privacy)
router.get("/api/legal", getLegalMeta);

// vendor acceptă documentele legale
router.post("/api/legal/vendor-accept", authRequired, postVendorAccept);

// HTML raw din fișierele .md
router.get("/legal/:type.html", getLegalHtml);

// Slug-uri frumoase -> redirect către HTML
router.get("/termenii-si-conditiile", (req, res) => {
  return res.redirect("/legal/tos.html");
});

router.get("/confidentialitate", (req, res) => {
  return res.redirect("/legal/privacy.html");
});

router.get("/acord-vanzatori", (req, res) => {
  return res.redirect("/legal/vendor_terms.html");
});

// 🔹 aici trebuie să fie type-urile "returns" și "shipping_addendum"
router.get("/politica-retur", (req, res) => {
  return res.redirect("/legal/returns.html");
});

router.get("/anexa-expediere", (req, res) => {
  return res.redirect("/legal/shipping_addendum.html");
});

export default router;
