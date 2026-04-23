import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";

const router = Router();

const ONBOARDING_VENDOR_DOCS = [
  "VENDOR_TERMS",
  "RETURNS_POLICY_ACK",
];

const typeToVendorDoc = {
  vendor_terms: "VENDOR_TERMS",
  returns: "RETURNS_POLICY_ACK",
  returns_policy_ack: "RETURNS_POLICY_ACK",
};

function getRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || null;
}

async function getMeVendorId(req) {
  const meVendor =
    req.meVendor ??
    (await prisma.vendor.findUnique({
      where: { userId: req.user.sub },
      select: { id: true },
    }));

  return meVendor?.id || null;
}

async function getLatestPolicies(documents = ONBOARDING_VENDOR_DOCS) {
  const allPolicies = await prisma.vendorPolicy.findMany({
    orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
  });

  console.log("[getLatestPolicies] requested documents:", documents);
  console.log("[getLatestPolicies] all policies in DB:", allPolicies);

  const all = await prisma.vendorPolicy.findMany({
    where: {
      isActive: true,
      document: { in: documents },
    },
    orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
  });

  console.log("[getLatestPolicies] matched active policies:", all);

  const latest = new Map();
  for (const p of all) {
    if (!latest.has(p.document)) latest.set(p.document, p);
  }

  console.log(
    "[getLatestPolicies] latest keys:",
    Array.from(latest.keys())
  );

  return latest;
}

/**
 * GET /api/vendor/agreements/required
 */
