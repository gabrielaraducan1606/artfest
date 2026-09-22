// backend/src/routes/adminPolicyNotificationsRoutes.js
//
// Gate-ul de politici (utilizator / vendor / influencer) + endpoint de
// compatibilitate pentru formularul vechi de trimitere.
//
//   GET  /api/policy-gate?scope=USERS|VENDORS   documentele cerute cont-ului
//   GET  /api/policy-gate/pending               tot ce lipsește (ambele scope-uri)
//   POST /api/policy-gate/accept                acceptă documentele cerute
//   POST /api/admin/policy-notifications/send   WRAPPER de compatibilitate
//
// Gate-ul se deduce din CERERILE deschise de reacceptare + acceptări
// (services/policyGateService.js). Notificările create de campaniile vechi
// (fără meta.requirements) rămân funcționale. COOKIES nu mai face parte din
// mecanismul contractual.
//
// Administrarea documentelor (publicare / cerere de reacceptare) se face din
// /api/admin/legal/* (routes/adminLegalRoutes.js).

import { Router } from "express";

import { prisma } from "../db.js";

import {
  authRequired,
  enforceTokenVersion,
} from "../api/auth.js";

import {
  acceptGateDocuments,
  getGateState,
  getPendingDocuments,
  normalizeGateScope,
} from "../services/policyGateService.js";
import { getPublishedInfo } from "../services/legalPublishedService.js";
import { publishLegalDocumentVersion } from "../services/legalPublishService.js";
import { requestReacceptance } from "../services/reacceptanceService.js";
import { dispatchCampaignEmails } from "../services/policyEmailService.js";
import { getLegalDefinition, loadLegalDoc } from "../lib/legal.js";
import { getCatalogEntry } from "../services/legalRegistry.js";

const router = Router();

/* =========================================================
 * Compatibilitate /send: cheie de document -> rânduri de catalog
 * ========================================================= */

/*
 * COOKIES, MARKETING și PRODUCT_DECLARATION nu mai pot fi cerute prin acest
 * endpoint (cookies nu e document contractual; ceilalți nu sunt documente
 * versionate din manifest). Campaniile vechi care le conțin rămân
 * funcționale în gate.
 */
const SEND_ROWS_BY_SCOPE = {
  USERS: {
    // TOS/Privacy se aplicau înainte și clienților, și vendorilor
    TOS: [{ catalogId: "TOS", audiences: ["USER", "VENDOR"] }],
    PRIVACY: [{ catalogId: "PRIVACY", audiences: ["USER", "VENDOR"] }],
    RETURNS_POLICY_ACK: [
      { catalogId: "RETURNS_POLICY_ACK@USER", audiences: ["USER"] },
    ],
  },
  VENDORS: {
    VENDOR_TERMS: [{ catalogId: "VENDOR_TERMS", audiences: ["VENDOR"] }],
    SHIPPING_ADDENDUM: [{ catalogId: "SHIPPING_ADDENDUM", audiences: ["VENDOR"] }],
    PRODUCTS_ADDENDUM: [{ catalogId: "PRODUCTS_ADDENDUM", audiences: ["VENDOR"] }],
    RETURNS_POLICY_ACK: [
      { catalogId: "RETURNS_POLICY_ACK@VENDOR", audiences: ["VENDOR"] },
    ],
  },
};

/* =========================================================
 * Helpers
 * ========================================================= */

function normalizeDocumentKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeDocuments(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .map((item) => {
          if (typeof item === "string") {
            return normalizeDocumentKey(item);
          }

          if (typeof item?.key === "string") {
            return normalizeDocumentKey(item.key);
          }

          if (typeof item?.document === "string") {
            return normalizeDocumentKey(item.document);
          }

          return "";
        })
        .filter(Boolean)
    )
  );
}

function getAuthUserId(req) {
  return (
    req.user?.userId ||
    req.user?.id ||
    req.user?.sub ||
    req.user?.uid ||
    null
  );
}

function getRequestIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || null;
}

function getRequestUa(req) {
  return req.headers["user-agent"] || null;
}

