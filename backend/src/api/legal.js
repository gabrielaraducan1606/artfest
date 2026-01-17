// backend/src/api/legal.js
import { loadLegalDoc, loadMany, defaultPublicUrlForType } from "../lib/legal.js";
import { prisma } from "../db.js";

/**
 * GET /api/legal?types=tos,privacy,...
 */
export function getLegalMeta(req, res) {
  try {
    const q = String(req.query.types || "");
    const types = q
      ? q
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : ["tos", "privacy"];

    const out = loadMany(types).map((d) => ({
      type: d.type,
      title: d.title,
      version: d.version,
      checksum: d.checksum,
      url: defaultPublicUrlForType(d.type),
      // bonus: link direct către html latest (util pt iframe)
      htmlUrl: `/legal/${d.type}.html`,
    }));

    res.json(out);
  } catch (e) {
    console.error("getLegalMeta error:", e);
    res.status(500).json({ error: "legal_meta_failed" });
  }
}

/**
 * GET /legal/:type.html (latest)
 * GET /legal/:type/v/:version.html (specific)
 */
export function getLegalHtml(req, res) {
  try {
    const type = req.params.type;
    const version = req.params.version ? Number(req.params.version) : undefined;

    const d = loadLegalDoc(type, { version });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(d.title)}</title>
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
    <h1>${escapeHtml(d.title)}</h1>
    <p class="meta">
      Versiune: v${escapeHtml(String(d.version))}${
        d.valid_from ? ` • valabil din ${escapeHtml(String(d.valid_from))}` : ""
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

/**
 * Mapare tip din frontend -> enum VendorDoc din Prisma
 *
 * IMPORTANT:
 * - frontend trimite uneori "returns" (legacy)
 * - în DB trebuie salvat ca RETURNS_POLICY_ACK
 */
const TYPE_TO_VENDOR_DOC = {
  vendor_terms: "VENDOR_TERMS",
  shipping_addendum: "SHIPPING_ADDENDUM",

  // ✅ legacy + nou
  returns: "RETURNS_POLICY_ACK",
  returns_policy_ack: "RETURNS_POLICY_ACK",

  products_addendum: "PRODUCTS_ADDENDUM",
};

/**
 * Mapare tip frontend -> tipul real din loader-ul de legal docs
 *
 * loadLegalDoc() caută fișierele după "type" (ex: returns_policy_ack),
 * deci când primim "returns" trebuie să încărcăm returns_policy_ack.
 */
const TYPE_TO_LEGAL_TYPE = {
  vendor_terms: "vendor_terms",
  shipping_addendum: "shipping_addendum",

  // ✅ legacy -> doc real
  returns: "returns_policy_ack",
  returns_policy_ack: "returns_policy_ack",

  products_addendum: "products_addendum",
};

export async function postVendorAccept(req, res) {
  try {
    const userId = req.user?.sub;
    if (!userId) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
    });

    if (!vendor) {
      return res.status(404).json({
        error: "vendor_profile_missing",
        message: "Nu există un profil de vendor pentru acest utilizator.",
      });
    }

    const items = Array.isArray(req.body?.accept) ? req.body.accept : [];
    if (!items.length) {
      return res.status(400).json({
        error: "invalid_input",
        message: "Trimite accept: [{ type }] în body.",
      });
    }

    const now = new Date();
    const results = [];

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        // ✅ normalizare ca să evităm "Returns" / " RETURNS " etc.
        const rawType = String(item?.type || "").trim().toLowerCase();

        const docEnum = TYPE_TO_VENDOR_DOC[rawType];
        const legalType = TYPE_TO_LEGAL_TYPE[rawType];

        if (!docEnum || !legalType) {
          results.push({ type: rawType, ok: false, code: "unknown_type" });
          continue;
        }

        // ✅ încărcăm documentul corect din sistemul legal
        let doc;
        try {
          doc = loadLegalDoc(legalType); // latest
        } catch (e) {
          console.error("loadLegalDoc failed for", legalType, e);
          results.push({ type: rawType, ok: false, code: "doc_not_found" });
          continue;
        }

        try {
          const acceptance = await tx.vendorAcceptance.create({
            data: {
              vendorId: vendor.id,
              document: docEnum,
              version: String(doc.version),
              checksum: doc.checksum || null,
              acceptedAt: now,
            },
          });

          results.push({
            type: rawType,
            ok: true,
            document: docEnum,
            version: String(doc.version),
            acceptanceId: acceptance.id,
          });
        } catch (e) {
          // unique constraint -> deja acceptat
          if (e?.code === "P2002") {
            results.push({
              type: rawType,
              ok: true,
              code: "already_accepted",
              document: docEnum,
              version: String(doc.version),
            });
          } else {
            console.error("vendorAcceptance.create error:", e);
            throw e;
          }
        }
      }
    });

    return res.json({ ok: true, vendorId: vendor.id, results });
  } catch (e) {
    console.error("postVendorAccept error:", e);
    return res.status(500).json({
      error: "vendor_accept_failed",
      message: "Nu am putut salva acceptările.",
    });
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
