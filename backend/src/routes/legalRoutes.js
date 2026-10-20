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

import { loadPublishedFairRules } from "../lib/artfestFairRules.js";

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
   REGULAMENTUL TÂRGULUI ARTFEST (versiuni publicate)
   Doar versiunile din legal/artfest_fair_rules/versions.yml;
   draftul nu este servit niciodată. Pagina publică:
   /targ-artfest/regulament/v<versiune> (frontend).
========================================================= */

function escapeFairHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Declarată ÎNAINTEA rutei generice /legal/:type/v/:version.html, care altfel ar
// prinde „artfest-fair-rules” ca tip de document și ar răspunde 404.
router.get("/legal/artfest-fair-rules/v/:version.html", (req, res) => {
  try {
    const doc = loadPublishedFairRules(req.params.version);
    if (!doc) return res.status(404).send("Document inexistent.");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeFairHtml(doc.title)}</title>
    <style>
      body { max-width: 800px; margin: 40px auto; padding: 0 16px;
             font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.6; }
      h1, h2, h3 { color: #222; }
      .meta { color: #666; font-size: 14px; margin-bottom: 16px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
    </style>
  </head>
  <body>
    <h1>${escapeFairHtml(doc.title)}</h1>
    <p class="meta">Versiune: v${escapeFairHtml(doc.version)}${doc.publishedAt ? ` • publicată la ${escapeFairHtml(doc.publishedAt)}` : ""}</p>
    ${doc.html}
  </body>
</html>`);
  } catch (e) {
    console.error("artfest fair rules html error:", e?.message || e);
    res.status(404).send("Document inexistent.");
  }
});

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