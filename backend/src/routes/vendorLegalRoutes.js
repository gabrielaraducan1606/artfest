import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, requireRole } from "../api/auth.js";
import { loadMany, loadLegalDoc } from "../lib/legal.js";

const router = Router();

/* ===================== VENDOR ACCEPTANCES ===================== */
/** GET /api/vendor/acceptances */
router.get(
  "/vendor/acceptances",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    try {
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.sub },
        select: { id: true },
      });
      if (!vendor) return res.status(404).json({ error: "vendor_not_found" });

      const rows = await prisma.vendorAcceptance.findMany({
        where: { vendorId: vendor.id },
        select: { document: true, version: true, checksum: true, acceptedAt: true },
      });

      const accepted = {
        vendor_terms: rows.some((r) => r.document === "VENDOR_TERMS"),
        shipping_addendum: rows.some((r) => r.document === "SHIPPING_ADDENDUM"),
        returns_policy: rows.some((r) => r.document === "RETURNS_POLICY_ACK"),
      };

      const docs = loadMany(["vendor_terms", "shipping_addendum", "returns"]);
      const legalMeta = {};
      for (const d of docs) {
        legalMeta[d.type] = {
          title: d.title,
          version: d.version,
          checksum: d.checksum,
          url:
            d.type === "vendor_terms"
              ? "/legal/vendor/terms"
              : d.type === "shipping_addendum"
              ? "/legal/vendor/expediere"
              : d.type === "returns"
              ? "/retur"
              : "#",
        };
      }

      res.json({ accepted, legalMeta });
    } catch (e) {
      console.error("vendor/acceptances error:", e);
      res.status(500).json({ error: "acceptances_failed" });
    }
  }
);

/** POST /api/legal/vendor-accept
 * body: { accept: [{ type: 'vendor_terms'|'shipping_addendum'|'returns', version, checksum }] }
 */
router.post(
  "/legal/vendor-accept",
  authRequired,
  requireRole("VENDOR", "ADMIN"),
  async (req, res) => {
    try {
      const vendor = await prisma.vendor.findUnique({
        where: { userId: req.user.sub },
        select: { id: true },
      });
      if (!vendor) return res.status(404).json({ error: "vendor_not_found" });

      const items = Array.isArray(req.body?.accept) ? req.body.accept : [];
      if (!items.length) return res.status(400).json({ error: "empty_payload" });

      const mapDoc = (t) =>
        t === "vendor_terms"
          ? "VENDOR_TERMS"
          : t === "shipping_addendum"
          ? "SHIPPING_ADDENDUM"
          : t === "returns"
          ? "RETURNS_POLICY_ACK"
          : null;

      await prisma.$transaction(async (tx) => {
        for (const it of items) {
          const doc = mapDoc(it.type);
          if (!doc) continue;
          await tx.vendorAcceptance.upsert({
            where: {
              vendorId_document: { vendorId: vendor.id, document: doc },
            },
            update: {
              version: String(it.version || "1.0.0"),
              checksum: it.checksum || null,
            },
            create: {
              vendorId: vendor.id,
              document: doc,
              version: String(it.version || "1.0.0"),
              checksum: it.checksum || null,
            },
          });
        }
      });

      res.json({ ok: true });
    } catch (e) {
      console.error("vendor-accept error:", e);
      res.status(500).json({ error: "vendor_accept_failed" });
    }
  }
);

/* ===================== LEGAL META + HTML ===================== */
/** GET /api/legal?types=tos,privacy,vendor_terms,... */
router.get("/legal", (req, res) => {
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
});

/** GET /api/legal/html/:type */
router.get("/legal/html/:type", (req, res) => {
  try {
    const d = loadLegalDoc(req.params.type);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${d.title}</title>
    <style>
      body { max-width: 800px; margin: 40px auto; padding: 0 16px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.6; }
      h1,h2,h3 { color: #222; }
      a { color: #6c4ef7; text-decoration: none; } a:hover { text-decoration: underline; }
      .meta { color: #666; font-size: 14px; margin-bottom: 16px; }
      pre, code { background: #f5f5f5; }
      pre { padding: 10px; border-radius: 6px; }
      code { padding: 2px 4px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>${d.title}</h1>
    <p class="meta">Versiune: v${d.version}${d.valid_from ? ` • valabil din ${d.valid_from}` : ""}</p>
    ${d.html}
  </body>
</html>`);
  } catch (e) {
    console.error("getLegalHtml error:", e);
    res.status(404).send("Document inexistent.");
  }
});

/* (opțional) Friendly URLs servite via API */
function sendHtml(res, d) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html><head><meta charset="utf-8" />
<title>${d.title}</title>
<style>
  body{max-width:800px;margin:40px auto;padding:0 16px;font-family:system-ui}
  .meta{color:#666;font-size:14px}
  a{color:#6c4ef7}
</style></head>
<body>
  <p class="meta">Versiune: v${d.version}${d.valid_from ? ` • valabil din ${d.valid_from}` : ""}</p>
  ${d.html}
</body></html>`);
}
router.get("/legal/vendor/terms", (_req, res) =>
  sendHtml(res, loadLegalDoc("vendor_terms"))
);
router.get("/legal/vendor/expediere", (_req, res) =>
  sendHtml(res, loadLegalDoc("shipping_addendum"))
);
router.get("/retur", (_req, res) =>
  sendHtml(res, loadLegalDoc("returns"))
);

export default router;
