// backend/src/api/legal.js

// loadLegalDoc / loadMany știu să încarce din filesystem / config
// documentele legale (TOS, privacy, vendor terms etc.)
import { loadLegalDoc, loadMany } from "../lib/legal.js";

/**
 * GET /api/legal?types=tos,privacy,...
 *
 * Scop:
 *  - Frontend-ul poate cere meta-informații despre unul sau mai multe
 *    documente legale (Termeni, Politica de confidențialitate, etc.).
 *
 * Răspuns:
 *  - array de obiecte cu:
 *    - type      (ex: "tos", "privacy", "vendor_terms")
 *    - title     (titlul documentului)
 *    - version   (versiunea curentă)
 *    - checksum  (hash pentru detectarea modificărilor)
 *    - url       (link-ul public unde poate fi citit documentul în site)
 */
export function getLegalMeta(req, res) {
  try {
    const q = String(req.query.types || "");
    const types = q
      ? q
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : ["tos", "privacy"]; // fallback: dacă nu se specifică nimic, trimitem TOS + Privacy

    // încărcăm din lib toate documentele cerute
    const out = loadMany(types).map((d) => ({
      type: d.type,
      title: d.title,
      version: d.version,
      checksum: d.checksum,
      // URL-ul public unde poate fi afișat documentul în frontend
      url:
        d.type === "tos"
          ? "/termenii-si-conditiile"
          : d.type === "privacy"
          ? "/confidentialitate"
          : d.type === "vendor_terms"
          ? "/acord-vanzatori"              // 🔴 AICI am făcut mapping-ul frumos
          : d.type === "shipping_addendum"
          ? "/legal/vendor/expediere"
          : d.type === "returns"
          ? "/retur"
          : "#", // fallback pentru tipuri ne-mapate
    }));

    res.json(out);
  } catch (e) {
    console.error("getLegalMeta error:", e);
    res.status(500).json({ error: "legal_meta_failed" });
  }
}

/**
 * GET /legal/:type.html
 *
 * Scop:
 *  - Returnează conținutul HTML al unui document legal pentru a putea fi
 *    randat în iframe / pagină separată în frontend.
 *
 * Răspuns:
 *  - HTML complet (doctype, head, body) cu:
 *    - titlu
 *    - versiune + dată valabilă (dacă există)
 *    - conținutul d.html (HTML generat din markdown / alt format)
 */
export function getLegalHtml(req, res) {
  try {
    const type = req.params.type;

    // loadLegalDoc aruncă eroare dacă tipul nu există
    const d = loadLegalDoc(type);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${d.title}</title>
    <style>
      body {
        max-width: 800px;
        margin: 40px auto;
        padding: 0 16px;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        line-height: 1.6;
      }
      h1,h2,h3 { color: #222; }
      a { color: #0056b3; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .meta { color: #666; font-size: 14px; margin-bottom: 16px; }
      pre { background: #f5f5f5; padding: 10px; border-radius: 6px; }
      code { background: #f5f5f5; padding: 2px 4px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>${d.title}</h1>
    <p class="meta">
      Versiune: v${d.version}${
        d.valid_from ? ` • valabil din ${d.valid_from}` : ""
      }
    </p>
    ${d.html}
  </body>
</html>`);
  } catch (e) {
    console.error("getLegalHtml error:", e);
    res.status(404).send("Document inexistent.");
  }
}
