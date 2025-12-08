import { Router } from "express";
import { getLegalMeta, getLegalHtml } from "../api/legal.js";

const router = Router();

// API pentru meta (Register folosește /api/legal?types=tos,privacy)
router.get("/api/legal", getLegalMeta);

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

export default router;
