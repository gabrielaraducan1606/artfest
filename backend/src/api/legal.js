// backend/src/api/legal.js
import { loadLegalDoc, loadMany } from "../lib/legal.js";

/**
 * GET /api/legal?types=tos,privacy,...
 * Returnează meta (titlu, versiune, checksum, url)
 */
export function getLegalMeta(req, res) {
  try {
    const q = String(req.query.types || "");
    const types = q
      ? q.split(",").map((s) => s.trim()).filter(Boolean)
      : ["tos", "privacy"];

    const out = loadMany(types).map((d) => ({
      type: d.type,
      title: d.title,
      version: d.version,
      checksum: d.checksum,
      url:
        d.type === "tos"
          ? "/termenii-si-conditiile"
          : d.type === "privacy"
          ? "/confidentialitate"
          : d.type === "vendor_terms"
          ? "/legal/vendor/terms"
          : d.type === "shipping_addendum"
          ? "/legal/vendor/expediere"
          : d.type === "returns"
          ? "/retur"
          : "#",
    }));

    res.json(out);
  } catch (e) {
    console.error("getLegalMeta error:", e);
    res.status(500).json({ error: "legal_meta_failed" });
  }
}

/**
 * GET /legal/:type.html
 * Returnează conținut HTML (pentru iframe-uri în frontend)
 */
export function getLegalHtml(req, res) {
  try {
    const type = req.params.type;
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
