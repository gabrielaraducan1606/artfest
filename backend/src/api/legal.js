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
      version: d.semver || d.version,
      checksum: d.checksum,
      url: defaultPublicUrlForType(d.type),
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
    const shownVersion = d.semver || d.version;

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
      Versiune: v${escapeHtml(String(shownVersion))}${
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
 * frontend type -> Prisma VendorDoc
 */
const TYPE_TO_VENDOR_DOC = {
  vendor_terms: "VENDOR_TERMS",
  shipping_addendum: "SHIPPING_ADDENDUM",
  returns: "RETURNS_POLICY_ACK",
  returns_policy_ack: "RETURNS_POLICY_ACK",
  products_addendum: "PRODUCTS_ADDENDUM",
};

/**
 * frontend type -> legal loader type
 */
const TYPE_TO_LEGAL_TYPE = {
  vendor_terms: "vendor_terms",
  shipping_addendum: "shipping_addendum",
  returns: "returns_policy_ack",
  returns_policy_ack: "returns_policy_ack",
  products_addendum: "products_addendum",
};

function getRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || null;
}

export async function postVendorAccept(req, res) {
  try {
    console.log("[postVendorAccept] HIT");
    console.log("[postVendorAccept] body:", JSON.stringify(req.body, null, 2));
    console.log("[postVendorAccept] user:", req.user);

    const userId = req.user?.sub;
    if (!userId) {
      console.log("[postVendorAccept] unauthorized");
      return res.status(401).json({ error: "unauthorized" });
    }

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
    });

    console.log("[postVendorAccept] vendor:", vendor);

    if (!vendor) {
      console.log("[postVendorAccept] vendor_profile_missing");
      return res.status(404).json({
        error: "vendor_profile_missing",
        message: "Nu există un profil de vendor pentru acest utilizator.",
      });
    }

    const items = Array.isArray(req.body?.accept) ? req.body.accept : [];
    console.log("[postVendorAccept] items:", items);

    if (!items.length) {
      console.log("[postVendorAccept] invalid_input: empty accept");
      return res.status(400).json({
        error: "invalid_input",
        message: "Trimite accept: [{ type }] în body.",
      });
    }

    const now = new Date();
    const ip = getRequestIp(req);
    const ua = req.headers["user-agent"] || null;
    const results = [];

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const rawType = String(item?.type || "").trim().toLowerCase();

        console.log("[postVendorAccept] rawType:", rawType);

        const docEnum = TYPE_TO_VENDOR_DOC[rawType];
        const legalType = TYPE_TO_LEGAL_TYPE[rawType];

        console.log("[postVendorAccept] mapped:", {
          rawType,
          docEnum,
          legalType,
        });

        if (!docEnum || !legalType) {
          results.push({
            type: rawType,
            ok: false,
            code: "unknown_type",
          });
          continue;
        }

        let doc;
        try {
          doc = loadLegalDoc(legalType);
          console.log("[postVendorAccept] loaded doc:", {
            legalType,
            version: doc?.semver || doc?.version,
            checksum: doc?.checksum || null,
          });
        } catch (e) {
          console.error("[postVendorAccept] loadLegalDoc failed for", legalType, e);
          results.push({
            type: rawType,
            ok: false,
            code: "doc_not_found",
          });
          continue;
        }

        const activePolicy = await tx.vendorPolicy.findFirst({
          where: {
            document: docEnum,
            isActive: true,
          },
          orderBy: [{ publishedAt: "desc" }],
        });

        console.log("[postVendorAccept] activePolicy:", activePolicy);

        if (!activePolicy) {
          results.push({
            type: rawType,
            ok: false,
            code: "no_active_policy",
            document: docEnum,
          });
          continue;
        }

        const policyVersion = String(activePolicy.version);

        try {
          const acceptance = await tx.vendorAcceptance.upsert({
            where: {
              vendorId_document_version: {
                vendorId: vendor.id,
                document: docEnum,
                version: policyVersion,
              },
            },
            create: {
              vendorId: vendor.id,
              userId,
              document: docEnum,
              version: policyVersion,
              checksum: activePolicy.checksum || doc.checksum || null,
              acceptedAt: now,
              ip,
              ua,
              source: "vendor_onboarding",
            },
            update: {
              acceptedAt: now,
              checksum: activePolicy.checksum || doc.checksum || null,
              ip,
              ua,
              source: "vendor_onboarding",
            },
          });

          console.log("[postVendorAccept] ACCEPT SAVED", {
            vendorId: vendor.id,
            document: docEnum,
            version: policyVersion,
            acceptanceId: acceptance.id,
          });

          results.push({
            type: rawType,
            ok: true,
            document: docEnum,
            version: policyVersion,
            acceptanceId: acceptance.id,
          });
        } catch (e) {
          if (e?.code === "P2002") {
            results.push({
              type: rawType,
              ok: true,
              code: "already_accepted",
              document: docEnum,
              version: policyVersion,
            });
          } else {
            console.error("[postVendorAccept] vendorAcceptance.upsert error:", e);
            throw e;
          }
        }
      }
    });

    console.log("[postVendorAccept] results:", results);

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
      console.log("[postVendorAccept] returning 400:", failed[0]);
      return res.status(400).json({
        ok: false,
        error: "vendor_accept_partial_failed",
        message: failed[0]?.code || "Nu am putut salva acceptările.",
        results,
      });
    }

    return res.json({
      ok: true,
      vendorId: vendor.id,
      results,
    });
  } catch (e) {
    console.error("[postVendorAccept] fatal error:", e);
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