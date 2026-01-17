// backend/src/server/routes/legal.js
import { Router } from "express";
import { getLegalMeta, getLegalHtml, postVendorAccept } from "../api/legal.js";
import { authRequired } from "../api/auth.js";

const router = Router();

// API pentru meta (Register folosește /api/legal?types=tos,privacy)
router.get("/api/legal", getLegalMeta);

// vendor acceptă documentele legale
router.post("/api/legal/vendor-accept", authRequired, postVendorAccept);

// HTML raw din fișierele .md (latest)
router.get("/legal/:type.html", getLegalHtml);

// HTML raw pentru o versiune specifică
router.get("/legal/:type/v/:version.html", getLegalHtml);

// Slug-uri frumoase -> redirect către HTML (latest)
router.get("/termenii-si-conditiile", (req, res) => res.redirect("/legal/tos.html"));
router.get("/confidentialitate", (req, res) => res.redirect("/legal/privacy.html"));
router.get("/acord-vanzatori", (req, res) => res.redirect("/legal/vendor_terms.html"));
router.get("/politica-retur", (req, res) => res.redirect("/legal/returns_policy_ack.html"));
router.get("/anexa-expediere", (req, res) => res.redirect("/legal/shipping_addendum.html"));
router.get("/anexa-produse", (req, res) => res.redirect("/legal/products_addendum.html"));

export default router;
