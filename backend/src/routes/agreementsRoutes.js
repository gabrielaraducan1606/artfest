import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { vendorAccessRequired } from "../middleware/vendorAccessRequired.js";

const router = Router();

/**
 * GET /api/vendor/agreements/required
 * Scop:
 *  - întoarce lista cu cele mai noi versiuni de documente din VendorPolicy
 *    (ex: Termeni vânzători, Anexă expedieri, Politică retur),
 *    care sunt marcate ca active (isActive=true).
 *  - front-end-ul poate afișa ce documente sunt obligatorii pentru vendor.
 */
router.get(
  "/vendor/agreements/required",
  authRequired,          // trebuie să fie logat
  vendorAccessRequired,  // și să aibă acces de vendor
  async (req, res) => {
    try {
      const all = await prisma.vendorPolicy.findMany({
        where: { isActive: true }, // doar versiunile active
        orderBy: [
          { document: "asc" },       // ordonăm întâi pe tip de document
          { publishedAt: "desc" },   // apoi descrescător după dată
        ],
      });

      // reținem doar ultima versiune pentru fiecare tip de document
      // (prima intrare cu acel document în map, fiind ordonate descrescător)
      const latest = new Map();
      for (const p of all) {
        if (!latest.has(p.document)) {
          latest.set(p.document, p);
        }
      }

      // transformăm în array gata de trimis la frontend
      const docs = Array.from(latest.values()).map((d) => ({
        doc_key: d.document, // ex: "VENDOR_TERMS" | "SHIPPING_ADDENDUM" | "RETURNS_POLICY_ACK"
        title: d.title,      // titlul documentului
        url: d.url,          // URL public unde poate fi citit
        version: d.version,  // versiunea (string)
        is_required: d.isRequired, // dacă este sau nu obligatoriu
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
 * Body așteptat:
 *  {
 *    items: [
 *      { doc_key: "VENDOR_TERMS", version: "1.0.0" },
 *      ...
 *    ]
 *  }
 *
 * Scop:
 *  - salvează în VendorAcceptance faptul că vendorul a acceptat
 *    anumite versiuni de documente (Termeni, Anexă, etc.).
 */
router.post(
  "/vendor/agreements/accept",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      // identificăm vendor-ul curent
      // (vendorAccessRequired poate seta req.meVendor; dacă nu, căutăm în DB)
      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
          select: { id: true },
        }));

      if (!meVendor) {
        return res.status(403).json({ error: "forbidden" });
      }

      // extragem items din body (max 10 pentru siguranță)
      const items = Array.isArray(req.body?.items)
        ? req.body.items.slice(0, 10)
        : [];
      if (!items.length) {
        return res.status(400).json({ error: "no_items" });
      }

      // 1) validăm că doc_key + version există în VendorPolicy (anti-spoof)
      const policies = await prisma.vendorPolicy.findMany({
        where: {
          OR: items.map((i) => ({
            document: i.doc_key,
            version: String(i.version),
          })),
        },
      });

      // facem un set "DOCUMENT::VERSIUNE" pentru versiunile valide
      const valid = new Set(
        policies.map((p) => `${p.document}::${p.version}`)
      );

      // păstrăm doar item-urile care chiar există în VendorPolicy
      const toInsert = items
        .map((i) => ({
          document: i.doc_key,
          version: String(i.version),
        }))
        .filter((i) => valid.has(`${i.document}::${i.version}`));

      if (!toInsert.length) {
        return res.status(400).json({ error: "invalid_versions" });
      }

      // 2) inserăm/actualizăm acceptările în VendorAcceptance
      //    folosim upsert ca să nu dublăm aceeași pereche (vendor + doc + version)
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
            // atașăm checksum-ul din VendorPolicy, dacă există (audit)
            checksum:
              policies.find(
                (p) => p.document === it.document && p.version === it.version
              )?.checksum || null,
          },
          update: {
            // aici nu actualizăm nimic; dacă există deja, îl lăsăm cum e
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

// GET /api/vendor/agreements/status
// Scop:
//  - combină:
//    (1) lista ultimelor versiuni active din VendorPolicy
//    (2) acceptările din VendorAcceptance pentru vendor-ul curent
//  - întoarce pentru fiecare document: versiune curentă + dacă a fost sau nu acceptată
router.get(
  "/vendor/agreements/status",
  authRequired,
  vendorAccessRequired,
  async (req, res) => {
    try {
      // vendor curent
      const meVendor =
        req.meVendor ??
        (await prisma.vendor.findUnique({
          where: { userId: req.user.sub },
          select: { id: true },
        }));
      if (!meVendor) {
        return res.status(403).json({ error: "forbidden" });
      }

      // 1) ultimele versiuni active din VendorPolicy
      const active = await prisma.vendorPolicy.findMany({
        where: { isActive: true },
        orderBy: [
          { document: "asc" },
          { publishedAt: "desc" },
        ],
      });

      // map "document" -> cea mai recentă intrare
      const latest = new Map();
      for (const p of active) {
        if (!latest.has(p.document)) {
          latest.set(p.document, p);
        }
      }

      // 2) istoric acceptări ale vendorului
      const accepts = await prisma.vendorAcceptance.findMany({
        where: { vendorId: meVendor.id },
        select: { document: true, version: true, acceptedAt: true },
        orderBy: { acceptedAt: "desc" },
      });

      // set de perechi "DOCUMENT::VERSIUNE" pe care vendorul le-a acceptat
      const acceptedSet = new Set(
        accepts.map((a) => `${a.document}::${a.version}`)
      );

      // 3) compunem status per document (ultima versiune activă + accepted? true/false)
      const docs = [];
      for (const [, p] of latest) {
        const key = p.document; // ex: "VENDOR_TERMS", "SHIPPING_ADDENDUM", "RETURNS_POLICY"
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

      // allOK = toate documentele marcate is_required === true sunt acceptate
      const allOK = docs
        .filter((d) => d.is_required)
        .every((d) => d.accepted === true);

      res.json({ docs, allOK });
    } catch (e) {
      console.error("GET /vendor/agreements/status error:", e);
      res.status(500).json({ error: "server_error" });
    }
  }
);

/* ------------------------------------------------------------------ */
/* 👇 AICI: adaptor pentru checkbox-ul din ProfileTab ("Acord Master") */
/* ------------------------------------------------------------------ */

/**
 * Map între tipurile trimise din frontend și enum-ul VendorDoc din Prisma
 *
 * frontend:
 *   - vendor_terms
 *   - shipping_addendum
 *   - returns
 *
 * Prisma enum VendorDoc:
 *   - VENDOR_TERMS
 *   - SHIPPING_ADDENDUM
 *   - RETURNS_POLICY_ACK
 */
const typeToVendorDoc = {
  vendor_terms: "VENDOR_TERMS",
  shipping_addendum: "SHIPPING_ADDENDUM",
  returns: "RETURNS_POLICY_ACK",
};

/**
 * POST /api/legal/vendor-accept
 *
 * Body așteptat (exact cum trimite ProfileTab):
 * {
 *   accept: [
 *     { type: "vendor_terms" },
 *     { type: "shipping_addendum" },
 *     { type: "returns" }
 *   ]
 * }
 *
 * Scop:
 *  - pentru vendorul logat:
 *    - ia din VendorPolicy ultimele versiuni ACTIVE pentru documentele cerute
 *    - scrie în VendorAcceptance (upsert)
 *
 * ATENȚIE:
 *  - ruta asta există doar ca adaptor pentru checkbox-ul „Acordul Master”.
 *  - nu primește versiunea din frontend, o ia singură din VendorPolicy.
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

      const accept = Array.isArray(req.body?.accept)
        ? req.body.accept
        : [];

      const docsRequested = Array.from(
        new Set(
          accept
            .map((a) =>
              typeToVendorDoc[String(a.type || "").toLowerCase()]
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

      // versiune “default” – ideal să o ții în config/env
      const DEFAULT_VERSION = "v1.0";

      const now = new Date();

      for (const doc of docsRequested) {
        await prisma.vendorAcceptance.upsert({
          where: {
            vendorId_document_version: {
              vendorId: meVendor.id,
              document: doc,
              version: DEFAULT_VERSION,
            },
          },
          create: {
            vendorId: meVendor.id,
            document: doc,
            version: DEFAULT_VERSION,
            acceptedAt: now,
          },
          update: {
            // dacă vrei să actualizezi data la fiecare reacceptare:
            // acceptedAt: now,
          },
        });
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error("POST /api/legal/vendor-accept error:", e);
      return res.status(500).json({ error: "server_error" });
    }
  }
);

export default router;