router.get(
  "/vendor/agreements/required",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      console.log("[agreements.required] hit");

      const latest = await getLatestPolicies();

      const docs = Array.from(latest.values()).map((d) => ({
        doc_key: d.document,
        title: d.title,
        url: d.url,
        version: d.version,
        checksum: d.checksum || null,
        is_required: d.isRequired,
      }));

      console.log("[agreements.required] docs:", docs);

      return res.json({ docs });
    } catch (e) {
      console.error("GET /vendor/agreements/required error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

/**
 * POST /api/vendor/agreements/accept
 * Body:
 * { items: [ { doc_key: "VENDOR_TERMS", version: "1.0.0" }, ... ] }
 */
router.post(
  "/vendor/agreements/accept",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      console.log("[agreements.accept] hit");
      console.log("[agreements.accept] body:", req.body);

      const vendorId = await getMeVendorId(req);

      if (!vendorId) {
        return res.status(403).json({ error: "forbidden" });
      }

      const items = Array.isArray(req.body?.items)
        ? req.body.items.slice(0, 10)
        : [];

      console.log("[agreements.accept] vendorId:", vendorId);
      console.log("[agreements.accept] items:", items);

      if (!items.length) {
        return res.status(400).json({ error: "no_items" });
      }

      const normalizedItems = items
        .map((i) => ({
          document: String(i?.doc_key || "").trim(),
          version: String(i?.version || "").trim(),
        }))
        .filter(
          (i) =>
            i.document &&
            i.version &&
            ONBOARDING_VENDOR_DOCS.includes(i.document)
        );

      console.log("[agreements.accept] normalizedItems:", normalizedItems);

      if (!normalizedItems.length) {
        return res.status(400).json({ error: "invalid_versions" });
      }

      const policies = await prisma.vendorPolicy.findMany({
        where: {
          OR: normalizedItems.map((i) => ({
            document: i.document,
            version: i.version,
            isActive: true,
          })),
        },
      });

      console.log("[agreements.accept] matched policies:", policies);

      const valid = new Map(
        policies.map((p) => [`${p.document}::${p.version}`, p])
      );

      const toInsert = normalizedItems.filter((i) =>
        valid.has(`${i.document}::${i.version}`)
      );

      console.log("[agreements.accept] toInsert:", toInsert);

      if (!toInsert.length) {
        return res.status(400).json({ error: "invalid_versions" });
      }

      const now = new Date();
      const ip = getRequestIp(req);
      const ua = req.headers["user-agent"] || null;

      for (const it of toInsert) {
        const matchedPolicy = valid.get(`${it.document}::${it.version}`);

        await prisma.vendorAcceptance.upsert({
          where: {
            vendorId_document_version: {
              vendorId,
              document: it.document,
              version: it.version,
            },
          },
          create: {
            vendorId,
            userId: req.user.sub,
            document: it.document,
            version: it.version,
            acceptedAt: now,
            checksum: matchedPolicy?.checksum || null,
            ip,
            ua,
            source: "vendor_onboarding",
          },
          update: {
            userId: req.user.sub,
            acceptedAt: now,
            checksum: matchedPolicy?.checksum || null,
            ip,
            ua,
            source: "vendor_onboarding",
          },
        });

        console.log("[agreements.accept] ACCEPT SAVED", {
          vendorId,
          document: it.document,
          version: it.version,
        });
      }

      return res.json({ ok: true, inserted: toInsert });
    } catch (e) {
      console.error("POST /vendor/agreements/accept error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

/**
 * GET /api/vendor/agreements/status
 */
router.get(
  "/vendor/agreements/status",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      console.log("[agreements.status] hit");

      const vendorId = await getMeVendorId(req);

      if (!vendorId) {
        return res.status(403).json({ error: "forbidden" });
      }

      const latest = await getLatestPolicies();

      const accepts = await prisma.vendorAcceptance.findMany({
        where: {
          vendorId,
          document: { in: ONBOARDING_VENDOR_DOCS },
        },
        select: {
          document: true,
          version: true,
          acceptedAt: true,
        },
        orderBy: { acceptedAt: "desc" },
      });

      const acceptedSet = new Set(
        accepts.map((a) => `${a.document}::${a.version}`)
      );

      const docs = [];
      for (const [, p] of latest) {
        const key = p.document;
        const isAccepted = acceptedSet.has(`${key}::${p.version}`);

        docs.push({
          doc_key: key,
          title: p.title,
          url: p.url,
          version: p.version,
          checksum: p.checksum || null,
          is_required: p.isRequired,
          accepted: isAccepted,
        });
      }

      const requiredDocs = docs.filter((d) => d.is_required);
      const allOK =
        docs.length > 0 &&
        requiredDocs.length > 0 &&
        requiredDocs.every((d) => d.accepted === true);

      console.log("[agreements.status] accepts:", accepts);
      console.log("[agreements.status] acceptedSet:", Array.from(acceptedSet));
      console.log("[agreements.status] docs:", docs);
      console.log("[agreements.status] allOK:", allOK);

      return res.json({ docs, allOK });
    } catch (e) {
      console.error("GET /vendor/agreements/status error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

/* ------------------------------------------------------------------ */
/* adaptor pentru checkbox-urile legacy din frontend                  */
/* ------------------------------------------------------------------ */

/**
 * POST /api/legal/vendor-accept
 * Body:
 * {
 *   accept: [
 *     { type: "vendor_terms" },
 *     { type: "returns" }
 *   ]
 * }
 */
router.post(
  "/legal/vendor-accept",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      console.log("[legal.vendor-accept] hit");
      console.log("[legal.vendor-accept] body:", req.body);

      const vendorId = await getMeVendorId(req);

      if (!vendorId) {
        return res.status(403).json({ error: "forbidden" });
      }

      const accept = Array.isArray(req.body?.accept) ? req.body.accept : [];

      console.log("[legal.vendor-accept] vendorId:", vendorId);
      console.log("[legal.vendor-accept] accept:", accept);

      const docsRequested = Array.from(
        new Set(
          accept
            .map((a) =>
              typeToVendorDoc[String(a?.type || "").trim().toLowerCase()]
            )
            .filter(Boolean)
        )
      );

      console.log("[legal.vendor-accept] docsRequested:", docsRequested);

      if (!docsRequested.length) {
        return res.status(400).json({
          error: "invalid_types",
          message: "Niciun tip de document valid.",
        });
      }

      const latestByDoc = await getLatestPolicies(docsRequested);

      console.log(
        "[legal.vendor-accept] latestByDoc keys:",
        Array.from(latestByDoc.keys())
      );

      const now = new Date();
      const ip = getRequestIp(req);
      const ua = req.headers["user-agent"] || null;
      const results = [];

      for (const docKey of docsRequested) {
        const p = latestByDoc.get(docKey);

        console.log(
          "[legal.vendor-accept] checking docKey:",
          docKey,
          "policy:",
          p
        );

        if (!p) {
          results.push({
            doc_key: docKey,
            ok: false,
            code: "no_active_policy",
            message: `Nu există o versiune activă pentru documentul ${docKey}.`,
          });
          continue;
        }

        await prisma.vendorAcceptance.upsert({
          where: {
            vendorId_document_version: {
              vendorId,
              document: docKey,
              version: String(p.version),
            },
          },
          create: {
            vendorId,
            userId: req.user.sub,
            document: docKey,
            version: String(p.version),
            checksum: p.checksum || null,
            acceptedAt: now,
            ip,
            ua,
            source: "vendor_onboarding",
          },
          update: {
            userId: req.user.sub,
            acceptedAt: now,
            checksum: p.checksum || null,
            ip,
            ua,
            source: "vendor_onboarding",
          },
        });

        console.log("[legal.vendor-accept] ACCEPT SAVED", {
          vendorId,
          docKey,
          version: String(p.version),
        });

        results.push({
          doc_key: docKey,
          ok: true,
          version: String(p.version),
        });
      }

      const failed = results.filter((r) => !r.ok);

      if (failed.length > 0) {
        return res.status(400).json({
          ok: false,
          error: "accept_failed",
          message: failed[0]?.message || "Nu am putut salva acceptarea.",
          results,
        });
      }

      return res.json({ ok: true, results });
    } catch (e) {
      console.error("POST /api/legal/vendor-accept error:");
      console.error("message:", e?.message);
      console.error("code:", e?.code);
      console.error("meta:", e?.meta);
      console.error("stack:", e?.stack);

      return res.status(500).json({
        error: "server_error",
        message: e?.message || "Unknown server error",
        code: e?.code || null,
        meta: e?.meta || null,
      });
    }
  }
);

// GET /api/vendor/product-declaration/status
router.get(
  "/vendor/product-declaration/status",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const vendorId = await getMeVendorId(req);

      if (!vendorId) {
        return res.status(403).json({ error: "forbidden" });
      }

      const decl = await prisma.vendorProductDeclaration.findUnique({
        where: { vendorId },
      });

      if (!decl) {
        return res.json({
          accepted: false,
          version: null,
        });
      }

      return res.json({
        accepted: true,
        version: decl.version,
        acceptedAt: decl.acceptedAt,
      });
    } catch (e) {
      console.error("GET /vendor/product-declaration/status error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

// POST /api/vendor/product-declaration/accept
router.post(
  "/vendor/product-declaration/accept",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const vendorId = await getMeVendorId(req);

      if (!vendorId) {
        return res.status(403).json({ error: "forbidden" });
      }

      const body = req.body || {};
      const version = body.version ? String(body.version) : "1.0.0";
      const textSnapshot =
        typeof body.textSnapshot === "string" ? body.textSnapshot : null;

      const existing = await prisma.vendorProductDeclaration.findUnique({
        where: { vendorId },
      });

      if (existing) {
        return res.json({
          ok: true,
          alreadyAccepted: true,
          version: existing.version,
          acceptedAt: existing.acceptedAt,
        });
      }

      const created = await prisma.vendorProductDeclaration.create({
        data: {
          vendorId,
          version,
          text: textSnapshot,
          ip: getRequestIp(req),
          ua: req.headers["user-agent"] || null,
        },
      });

      return res.json({
        ok: true,
        version: created.version,
        acceptedAt: created.acceptedAt,
      });
    } catch (e) {
      console.error("POST /vendor/product-declaration/accept error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

export default router;