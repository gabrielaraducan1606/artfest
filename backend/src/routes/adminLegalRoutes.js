// src/routes/adminLegalRoutes.js
//
// Admin -> Politici / consimțăminte: catalog unitar al documentelor
// juridice + acțiunile separate "Publică versiunea" și "Cere reacceptarea".
//
// Montat la /api/admin/legal (împreună cu adminInfluencerTermsRoutes):
//   GET  /api/admin/legal/documents
//   POST /api/admin/legal/documents/publish
//   POST /api/admin/legal/documents/request-reacceptance
//   GET  /api/admin/legal/documents/history?catalogId=&audience=
//   GET  /api/admin/legal/documents/acceptances?catalogId=&audience=&version=&status=&page=
//   POST /api/admin/legal/campaigns/:id/close
//   POST /api/admin/legal/campaigns/:id/resend-email
//
// Publicarea NU cere reacceptare; doar "request-reacceptance" poate deschide
// gate-ul pentru utilizatorii existenți.

import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, enforceTokenVersion, requireRole } from "../api/auth.js";
import { getCatalogEntry } from "../services/legalRegistry.js";
import { buildLegalCatalog } from "../services/legalCatalogService.js";
import { publishLegalDocumentVersion } from "../services/legalPublishService.js";
import {
  closeReacceptance,
  listCampaignHistory,
  requestReacceptance,
} from "../services/reacceptanceService.js";
import { listPolicyRows } from "../services/legalPublishedService.js";
import {
  acceptancesByVersion,
  listAcceptances,
} from "../services/legalStatsService.js";
import { dispatchCampaignEmails } from "../services/policyEmailService.js";

const router = Router();

router.use(authRequired, enforceTokenVersion, requireRole("ADMIN"));

function sendError(res, error, label) {
  const status = Number(error?.status) || 500;

  if (status >= 500) {
    console.error(`[admin legal] ${label} failed:`, error);
  }

  return res.status(status).json({
    ok: false,
    error: error?.code || "internal_error",
    message: status >= 500 ? "Operațiunea nu a putut fi procesată." : error?.message,
  });
}

function actorOf(req) {
  return req.user?.sub || null;
}

router.get("/documents", async (_req, res) => {
  try {
    return res.json({ ok: true, ...(await buildLegalCatalog({ prisma })) });
  } catch (error) {
    return sendError(res, error, "GET /documents");
  }
});

router.post("/documents/publish", async (req, res) => {
  try {
    const result = await publishLegalDocumentVersion({
      catalogId: String(req.body?.catalogId || ""),
      version: req.body?.version,
      actorId: actorOf(req),
      prisma,
    });

    return res.json(result);
  } catch (error) {
    return sendError(res, error, "POST /documents/publish");
  }
});

router.post("/documents/request-reacceptance", async (req, res) => {
  try {
    const body = req.body || {};

    const result = await requestReacceptance({
      catalogId: String(body.catalogId || ""),
      audience: body.audience,
      version: body.version,
      requiresAction: body.requiresAction !== false,
      deadlineAt: body.deadlineAt || null,
      inApp: body.inApp && typeof body.inApp === "object" ? body.inApp : {},
      email: body.email && typeof body.email === "object" ? body.email : null,
      actorId: actorOf(req),
      prisma,
    });

    // Emailul (tranzacțional/legal) pleacă în fundal; rezultatul e
    // vizibil în contoarele campaniei și se poate relua.
    if (result.emailRequested) {
      dispatchCampaignEmails({ campaignId: result.campaignId, prisma });
    }

    const { recipients, ...publicResult } = result;

    return res.json(publicResult);
  } catch (error) {
    return sendError(res, error, "POST /documents/request-reacceptance");
  }
});

router.get("/documents/history", async (req, res) => {
  try {
    const entry = getCatalogEntry(String(req.query.catalogId || ""));

    if (!entry || !entry.contractual) {
      return res.status(404).json({ ok: false, error: "document_not_found" });
    }

    const audience = req.query.audience ? String(req.query.audience).toUpperCase() : entry.audiences[0];

    const [policies, campaigns, byVersion] = await Promise.all([
      listPolicyRows(entry, prisma),
      listCampaignHistory({ entry, prisma }),
      acceptancesByVersion({ entry, audience, prisma }),
    ]);

    return res.json({
      ok: true,
      catalogId: entry.catalogId,
      audience,
      policies: policies.map((row) => ({
        version: row.version,
        title: row.title,
        url: row.url,
        checksum: row.checksum,
        isRequired: row.isRequired,
        isActive: row.isActive,
        publishedAt: row.publishedAt,
      })),
      campaigns,
      acceptancesByVersion: byVersion,
    });
  } catch (error) {
    return sendError(res, error, "GET /documents/history");
  }
});

router.get("/documents/acceptances", async (req, res) => {
  try {
    const entry = getCatalogEntry(String(req.query.catalogId || ""));

    if (!entry || !entry.contractual) {
      return res.status(404).json({ ok: false, error: "document_not_found" });
    }

    const audience = String(req.query.audience || entry.audiences[0]).toUpperCase();

    if (!entry.audiences.includes(audience)) {
      return res.status(400).json({ ok: false, error: "audience_not_applicable" });
    }

    const status = ["accepted", "pending"].includes(String(req.query.status))
      ? String(req.query.status)
      : "all";

    const result = await listAcceptances({
      entry,
      audience,
      version: String(req.query.version || ""),
      status,
      page: req.query.page,
      pageSize: req.query.pageSize,
      prisma,
    });

    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, "GET /documents/acceptances");
  }
});

router.post("/campaigns/:id/close", async (req, res) => {
  try {
    return res.json(await closeReacceptance({ campaignId: req.params.id, prisma }));
  } catch (error) {
    return sendError(res, error, "POST /campaigns/:id/close");
  }
});

router.post("/campaigns/:id/resend-email", async (req, res) => {
  try {
    const result = await dispatchCampaignEmails({
      campaignId: req.params.id,
      prisma,
      wait: true,
    });

    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, "POST /campaigns/:id/resend-email");
  }
});

export default router;
