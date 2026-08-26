// backend/src/server/routes/legal.js

import { Router } from "express";

import {
  getLegalMeta,
  getLegalHtml,
  postVendorAccept,
} from "../api/legal.js";

import {
  authRequired,
} from "../api/auth.js";

const router = Router();

/* =========================================================
   API LEGAL META
========================================================= */

// Register folosește:
// /api/legal?types=tos,privacy
router.get(
  "/api/legal",
  getLegalMeta
);

/* =========================================================
   VENDOR ACCEPT
========================================================= */

router.post(
  "/api/legal/vendor-accept",
  authRequired,
  postVendorAccept
);

/* =========================================================
   DOCUMENTE HTML
========================================================= */

// latest
router.get(
  "/legal/:type.html",
  getLegalHtml
);

// versiune specifică
router.get(
  "/legal/:type/v/:version.html",
  getLegalHtml
);

/* =========================================================
   SLUG-URI PUBLICE
========================================================= */

router.get(
  "/termenii-si-conditiile",
  (req, res) =>
    res.redirect(
      "/legal/tos.html"
    )
);

router.get(
  "/confidentialitate",
  (req, res) =>
    res.redirect(
      "/legal/privacy.html"
    )
);

router.get(
  "/cookies",
  (req, res) =>
    res.redirect(
      "/legal/cookies.html"
    )
);

router.get(
  "/acord-vanzatori",
  (req, res) =>
    res.redirect(
      "/legal/vendor_terms.html"
    )
);

router.get(
  "/acord-influenceri",
  (req, res) =>
    res.redirect(
      "/legal/influencer_terms.html"
    )
);

router.get(
  "/politica-retur",
  (req, res) =>
    res.redirect(
      "/legal/returns_policy_ack.html"
    )
);

router.get(
  "/anexa-expediere",
  (req, res) =>
    res.redirect(
      "/legal/shipping_addendum.html"
    )
);

router.get(
  "/anexa-produse",
  (req, res) =>
    res.redirect(
      "/legal/products_addendum.html"
    )
);

export default router;