function createRouteError(status, code, extra = {}) {
  const error = new Error(code);

  error.status = status;
  error.code = code;

  Object.assign(error, extra);

  return error;
}

function sendRouteError(res, error, fallbackCode = "internal_error") {
  const status = Number(error?.status) || 500;

  const code = error?.code || error?.message || fallbackCode;

  const body = { error: code };

  if (Array.isArray(error?.invalidDocuments)) {
    body.invalidDocuments = error.invalidDocuments;
  }

  if (Array.isArray(error?.missingDocuments)) {
    body.missingDocuments = error.missingDocuments;
  }

  if (Array.isArray(error?.unknownTypes)) {
    body.unknownTypes = error.unknownTypes;
  }

  return res.status(status).json(body);
}

async function requireAdmin(req) {
  const authUserId = getAuthUserId(req);

  if (!authUserId) {
    throw createRouteError(401, "unauthorized");
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: authUserId },
    select: { id: true, role: true, email: true },
  });

  const role = String(currentUser?.role || "").toUpperCase();

  if (!currentUser || !["ADMIN", "SUPER_ADMIN"].includes(role)) {
    throw createRouteError(403, "forbidden");
  }

  return currentUser;
}

/*
 * Identitatea contului pentru gate: rolul se citește din DB (nu din token)
 * și, dacă există, profilul de vendor.
 */
async function loadPrincipal(req) {
  const userId = getAuthUserId(req);

  if (!userId) {
    throw createRouteError(401, "unauthorized");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  });

  if (!user) {
    throw createRouteError(401, "unauthorized");
  }

  const vendor = await prisma.vendor.findUnique({
    where: { userId },
    select: { id: true },
  });

  return { userId, role: user.role, vendorId: vendor?.id || null };
}

/* =========================================================
 * GET /api/policy-gate?scope=USERS|VENDORS
 * ========================================================= */

router.get(
  "/policy-gate",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const scope = normalizeGateScope(req.query?.scope);

      if (!scope) {
        return res.status(400).json({ error: "invalid_scope" });
      }

      const principal = await loadPrincipal(req);

      if (scope === "VENDORS" && !principal.vendorId) {
        return res.status(403).json({ error: "vendor_required" });
      }

      const state = await getGateState({ ...principal, scope, prisma });

      return res.json({
        notification: state.notification,
        requiresAction: state.requiresAction,
        documents: state.documents,
      });
    } catch (error) {
      console.error("GET /api/policy-gate error:", error);

      return sendRouteError(res, error);
    }
  }
);

/* =========================================================
 * GET /api/policy-gate/pending
 *
 * Tot ce mai are de acceptat contul (ambele scope-uri), pe baza
 * cererilor deschise. Folosit de frontend după un 428/412.
 * ========================================================= */

router.get(
  "/policy-gate/pending",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const principal = await loadPrincipal(req);

      const { pending, documents } = await getPendingDocuments({
        ...principal,
        prisma,
      });

      return res.json({
        ok: true,
        requiresAction: pending.length > 0,
        pending,
        documents,
      });
    } catch (error) {
      console.error("GET /api/policy-gate/pending error:", error);

      return sendRouteError(res, error);
    }
  }
);

/* =========================================================
 * POST /api/policy-gate/accept
 * ========================================================= */

router.post(
  "/policy-gate/accept",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const scope = normalizeGateScope(req.body?.scope);

      if (!scope) {
        return res.status(400).json({ error: "invalid_scope" });
      }

      const requestedDocuments = normalizeDocuments(req.body?.documents);

      if (!requestedDocuments.length) {
        return res.status(400).json({ error: "no_documents" });
      }

      const principal = await loadPrincipal(req);

      if (scope === "VENDORS" && !principal.vendorId) {
        return res.status(403).json({ error: "vendor_required" });
      }

      const result = await acceptGateDocuments({
        ...principal,
        scope,
        documentKeys: requestedDocuments,
        ip: getRequestIp(req),
        ua: getRequestUa(req),
        source: "policy_gate",
        prisma,
      });

      return res.json(result);
    } catch (error) {
      console.error("POST /api/policy-gate/accept error:", error);

      return sendRouteError(res, error);
    }
  }
);

