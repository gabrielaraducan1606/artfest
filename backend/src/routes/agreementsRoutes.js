import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";

const router = Router();

/**
 * GET /api/vendor/agreements/required
 */
router.get(
  "/vendor/agreements/required",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const all = await prisma.vendorPolicy.findMany({
        where: { isActive: true },
        orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
      });

      const latest = new Map();
      for (const p of all) {
        if (!latest.has(p.document)) latest.set(p.document, p);
      }

      const docs = Array.from(latest.values()).map((d) => ({
        doc_key: d.document,
        title: d.title,
        url: d.url,
        version: d.version,
        is_required: d.isRequired,
      }));

      res.json({ docs });
    } catch (e) {
      console.error("GET /vendor/agreements/required error:", e);
      res.status(500).json({ error: "server_error" });
    }
  }
);

/**
 * POST /api/vendor/agreements/accept
 * Body:
 *  { items: [ { doc_key: "VENDOR_TERMS", version: "1.0.0" }, ... ] }
 */
router.post(
  "/vendor/agreements/accept",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
          select: { id: true },
        }));

      if (!meVendor) {
        return res.status(403).json({ error: "forbidden" });
      }

      const items = Array.isArray(req.body?.items)
        ? req.body.items.slice(0, 10)
        : [];

      if (!items.length) {
        return res.status(400).json({ error: "no_items" });
      }

      const policies = await prisma.vendorPolicy.findMany({
        where: {
          OR: items.map((i) => ({
            document: i.doc_key,
            version: String(i.version),
          })),
        },
      });

      const valid = new Set(policies.map((p) => `${p.document}::${p.version}`));

      const toInsert = items
        .map((i) => ({
          document: i.doc_key,
          version: String(i.version),
        }))
        .filter((i) => valid.has(`${i.document}::${i.version}`));

      if (!toInsert.length) {
        return res.status(400).json({ error: "invalid_versions" });
      }

      const now = new Date();

      for (const it of toInsert) {
        const matchedPolicy = policies.find(
          (p) => p.document === it.document && p.version === it.version
        );

        await prisma.vendorAcceptance.upsert({
          where: {
            vendorId_document_version: {
              vendorId: meVendor.id,
              document: it.document,
              version: it.version,
            },
          },
          create: {
            vendor: {
              connect: { id: meVendor.id },
            },
            user: {
              connect: { id: req.user.sub },
            },
            document: it.document,
            version: it.version,
            acceptedAt: now,
            checksum: matchedPolicy?.checksum || null,
            ip: req.ip || null,
            ua: req.headers["user-agent"] || null,
          },
          update: {
            checksum: matchedPolicy?.checksum || null,
            ip: req.ip || null,
            ua: req.headers["user-agent"] || null,
          },
        });
      }

      res.json({ ok: true });
    } catch (e) {
      console.error("POST /vendor/agreements/accept error:", e);
      res.status(500).json({ error: "server_error" });
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
      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
          select: { id: true },
        }));

      if (!meVendor) {
        return res.status(403).json({ error: "forbidden" });
      }

      const active = await prisma.vendorPolicy.findMany({
        where: { isActive: true },
        orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
      });

      const latest = new Map();
      for (const p of active) {
        if (!latest.has(p.document)) latest.set(p.document, p);
      }

      const accepts = await prisma.vendorAcceptance.findMany({
        where: { vendorId: meVendor.id },
        select: { document: true, version: true, acceptedAt: true },
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
          is_required: p.isRequired,
          accepted: isAccepted,
        });
      }

      const requiredDocs = docs.filter((d) => d.is_required);
      const allOK =
        requiredDocs.length > 0 &&
        requiredDocs.every((d) => d.accepted === true);

      res.json({ docs, allOK });
    } catch (e) {
      console.error("GET /vendor/agreements/status error:", e);
      res.status(500).json({ error: "server_error" });
    }
  }
);

/* ------------------------------------------------------------------ */
/* adaptor pentru checkbox-urile legacy din frontend                   */
/* ------------------------------------------------------------------ */

const typeToVendorDoc = {
  vendor_terms: "VENDOR_TERMS",
  shipping_addendum: "SHIPPING_ADDENDUM",
  returns: "RETURNS_POLICY_ACK",
  returns_policy_ack: "RETURNS_POLICY_ACK",
  products_addendum: "PRODUCTS_ADDENDUM",
};

/**
 * POST /api/legal/vendor-accept
 * Body:
 * {
 *   accept: [
 *     { type: "vendor_terms" },
 *     { type: "shipping_addendum" },
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
      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
          select: { id: true },
        }));

      if (!meVendor) {
        return res.status(403).json({ error: "forbidden" });
      }

      const accept = Array.isArray(req.body?.accept) ? req.body.accept : [];

      const docsRequested = Array.from(
        new Set(
          accept
            .map((a) =>
              typeToVendorDoc[String(a?.type || "").trim().toLowerCase()]
            )
            .filter(Boolean)
        )
      );

      if (!docsRequested.length) {
        return res.status(400).json({
          error: "invalid_types",
          message: "Niciun tip de document valid.",
        });
      }

      const policies = await prisma.vendorPolicy.findMany({
        where: {
          isActive: true,
          document: { in: docsRequested },
        },
        orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
      });

      const latestByDoc = new Map();
      for (const p of policies) {
        if (!latestByDoc.has(p.document)) latestByDoc.set(p.document, p);
      }

      const now = new Date();
      const results = [];

      for (const docKey of docsRequested) {
        const p = latestByDoc.get(docKey);

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
              vendorId: meVendor.id,
              document: docKey,
              version: String(p.version),
            },
          },
          create: {
            vendor: {
              connect: { id: meVendor.id },
            },
            user: {
              connect: { id: req.user.sub },
            },
            document: docKey,
            version: String(p.version),
            checksum: p.checksum || null,
            acceptedAt: now,
            ip: req.ip || null,
            ua: req.headers["user-agent"] || null,
          },
          update: {
            acceptedAt: now,
            checksum: p.checksum || null,
            ip: req.ip || null,
            ua: req.headers["user-agent"] || null,
          },
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
    }  catch (e) {
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
      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
          select: { id: true },
        }));

      if (!meVendor) {
        return res.status(403).json({ error: "forbidden" });
      }

      const decl = await prisma.vendorProductDeclaration.findUnique({
        where: { vendorId: meVendor.id },
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
      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
          select: { id: true },
        }));

      if (!meVendor) {
        return res.status(403).json({ error: "forbidden" });
      }

      const body = req.body || {};
      const version = body.version ? String(body.version) : "1.0.0";
      const textSnapshot =
        typeof body.textSnapshot === "string" ? body.textSnapshot : null;

      const existing = await prisma.vendorProductDeclaration.findUnique({
        where: { vendorId: meVendor.id },
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
          vendorId: meVendor.id,
          version,
          text: textSnapshot,
          ip: req.ip || null,
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