// src/routes/vendorIntegrationsRoutes.js
//
// Magazinele externe ale vânzătorului (Catalog -> Importuri): conectare,
// verificare, setări, previzualizare, import, stare. Montat pe
// /api/vendor/integrations.
//
// Siguranță:
//   - totul e oprit implicit: EXTERNAL_INTEGRATIONS_ENABLED=true pornește
//     rutele (altfel 404, înainte de autentificare);
//   - autentificarea standard + vânzător propriu, activ
//     (middleware/requireOwnVendor.js); o conexiune a altui vânzător e
//     raportată ca inexistentă (404);
//   - cheile API și secretul webhook-urilor nu ies niciodată din backend
//     (connectionStore.toPublicConnection = allow-list);
//   - erorile de autentificare ale MAGAZINULUI (cheie greșită) ies ca 422,
//     nu 401 / 403 - frontend-ul nu le confundă cu sesiunea Artfest;
//   - importul recitește fiecare produs din magazin și refolosește
//     planificatorul + confirmările (nu are încredere în planul trimis de
//     browser); fără duplicate (ExternalProductLink unic).
// Nu pornește worker-ul, webhook-urile sau sincronizarea automată.

import express from "express";

import { prisma } from "../db.js";
import { CATEGORY_SET } from "../constants/categories.js";
import { ownVendorChain } from "../middleware/requireOwnVendor.js";
import { adapterForConnection, getPlatform, listPlatforms } from "../integrations/core/adapterRegistry.js";
import {
  createConnection,
  disconnectConnection,
  isIntegrationEncryptionConfigured,
  maskCredential,
  toPublicConnection,
} from "../integrations/core/connectionStore.js";
import { IntegrationError } from "../integrations/core/errors.js";
import { applyConfirmations, planImport } from "../integrations/core/importPlanner.js";
import { importBatch, previewProducts } from "../integrations/core/importService.js";

export const MAX_IMPORT_ITEMS_PER_REQUEST = 10;
export const MAX_PREVIEW_PER_PAGE = 50;

export function isIntegrationsEnabled(env = process.env) {
  return String(env.EXTERNAL_INTEGRATIONS_ENABLED || "").trim().toLowerCase() === "true";
}

const SYNC_MODES = {
  STOCK_ONLY: { syncStock: true, syncContent: false },
  // conținutul (titlu, descriere, poze, prețuri) se va sincroniza într-o etapă ulterioară
  STOCK_AND_CONTENT: null,
};

function syncModeOf(connection) {
  if (connection.syncContent) return "STOCK_AND_CONTENT";
  return connection.syncStock ? "STOCK_ONLY" : "OFF";
}

function publicConnection(connection) {
  const meta = connection?.meta && typeof connection.meta === "object" ? connection.meta : {};
  return {
    ...toPublicConnection(connection),
    syncMode: syncModeOf(connection),
    storeCurrency: meta.currency || null,
    storeProductCount: Number.isFinite(meta.productCount) ? meta.productCount : null,
  };
}

function sendError(res, error) {
  if (error instanceof IntegrationError) {
    // cheile magazinului greșite / fără drepturi: NU 401/403 (ar însemna sesiunea Artfest)
    const status = error.status === 401 || error.status === 403 ? 422 : error.status || 400;
    return res.status(status).json({ error: error.code, message: error.message });
  }
  console.error("[vendor integrations]", error);
  return res.status(500).json({ error: "integration_error", message: "A apărut o eroare. Încearcă din nou." });
}

const cleanText = (value, max) => String(value ?? "").trim().slice(0, max);

/**
 * @param {Object} [deps]  dependențe injectate în teste (adaptor cu fetch simulat, copiere imagini, moderare)
 */
