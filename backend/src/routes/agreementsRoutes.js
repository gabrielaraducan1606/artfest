import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";

const router = Router();

/**
 * GET /api/vendor/agreements/required
 * -> lista ultimelor versiuni active (isRequired=true)
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

      // reținem ultima versiune per document
      const latest = new Map();
      for (const p of all) if (!latest.has(p.document)) latest.set(p.document, p);

      const docs = Array.from(latest.values()).map((d) => ({
        doc_key: d.document, // "VENDOR_TERMS" | "SHIPPING_ADDENDUM" | "RETURNS_POLICY_ACK"
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
 * body: { items: [{ doc_key: VendorDoc, version: string }] }
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
      if (!meVendor) return res.status(403).json({ error: "forbidden" });

      const items = Array.isArray(req.body?.items)
        ? req.body.items.slice(0, 10)
        : [];
      if (!items.length) return res.status(400).json({ error: "no_items" });

      // validăm că versiunile există în VendorPolicy (anti-spoof)
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
        .map((i) => ({ document: i.doc_key, version: String(i.version) }))
        .filter((i) => valid.has(`${i.document}::${i.version}`));

      if (!toInsert.length) return res.status(400).json({ error: "invalid_versions" });

      // inserăm (istoric); dacă vrei “doar ultima”, poți șterge versiunile anterioare ale aceluiași doc
      for (const it of toInsert) {
        await prisma.vendorAcceptance.upsert({
          where: {
            vendorId_document_version: {
              vendorId: meVendor.id,
              document: it.document,
              version: it.version,
            },
          },
          create: {
            vendorId: meVendor.id,
            document: it.document,
            version: it.version,
            checksum:
              policies.find(
                (p) => p.document === it.document && p.version === it.version
              )?.checksum || null,
          },
          update: {}, // nimic (există deja)
        });
      }

      res.json({ ok: true });
    } catch (e) {
      console.error("POST /vendor/agreements/accept error:", e);
      res.status(500).json({ error: "server_error" });
    }
  }
);

// GET /api/vendor/agreements/status
// combină required + acceptances (ultima versiune activă per document + dacă e acceptată)
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
      if (!meVendor) return res.status(403).json({ error: "forbidden" });

      // 1) ultimele versiuni active din VendorPolicy
      const active = await prisma.vendorPolicy.findMany({
        where: { isActive: true },
        orderBy: [{ document: "asc" }, { publishedAt: "desc" }],
      });

      const latest = new Map();
      for (const p of active) if (!latest.has(p.document)) latest.set(p.document, p);

      // 2) acceptările vendorului (istoric)
      const accepts = await prisma.vendorAcceptance.findMany({
        where: { vendorId: meVendor.id },
        select: { document: true, version: true, acceptedAt: true },
        orderBy: { acceptedAt: "desc" },
      });
      const acceptedSet = new Set(accepts.map((a) => `${a.document}::${a.version}`));

      // 3) compune status per doc
      const docs = [];
      for (const [, p] of latest) {
        const key = p.document; // ex: "VENDOR_TERMS" | "SHIPPING_ADDENDUM" | "RETURNS_POLICY"
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

      const allOK = docs.filter((d) => d.is_required).every((d) => d.accepted === true);

      res.json({ docs, allOK });
    } catch (e) {
      console.error("GET /vendor/agreements/status error:", e);
      res.status(500).json({ error: "server_error" });
    }
  }
);

export default router;
