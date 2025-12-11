// backend/src/api/legal.js

// loadLegalDoc / loadMany știu să încarce din filesystem / config
// documentele legale (TOS, privacy, vendor terms etc.)
import { loadLegalDoc, loadMany } from "../lib/legal.js";
import { prisma } from "../db.js";

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
  url:
    d.type === "tos"
      ? "/termenii-si-conditiile"
      : d.type === "privacy"
      ? "/confidentialitate"
      : d.type === "vendor_terms"
      ? "/acord-vanzatori"
      : d.type === "shipping_addendum"
      ? "/anexa-expediere"         // ✅ slug frumos
      : d.type === "returns"
      ? "/politica-retur"          // ✅ slug frumos
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

/**
 * POST /api/legal/vendor-accept
 *
 * Body:
 * {
 *   accept: [
 *     { type: "vendor_terms" },
 *     { type: "shipping_addendum" },
 *     { type: "returns" }
 *   ]
 * }
 *
 * Scop:
 *  - Salvează în DB acceptările vendorului (VendorAcceptance),
 *    folosind versiunea + checksum din loadLegalDoc().
 */

// mapare tip din frontend -> enum VendorDoc din Prisma
const TYPE_TO_VENDOR_DOC = {
  vendor_terms: "VENDOR_TERMS",
  shipping_addendum: "SHIPPING_ADDENDUM",
  returns: "RETURNS_POLICY_ACK",
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
        const rawType = String(item?.type || "").trim();
        const docEnum = TYPE_TO_VENDOR_DOC[rawType];

        if (!docEnum) {
          results.push({
            type: rawType,
            ok: false,
            code: "unknown_type",
          });
          continue;
        }

        // luăm documentul din lib ca să avem versiunea + checksum
        let doc;
        try {
          doc = loadLegalDoc(rawType);
        } catch (e) {
          console.error("loadLegalDoc failed for", rawType, e);
          results.push({
            type: rawType,
            ok: false,
            code: "doc_not_found",
          });
          continue;
        }

        try {
          const acceptance = await tx.vendorAcceptance.create({
            data: {
              vendorId: vendor.id,
              document: docEnum, // VendorDoc enum
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
          // P2002 = unique constraint (vendorId, document, version)
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

    return res.json({
      ok: true,
      vendorId: vendor.id,
      results,
    });
  } catch (e) {
    console.error("postVendorAccept error:", e);
    return res.status(500).json({
      error: "vendor_accept_failed",
      message: "Nu am putut salva acceptările.",
    });
  }
}
