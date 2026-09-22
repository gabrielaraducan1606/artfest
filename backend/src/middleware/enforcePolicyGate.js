// backend/src/middleware/enforcePolicyGate.js
//
// Middleware de blocare pe baza CERERILOR DESCHISE de reacceptare
// (services/reacceptanceService.js) - PREGĂTIT, dar NEMONTAT pe nicio rută
// (vendorRoutes.js îl importă, dar montarea rămâne comentată). Activarea se
// decide separat, per rută, după ce gate-ul din UI e verificat în producție.
//
// Diferențe față de versiunea veche:
//  - NU mai compară "toate politicile active" cu acceptările: publicarea unei
//    versiuni NU blochează pe nimeni. Blochează doar cererile explicite de
//    reacceptare (Admin -> "Cere reacceptarea"), pe audience-ul contului
//    (USER / VENDOR / INFLUENCER), inclusiv documente multiple simultan;
//  - identitatea vine din JWT (`req.user.sub`, nu `req.user.id`, care nu
//    există pe payload);
//  - respectă termenul-limită: înainte de deadline cererea NU blochează;
//  - INFLUENCER_TERMS rămâne în seama enforceInfluencerTermsGate;
//  - COOKIES nu face parte din mecanismul contractual;
//  - moduri, prin LEGAL_ENFORCEMENT (sau options.mode):
//      off      nu face nimic;
//      report   (IMPLICIT) NU blochează: doar loghează ce ar fi blocat și
//               setează headerul X-Policy-Gate: would-block;
//      enforce  răspunde 428 cu lista documentelor lipsă;
//  - rute exceptate: gate-ul în sine, paginile legale, autentificarea,
//    acceptarea acordului de influencer.
//
// Utilizare (când se va decide): router.post("/x", authRequired,
//   enforcePolicyGate({ scope: "VENDORS" }), handler)

import { prisma as defaultPrisma } from "../db.js";
import { getPendingDocuments } from "../services/policyGateService.js";

export const ENFORCEMENT_MODES = Object.freeze(["off", "report", "enforce"]);

export const DEFAULT_EXEMPT_PREFIXES = Object.freeze([
  "/api/policy-gate",
  "/policy-gate",
  "/api/legal",
  "/legal",
  "/api/auth",
  "/auth",
  "/api/influencer/terms/accept",
]);

export function resolveEnforcementMode(explicit) {
  const value = String(explicit ?? process.env.LEGAL_ENFORCEMENT ?? "report")
    .trim()
    .toLowerCase();

  return ENFORCEMENT_MODES.includes(value) ? value : "report";
}

function normalizeOptions(input) {
  // compatibilitate: enforcePolicyGate("VENDORS")
  if (typeof input === "string") return { scope: input };

  return input && typeof input === "object" ? input : {};
}

function normalizeScope(scope) {
  const value = String(scope || "ALL").toUpperCase();

  return ["USERS", "VENDORS"].includes(value) ? value : "ALL";
}

function isExempt(req, exempt) {
  const path = String(req.originalUrl || req.url || "").split("?")[0];

  return exempt.some((prefix) => path.startsWith(prefix));
}

function isBlocking(document, now) {
  if (!document.required || document.alreadyAccepted) return false;

  const deadline = document.deadlineAt ? new Date(document.deadlineAt) : null;

  return !deadline || deadline <= now;
}

function describe(document) {
  return {
    key: document.key,
    catalogId: document.catalogId,
    document: document.document,
    version: document.version,
    scope: document.scope,
    audience: document.audience,
    url: document.url || null,
    deadlineAt: document.deadlineAt || null,
  };
}

export function enforcePolicyGate(input = {}) {
  const options = normalizeOptions(input);
  const scope = normalizeScope(options.scope);
  const exempt = options.exempt || DEFAULT_EXEMPT_PREFIXES;
  const prisma = options.prisma || defaultPrisma;
  const loadPending = options.getPendingDocuments || getPendingDocuments;
  const now = options.now || (() => new Date());

  return async function policyGateMiddleware(req, res, next) {
    const mode = resolveEnforcementMode(options.mode);

    if (mode === "off") return next();

    try {
      if (isExempt(req, exempt)) return next();

      const userId = req.user?.sub || req.user?.id;

      if (!userId) {
        return res.status(401).json({ error: "unauthorized" });
      }

      const role = req.user?.role;

      let vendorId = null;

      if (role === "VENDOR") {
        const vendor = await prisma.vendor.findUnique({
          where: { userId },
          select: { id: true },
        });

        vendorId = vendor?.id || null;
      }

      const { documents } = await loadPending({ userId, role, vendorId, prisma });

      const at = now();

      const missing = documents
        .filter((document) => scope === "ALL" || document.scope === scope)
        .filter((document) => isBlocking(document, at))
        .map(describe);

      if (!missing.length) return next();

      req.policyGate = { mode, missing };

      if (mode === "report") {
        res.setHeader("X-Policy-Gate", "would-block");

        console.warn(
          "[policy-gate:report] ar fi blocat",
          JSON.stringify({
            userId,
            role,
            scope,
            path: String(req.originalUrl || req.url || "").split("?")[0],
            missing: missing.map((m) => `${m.catalogId}@${m.version}`),
          })
        );

        return next();
      }

      return res.status(428).json({
        error: "policy_acceptance_required",
        scope,
        missing,
      });
    } catch (error) {
      console.error("enforcePolicyGate error:", error);

      // în report nu stricăm niciodată cererea din cauza monitorizării
      if (mode === "report") return next();

      return res.status(500).json({ error: "internal_error" });
    }
  };
}