export function createVendorIntegrationsRouter({
  db = prisma,
  adapterFor = (connection) => adapterForConnection(connection),
  copyImages,
  afterCreate,
  env = process.env,
} = {}) {
  const router = express.Router();

  router.use((req, res, next) => (isIntegrationsEnabled(env) ? next() : res.status(404).json({ error: "not_found" })));
  router.use(express.json({ limit: "256kb" }));
  router.use(...ownVendorChain);

  async function ownConnection(req, res, { active = false } = {}) {
    const connection = await db.externalStoreConnection.findFirst({ where: { id: String(req.params.id), vendorId: req.vendor.id } });
    if (!connection) {
      res.status(404).json({ error: "connection_not_found", message: "Conexiunea nu a fost găsită." });
      return null;
    }
    if (active && connection.status === "DISCONNECTED") {
      res.status(409).json({ error: "connection_disconnected", message: "Magazinul este deconectat. Conectează-l din nou." });
      return null;
    }
    return connection;
  }

  async function testAndRecord(connection) {
    const now = new Date();
    try {
      const result = await adapterFor(connection).testConnection();
      return {
        ok: true,
        result,
        connection: await db.externalStoreConnection.update({
          where: { id: connection.id },
          data: {
            status: "ACTIVE",
            lastTestedAt: now,
            lastErrorAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            meta: { ...(connection.meta || {}), currency: result.currency, productCount: result.productCount },
          },
        }),
      };
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      await db.externalStoreConnection.update({
        where: { id: connection.id },
        data: { status: "ERROR", lastTestedAt: now, lastErrorAt: now, lastErrorCode: error.code, lastErrorMessage: error.message },
      });
      return { ok: false, error };
    }
  }

  /* ---------------- conexiuni ---------------- */

  router.get("/", async (req, res) => {
    try {
      const connections = await db.externalStoreConnection.findMany({
        where: { vendorId: req.vendor.id },
        orderBy: { createdAt: "desc" },
        take: 20,
      });
      res.json({ platforms: listPlatforms(), connections: connections.map(publicConnection) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/connections", async (req, res) => {
    try {
      const platform = cleanText(req.body?.platform, 32).toUpperCase();
      getPlatform(platform);

      const consumerKey = cleanText(req.body?.consumerKey, 200);
      const consumerSecret = cleanText(req.body?.consumerSecret, 200);
      if (!/^ck_[A-Za-z0-9_]{6,}$/.test(consumerKey) || !/^cs_[A-Za-z0-9_]{6,}$/.test(consumerSecret)) {
        return res.status(400).json({
          error: "invalid_credentials_format",
          message: "Cheile API WooCommerce trebuie să înceapă cu ck_ (Consumer key) și cs_ (Consumer secret).",
        });
      }
      const authMode = req.body?.authMode === "query" ? "query" : "basic";
      if (!isIntegrationEncryptionConfigured(env)) {
        return res.status(503).json({ error: "integration_encryption_unavailable", message: "Conectarea magazinelor externe nu este configurată pe server." });
      }

      const created = await createConnection({
        db,
        vendorId: req.vendor.id,
        platform,
        shopUrl: req.body?.shopUrl,
        credentials: { consumerKey, consumerSecret, authMode },
        credentialsHint: maskCredential(consumerKey),
        label: cleanText(req.body?.label, 120) || null,
        userId: req.authUser.id,
        env,
      });

      const tested = await testAndRecord(created);
      if (!tested.ok) {
        // datele greșite nu rămân salvate: vânzătorul reîncearcă cu alte chei
        await db.externalStoreConnection.delete({ where: { id: created.id } });
        return sendError(res, tested.error);
      }

      const warnings = tested.result.currency && tested.result.currency !== "RON" ? ["currency_not_ron"] : [];
      res.status(201).json({ connection: publicConnection(tested.connection), warnings });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/connections/:id/test", async (req, res) => {
    try {
      const connection = await ownConnection(req, res, { active: true });
      if (!connection) return;
      const tested = await testAndRecord(connection);
      if (!tested.ok) return sendError(res, tested.error);
      res.json({ connection: publicConnection(tested.connection) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/connections/:id", async (req, res) => {
    try {
      const connection = await ownConnection(req, res, { active: true });
      if (!connection) return;

      const data = {};
      if (req.body?.label !== undefined) data.label = cleanText(req.body.label, 120) || null;
      if (req.body?.syncMode !== undefined) {
        if (!(req.body.syncMode in SYNC_MODES)) return res.status(400).json({ error: "invalid_sync_mode", message: "Mod de sincronizare necunoscut." });
        const mode = SYNC_MODES[req.body.syncMode];
        if (!mode) {
          return res.status(409).json({ error: "content_sync_unavailable", message: "Sincronizarea conținutului nu este încă disponibilă. Momentan se sincronizează doar stocul." });
        }
        Object.assign(data, mode);
      }
      if (req.body?.stockMaster !== undefined) {
        // EXTERNAL: magazinul extern dă stocul; ARTFEST: Artfest dă stocul (magazinul îl primește)
        if (!["EXTERNAL", "ARTFEST"].includes(req.body.stockMaster)) {
          return res.status(400).json({ error: "invalid_stock_master", message: "Sursa stocului trebuie să fie magazinul extern sau Artfest." });
        }
        data.stockMaster = req.body.stockMaster;
      }
      if (req.body?.safetyBufferQty !== undefined) {
        const qty = Number(req.body.safetyBufferQty);
        if (!Number.isInteger(qty) || qty < 0 || qty > 1000) return res.status(400).json({ error: "invalid_safety_buffer", message: "Rezerva trebuie să fie un număr întreg între 0 și 1000." });
        data.safetyBufferQty = qty;
      }
      if (req.body?.isPaused !== undefined) {
        data.isPaused = req.body.isPaused === true;
        data.pausedAt = data.isPaused ? new Date() : null;
      }

      const updated = await db.externalStoreConnection.update({ where: { id: connection.id }, data });
      res.json({ connection: publicConnection(updated) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/connections/:id", async (req, res) => {
    try {
      const connection = await ownConnection(req, res);
      if (!connection) return;
      await disconnectConnection({ db, connectionId: connection.id, vendorId: req.vendor.id });
      const after = await db.externalStoreConnection.findUnique({ where: { id: connection.id } });
      res.json({ connection: publicConnection(after) });
    } catch (error) {
      sendError(res, error);
    }
  });

  /* ---------------- stare ---------------- */

  router.get("/connections/:id/status", async (req, res) => {
    try {
      const connection = await ownConnection(req, res);
      if (!connection) return;

      const [jobs, links, failures, lastImport] = await Promise.all([
        db.externalSyncJob.groupBy({ by: ["status"], where: { connectionId: connection.id }, _count: { _all: true } }),
        db.externalProductLink.groupBy({ by: ["status"], where: { connectionId: connection.id }, _count: { _all: true } }),
        db.externalSyncJob.findMany({
          where: { connectionId: connection.id, status: "DEAD" },
          orderBy: { finishedAt: "desc" },
          take: 5,
          select: { type: true, lastErrorCode: true, lastErrorMessage: true, finishedAt: true, attempts: true },
        }),
        db.productImport.findFirst({
          where: { connectionId: connection.id },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, totalRows: true, importedRows: true, skippedRows: true, failedRows: true, createdAt: true, completedAt: true },
        }),
      ]);
      const count = (rows) => Object.fromEntries(rows.map((r) => [r.status, r._count._all]));

      res.json({
        connection: publicConnection(connection),
        // sincronizarea automată nu e încă pornită (worker / webhook-uri)
        automaticSync: false,
        jobs: count(jobs),
        products: count(links),
        recentFailures: failures.map((f) => ({ type: f.type, code: f.lastErrorCode, message: f.lastErrorMessage, at: f.finishedAt, attempts: f.attempts })),
        lastImport,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  /* ---------------- previzualizare + import ---------------- */

  router.get("/connections/:id/products", async (req, res) => {
    try {
      const connection = await ownConnection(req, res, { active: true });
      if (!connection) return;

      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const perPage = Math.min(MAX_PREVIEW_PER_PAGE, Math.max(1, Number.parseInt(req.query.perPage, 10) || 20));
      const preview = await previewProducts({
        db,
        connection,
        adapter: adapterFor(connection),
        page,
        perPage,
        storeCurrency: connection.meta?.currency || null,
        planImport,
      });
      res.json(preview);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/connections/:id/import", async (req, res) => {
    try {
      const connection = await ownConnection(req, res, { active: true });
      if (!connection) return;

      const serviceId = cleanText(req.body?.serviceId, 64);
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const ids = items.map((item) => cleanText(item?.externalProductId, 64));
      if (!serviceId || !items.length || ids.some((id) => !id)) {
        return res.status(400).json({ error: "invalid_import_request", message: "Alege magazinul Artfest și cel puțin un produs." });
      }
      if (items.length > MAX_IMPORT_ITEMS_PER_REQUEST || new Set(ids).size !== ids.length) {
        return res.status(400).json({ error: "invalid_import_request", message: `Poți importa cel mult ${MAX_IMPORT_ITEMS_PER_REQUEST} produse diferite odată.` });
      }
      const service = await db.vendorService.findFirst({ where: { id: serviceId, vendorId: req.vendor.id }, select: { id: true } });
      if (!service) return res.status(404).json({ error: "service_not_found", message: "Magazinul Artfest nu a fost găsit." });

      const adapter = adapterFor(connection);
      const results = new Map();
      const ready = [];

      for (const [index, item] of items.entries()) {
        const externalProductId = ids[index];
        try {
          // produsul se recitește din magazin: planul nu vine din browser
          const product = await adapter.getProduct(externalProductId);
          const plan = applyConfirmations(planImport(product, { storeCurrency: connection.meta?.currency || null }), item?.confirmations || {}, {
            isValidCategory: (key) => CATEGORY_SET.has(key),
          });
          ready.push({ rowNumber: index + 1, plan, raw: { externalProductId, title: product.name } });
        } catch (error) {
          results.set(externalProductId, {
            externalProductId,
            status: error?.code === "confirmation_required" ? "needs_confirmation" : "failed",
            code: error?.code || "import_failed",
            ...(error?.missing ? { missing: error.missing } : {}),
            ...(error?.field ? { field: error.field } : {}),
            ...(error?.reasons ? { reasons: error.reasons } : {}),
            ...(error instanceof IntegrationError ? { message: error.message } : {}),
          });
        }
      }

      let importId = null;
      if (ready.length) {
        const batch = await importBatch({
          db,
          connection,
          serviceId,
          ownerUserId: req.authUser.id,
          items: ready,
          ...(copyImages ? { copyImages } : {}),
          ...(afterCreate ? { afterCreate } : {}),
        });
        importId = batch.importId;
        for (const [i, result] of batch.results.entries()) {
          const externalProductId = ready[i].plan.externalProductId;
          results.set(externalProductId, { externalProductId, ...result });
        }
      }

      res.json({ importId, results: ids.map((id) => results.get(id)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/connections/:id/imports", async (req, res) => {
    try {
      const connection = await ownConnection(req, res);
      if (!connection) return;
      const imports = await db.productImport.findMany({
        where: { connectionId: connection.id, vendorId: req.vendor.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, status: true, totalRows: true, importedRows: true, skippedRows: true, failedRows: true, createdAt: true, completedAt: true },
      });
      res.json({ imports });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

export default createVendorIntegrationsRouter();
