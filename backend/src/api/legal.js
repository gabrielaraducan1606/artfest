import {
  defaultPublicUrlForType,
  findUpcomingLegalDoc,
  legalVersionVisibility,
  loadLegalDoc,
  resolveManifestVersionParam,
} from "../lib/legal.js";
import { prisma } from "../db.js";
import { loadPublishedLegalDoc } from "../services/legalPublishedService.js";

/*
 * Rezumat public al versiunii VIITOARE (status "upcoming" în manifest,
 * fără date lipsă) - doar pentru consultare/preaviz. NU e versiunea
 * acceptată de conturi și NU creează cerințe de reacceptare.
 */
export function upcomingSummary(doc) {
  if (!doc) return null;

  return {
    version: String(doc.policyVersion),
    title: doc.title,
    htmlUrl: doc.versionHtmlUrl,
    // null până când operatorul stabilește datele - fără placeholder-e
    effectiveAt: doc.effectiveAt || null,
    noticeAt: doc.noticeAt || null,
    changeSummary: doc.changeSummary || null,
  };
}

/**
 * GET /api/legal?types=tos,privacy,...
 */
export async function getLegalMeta(req, res) {
  try {
    const q = String(req.query.types || "");
    const types = q
      ? q
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : ["tos", "privacy"];

    // versiunea PUBLICATĂ (rândul activ din DB) are prioritate față de manifest
    const docs = await Promise.all(types.map((type) => loadPublishedLegalDoc(type)));

    const out = docs.map((d) => ({
      type: d.type,
      title: d.title,
      version: d.semver || d.version,
      checksum: d.checksum,
      url: defaultPublicUrlForType(d.type),
      htmlUrl: `/legal/${d.type}.html`,
      // aditiv: versiunea viitoare publică (sau null) - informativ
      upcoming: upcomingSummary(findUpcomingLegalDoc(d.type, d.manifestVersion)),
    }));

    res.json(out);
  } catch (e) {
    console.error("getLegalMeta error:", e);
    res.status(500).json({ error: "legal_meta_failed" });
  }
}

function formatLegalDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Bucharest",
  });
}

/*
 * Marcajul de status al paginii. Culorile folosesc variabilele globale ale
 * aplicației (pagina e inserată și în SPA - LegalHtmlRoute); fallback-urile
 * contează doar pentru pagina HTML deschisă direct.
 */
function statusNoticeHtml({ status, doc, current, upcoming }) {
  if (status === "UPCOMING") {
    const effective = formatLegalDate(doc.effectiveAt);
    return `
    <div class="legal-notice legal-notice--upcoming" role="note">
      <strong>Versiune viitoare</strong>
      <p>Această versiune nu este încă în vigoare.${
        effective ? ` Intră în vigoare la ${escapeHtml(effective)}.` : ""
      }</p>
      ${doc.changeSummary ? `<p>${escapeHtml(doc.changeSummary)}</p>` : ""}
      <p><a href="/legal/${escapeHtml(doc.type)}.html">Vezi versiunea în vigoare (v${escapeHtml(
        String(current.policyVersion)
      )})</a></p>
    </div>`;
  }

  if (status === "ARCHIVED") {
    return `
    <div class="legal-notice" role="note">
      <strong>Versiune arhivată</strong>
      <p>Această versiune nu mai este în vigoare.
        <a href="/legal/${escapeHtml(doc.type)}.html">Vezi versiunea în vigoare</a></p>
    </div>`;
  }

  if (status === "CURRENT" && upcoming) {
    const effective = formatLegalDate(upcoming.effectiveAt);
    return `
    <div class="legal-notice" role="note">
      <p>O versiune actualizată a acestui document este disponibilă pentru consultare.</p>
      <p>Versiunea: <strong>${escapeHtml(String(upcoming.policyVersion))}</strong> ·
        Status: <strong>${effective ? `Intră în vigoare la ${escapeHtml(effective)}` : "Nu este încă în vigoare"}</strong></p>
      <p><a class="legal-notice__cta" href="${escapeHtml(upcoming.versionHtmlUrl)}">Vezi versiunea viitoare</a></p>
    </div>`;
  }

  return "";
}

/**
 * GET /legal/:type.html                  -> versiunea ÎN VIGOARE
 * GET /legal/:type/v/:version.html       -> versiune anume ("2" sau "2.0.0"),
 *   publică doar dacă e CURRENT / ARCHIVED / UPCOMING (draft-uri -> 404)
 */
export async function getLegalHtml(req, res) {
  try {
    const type = req.params.type;

    // versiunea în vigoare (rândul activ din DB, rezervă manifestul)
    const current = await loadPublishedLegalDoc(type);

    let d = current;
    let status = "CURRENT";

    if (req.params.version !== undefined) {
      const manifestVersion = resolveManifestVersionParam(type, req.params.version);

      if (manifestVersion == null) {
        return res.status(404).send("Document inexistent.");
      }

      d = loadLegalDoc(type, { version: manifestVersion });
      const visibility = legalVersionVisibility(d, current.manifestVersion);

      if (!visibility.isPublic) {
        return res.status(404).send("Document inexistent.");
      }

      status = visibility.status;
    }

    const upcoming =
      status === "CURRENT" ? findUpcomingLegalDoc(type, current.manifestVersion) : null;

    const shownVersion = d.semver || d.version;
    const statusLabel =
      status === "CURRENT"
        ? "În vigoare"
        : status === "UPCOMING"
          ? `Versiune viitoare — nu este încă în vigoare${
              formatLegalDate(d.effectiveAt)
                ? ` • intră în vigoare la ${formatLegalDate(d.effectiveAt)}`
                : ""
            }`
          : "Arhivată";

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (status !== "CURRENT") {
      // versiunile viitoare / arhivate nu sunt canonice
      res.setHeader("X-Robots-Tag", "noindex");
    }
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
      .legal-notice {
        margin: 0 0 20px;
        padding: 12px 16px;
        border: 1px solid var(--color-border, #d9dde3);
        border-left: 4px solid var(--color-primary, #6b7280);
        border-radius: var(--radius, 8px);
        background: var(--surface-muted, #f6f7f9);
        color: var(--color-text, #222);
        font-size: 15px;
      }
      .legal-notice p { margin: 4px 0; }
      .legal-notice--upcoming { border-left-color: var(--color-warning, #b7791f); }
      .legal-notice__cta { font-weight: 600; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(d.title)}</h1>
    <p class="meta">
      Versiune: v${escapeHtml(String(shownVersion))} • ${escapeHtml(statusLabel)}${
        status === "CURRENT" && d.valid_from ? ` • valabil din ${escapeHtml(String(d.valid_from))}` : ""
      }
    </p>
    ${statusNoticeHtml({ status, doc: d, current, upcoming })}
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
              userId,
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
            console.error("[postVendorAccept] upsert message:", e?.message);
            console.error("[postVendorAccept] upsert code:", e?.code);
            console.error("[postVendorAccept] upsert meta:", e?.meta);
            console.error("[postVendorAccept] upsert stack:", e?.stack);
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
    console.error("[postVendorAccept] fatal message:", e?.message);
    console.error("[postVendorAccept] fatal code:", e?.code);
    console.error("[postVendorAccept] fatal meta:", e?.meta);
    console.error("[postVendorAccept] fatal stack:", e?.stack);

    return res.status(500).json({
      error: "vendor_accept_failed",
      message: e?.message || "Nu am putut salva acceptările.",
      code: e?.code || null,
      meta: e?.meta || null,
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