/* =========================================================
 * POST /api/admin/policy-notifications/send   (COMPATIBILITATE)
 *
 * Formularul vechi publica versiunea curentă din manifest ȘI notifica.
 * Păstrăm contractul de request, dar acum:
 *   1. publică (dacă nu e deja publicată) versiunea curentă a fiecărui
 *      document, doar în tabelul potrivit (Returns USER/VENDOR separate);
 *   2. creează câte o CERERE de reacceptare per (document, audience);
 *   3. trimite emailul tranzacțional dacă e cerut.
 * Interfața nouă (/api/admin/legal/*) separă cele două acțiuni.
 * ========================================================= */

router.post(
  "/admin/policy-notifications/send",
  authRequired,
  enforceTokenVersion,
  async (req, res) => {
    try {
      const currentUser = await requireAdmin(req);

      const scope = normalizeGateScope(req.body?.scope);
      const documents = normalizeDocuments(req.body?.documents);
      const requiresAction = req.body?.requiresAction === true;

      const inApp =
        req.body?.inApp && typeof req.body.inApp === "object"
          ? req.body.inApp
          : {};

      const email =
        req.body?.email && typeof req.body.email === "object"
          ? req.body.email
          : null;

      if (!scope) {
        return res.status(400).json({ error: "invalid_scope" });
      }

      if (!documents.length) {
        return res.status(400).json({ error: "no_documents" });
      }

      const rowsByKey = SEND_ROWS_BY_SCOPE[scope];
      const invalidDocuments = documents.filter((key) => !rowsByKey[key]);

      if (invalidDocuments.length) {
        return res.status(400).json({
          error: "invalid_documents",
          invalidDocuments,
        });
      }

      const title = String(
        inApp?.title || "Actualizare documente legale"
      ).trim();

      const message = String(
        inApp?.message || "Au fost actualizate documentele legale."
      ).trim();

      if (!title || !message) {
        return res.status(400).json({ error: "notification_content_required" });
      }

      const publishedPolicies = [];
      const campaigns = [];

      for (const key of documents) {
        for (const { catalogId, audiences } of rowsByKey[key]) {
          const entry = getCatalogEntry(catalogId);
          const currentVersion = String(loadLegalDoc(entry.manifestType).policyVersion);
          const published = await getPublishedInfo(catalogId, prisma);

          if (!published || published.source !== "policy" || String(published.version) !== currentVersion) {
            const publication = await publishLegalDocumentVersion({
              catalogId,
              version: currentVersion,
              actorId: currentUser.id,
              prisma,
            });

            publishedPolicies.push({
              catalogId,
              version: publication.version,
              title: getLegalDefinition(entry.manifestType).title,
            });
          }

          for (const audience of audiences) {
            const result = await requestReacceptance({
              catalogId,
              audience,
              version: currentVersion,
              requiresAction,
              inApp: { title, message },
              email,
              actorId: currentUser.id,
              prisma,
            });

            if (result.emailRequested) {
              dispatchCampaignEmails({ campaignId: result.campaignId, prisma });
            }

            campaigns.push({ catalogId, ...result, recipients: undefined });
          }
        }
      }

      const sum = (field) => campaigns.reduce((total, c) => total + (c[field] || 0), 0);

      return res.json({
        ok: true,

        campaignId: campaigns[0]?.campaignId || null,
        campaigns,

        scope,
        documents,

        publication: {
          publishedCount: publishedPolicies.length,
          policies: publishedPolicies,
        },

        targetCount: sum("targetCount"),
        createdCount: sum("createdCount"),

        // emailul pleacă în fundal; contoarele reale sunt în campanie
        emailQueued: email ? 0 : null,
        emailFailed: email ? 0 : null,
      });
    } catch (error) {
      console.error("POST /api/admin/policy-notifications/send error:", error);

      return sendRouteError(res, error);
    }
  }
);

export default router;
