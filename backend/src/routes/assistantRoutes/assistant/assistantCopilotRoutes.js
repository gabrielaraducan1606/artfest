// backend/src/routes/assistantRoutes/assistant/assistantCopilotRoutes.js

/*
 * Strat de rută SUBȚIRE pentru noul router general (copilotRouter.js,
 * FAZA 4) - validare de request + delegare. NU înlocuiește
 * assistantChatRoutes.js: dacă routeCopilotMessage() întoarce
 * handled:false, clientul trebuie să continue exact ca azi, apelând
 * POST /api/assistant/chat (și fluxul local existent pe baza
 * rezultatului aceluia) - acest endpoint doar EXPUNE decizia
 * routerului general, nu impune un singur punct de intrare nou.
 */

import { Router } from "express";
import {
  authRequired,
  optionalAuth,
  enforceTokenVersion,
  requireRole,
} from "../../../api/auth.js";
import { routeCopilotMessage } from "../../../ai/copilotRouter.js";
import { getVendorInsights } from "../../../ai/insightsService.js";
import { resolveVendorByUserId } from "../../../services/costProfitService.js";

const router = Router();

function cleanString(value, maxLength = 3000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

/*
 * SUGESTIE DISCRETĂ DE SCHIMBARE DE SUBIECT
 *
 * Semnal ieftin (fără apel LLM suplimentar) - refolosește DOAR
 * category-ul deja calculat de routeCopilotMessage în tura curentă,
 * comparat cu category-ul turei anterioare (persistat client-side,
 * pe conversationContext.lastCategory - un câmp generic, separat de
 * forma specifică pe care conversationContext o are pentru fiecare
 * flow, ca să nu depindem de un singur "shape").
 *
 * Reguli (cerute explicit):
 * - NU după o singură schimbare de subiect (nevoie de >=2 consecutive);
 * - NU când există un pendingAction în așteptare de confirmare;
 * - NU când există o confirmare de ticket de suport în așteptare;
 * - NU când conversația e clară (streak sub prag / fără schimbare).
 */
const TOPIC_SUGGESTION_STREAK_THRESHOLD = 2;

function hasPendingConfirmationSignal({
  conversationContext,
  result,
}) {
  /*
   * Tura curentă tocmai a arătat ea însăși un pending_action sau a
   * întrebat deja "Renunț la ea și trecem la subiectul nou?" - nu mai
   * suprapunem și sugestia generică peste asta.
   */
  if (
    result?.resultType === "pending_action" ||
    result?.awaitingTopicChangeConfirmation === true
  ) {
    return true;
  }

  if (!conversationContext) return false;

  /*
   * Ticket de suport cu draft deja pregătit, în așteptare de
   * confirmare (vezi isTopicChange/hasTicketDraft din copilotRouter.js).
   */
  if (
    conversationContext.activeIntent === "SUPPORT_TROUBLESHOOT" &&
    conversationContext.collectedParams?.ticketDraft
  ) {
    return true;
  }

  /*
   * Anulare comandă cumpărător, în așteptare de confirmare.
   */
  if (
    conversationContext.activeIntent === "USER_ORDER_CANCEL" &&
    conversationContext.currentFlow === "confirming" &&
    conversationContext.collectedParams?.orderId
  ) {
    return true;
  }

  /*
   * Acțiune vendor (PLATFORM_ACTION) deja colectată complet,
   * pendingAction arătat anterior, în așteptare de confirmare.
   */
  if (
    conversationContext.activeAction &&
    !conversationContext.awaitingField
  ) {
    return true;
  }

  return false;
}

function computeTopicSuggestion({
  conversationContext,
  result,
}) {
  /*
   * topicId (manifestul cel mai relevant, doar pe PLATFORM_KNOWLEDGE)
   * e un semnal mai fin decât category - "campanii" vs "import
   * produse" vs "ce este Artfest" sunt toate PLATFORM_KNOWLEDGE, deci
   * category singur nu ar detecta nicio schimbare între ele. Pentru
   * orice alt tip de rezultat (PLATFORM_ACTION/EXISTING_FLOW/etc.),
   * category rămâne singurul semnal disponibil.
   */
  const category =
    result?.topicId || result?.category || null;

  const previousCategory = conversationContext?.lastCategory || null;

  const previousStreak = Number.isFinite(
    Number(conversationContext?.topicChangeStreak)
  )
    ? Number(conversationContext.topicChangeStreak)
    : 0;

  let topicChangeStreak = previousStreak;

  if (category && previousCategory && category !== previousCategory) {
    topicChangeStreak = previousStreak + 1;
  } else if (category) {
    topicChangeStreak = 0;
  }

  const suppressed = hasPendingConfirmationSignal({
    conversationContext,
    result,
  });

  const suggestTopicReset =
    !suppressed &&
    topicChangeStreak >= TOPIC_SUGGESTION_STREAK_THRESHOLD;

  return {
    lastCategory: category || previousCategory || null,

    /*
     * Dacă tocmai am sugerat, resetăm streak-ul - nu vrem să
     * repetăm sugestia la fiecare tură până userul reacționează.
     */
    topicChangeStreak: suggestTopicReset ? 0 : topicChangeStreak,

    suggestTopicReset,
  };
}

function cleanHistory(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const role =
        entry?.role === "assistant" ? "assistant" : "user";

      const content = cleanString(
        entry?.content ?? entry?.text ?? "",
        3000
      );

      if (!content) return null;

      return { role, content };
    })
    .filter(Boolean)
    .slice(-12);
}

function normalizePageContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const safe = {};

  /*
   * pathname/pageType = shape-ul NOU, real (PAGE-AWARE COPILOT) -
   * page/tab/section/route rămân acceptate pentru compatibilitate,
   * dar nu mai sunt trimise de niciun client după această etapă
   * (vezi derivePageContext.js pe frontend).
   */
  for (const key of [
    "pathname",
    "pageType",
    "page",
    "tab",
    "section",
    "route",
  ]) {
    if (value[key] !== undefined && value[key] !== null) {
      safe[key] = cleanString(value[key], 300);
    }
  }

  return Object.keys(safe).length ? safe : null;
}

/*
 * ENTITY-AWARE: whitelist STRICTĂ de tipuri - orice altceva trimis
 * de client e ignorat, determinist, nu doar "curățat" ca text. NU e
 * folosit pentru autorizare (vezi handlerele din
 * vendorAssistantCommandService.js - orice id de-aici e doar hint,
 * ownership-ul se verifică din nou, mereu, server-side).
 */
const CURRENT_ENTITY_TYPES = new Set([
  "PRODUCT",
  "PRODUCT_COSTING",
  "ORDER",
  "STORE",
  "QUOTE",
]);

function normalizeCurrentEntity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const type = cleanString(value.type, 40).toUpperCase();
  const id = cleanString(value.id, 120);

  if (!CURRENT_ENTITY_TYPES.has(type) || !id) {
    return null;
  }

  const name = value.name ? cleanString(value.name, 200) : null;

  return { type, id, name };
}

/*
 * conversationContext generic (FAZA 7-10 + PROACTIVE COPILOT) -
 * whitelist STRICTĂ de câmpuri acceptate din client, chiar dacă mai
 * jos (dispatchCommand/buildWhitelistedProductPatch) există oricum
 * o a doua barieră - apărare pe mai multe niveluri, niciodată un
 * obiect brut trimis mai departe.
 *
 * TREI forme, reciproc exclusive (exact cum le produce
 * toGenericConversationContext() din frontend) - fiecare verificată
 * separat, pentru că au forme complet diferite de collectedParams:
 * 1. activeAction (UPDATE_PRODUCT etc., FAZA 6-7).
 * 2. activeIntent "SUPPORT_TROUBLESHOOT" (FAZA 8-10) - collectedParams
 *    conține ticketDraft-ul complet (vezi buildTicketDraft din
 *    supportEscalationService.js), nu doar 2 câmpuri fixe ca la (1).
 * 3. activeInsight (PROACTIVE COPILOT, etapa curentă).
 *
 * BUG găsit și reparat la această etapă: forma (2) nu era deloc
 * recunoscută aici înainte - funcția întorcea null pentru orice
 * body fără activeAction/awaitingField, deci triajul de suport
 * multi-tură (FAZA 8-10) pierdea ticketDraft-ul de îndată ce trecea
 * prin acest endpoint HTTP real (testele anterioare treceau pentru
 * că apelau routeCopilotMessage() direct, ocolind acest normalizator).
 */
/*
 * lastCategory/topicChangeStreak (vezi computeTopicSuggestion mai
 * sus) trebuie să supraviețuiască round-trip-ul indiferent de forma
 * pe care restul conversationContext-ului o are pentru flow-ul activ
 * (sau chiar dacă NU există niciun flow activ - cazul cel mai comun,
 * mai multe întrebări libere consecutive fără context operațional).
 * De-aia sunt extrase separat, aici, nu în interiorul fiecărui
 * normalizator specific de mai jos.
 */
function extractTopicTrackingFields(value) {
  const lastCategory = value?.lastCategory
    ? cleanString(value.lastCategory, 60)
    : null;

  const topicChangeStreakRaw = Number(value?.topicChangeStreak);

  const topicChangeStreak = Number.isFinite(topicChangeStreakRaw)
    ? Math.max(0, Math.min(20, Math.round(topicChangeStreakRaw)))
    : 0;

  if (!lastCategory && !topicChangeStreak) {
    return null;
  }

  return { lastCategory, topicChangeStreak };
}

function normalizeConversationContext(value) {
  const topicTracking = extractTopicTrackingFields(value);
  const base = resolveConversationContextShape(value);

  if (!base && !topicTracking) return null;

  return {
    ...(base || {}),
    ...(topicTracking || {}),
  };
}

function resolveConversationContextShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  if (
    value.activeIntent === "SUPPORT_TROUBLESHOOT"
  ) {
    return normalizeSupportTroubleshootContext(value);
  }

  /*
   * BUGFIX (audit) - anulare comandă (cumpărător): aceeași formă
   * generală ca SUPPORT_TROUBLESHOOT ({activeIntent, currentFlow,
   * collectedParams}), dar cu propriul whitelist (orderId, nu
   * ticketDraft) - widget-ul de client (AiAssistant.jsx) retrimite
   * generic orice supportTroubleshootContext primit înapoi, deci
   * reutilizează același mecanism de round-trip fără cod nou pe
   * front, dar backend-ul are nevoie de propriul normalizator, ca
   * să nu piardă orderId prin whitelist-ul greșit.
   */
  if (value.activeIntent === "USER_ORDER_CANCEL") {
    return normalizeUserOrderCancelContext(value);
  }

  if (value.activeInsight) {
    return normalizeActiveInsightContext(value);
  }

  const activeAction = value.activeAction
    ? cleanString(value.activeAction, 80)
    : null;

  const awaitingField = value.awaitingField
    ? cleanString(value.awaitingField, 80)
    : null;

  if (!activeAction && !awaitingField) {
    return null;
  }

  const entityId = value.entityId
    ? cleanString(value.entityId, 100)
    : null;

  const rawCollectedParams =
    value.collectedParams &&
    typeof value.collectedParams === "object" &&
    !Array.isArray(value.collectedParams)
      ? value.collectedParams
      : {};

  const collectedParams = {
    missingUpdateField: rawCollectedParams.missingUpdateField
      ? cleanString(rawCollectedParams.missingUpdateField, 60)
      : null,

    productUpdate:
      rawCollectedParams.productUpdate &&
      typeof rawCollectedParams.productUpdate === "object" &&
      !Array.isArray(rawCollectedParams.productUpdate)
        ? rawCollectedParams.productUpdate
        : null,
  };

  return {
    activeAction,

    entityType: value.entityType
      ? cleanString(value.entityType, 80)
      : null,

    entityId,
    awaitingField,
    collectedParams,
  };
}

const SUPPORT_TICKET_PRIORITIES = new Set(["LOW", "MEDIUM", "HIGH"]);

/*
 * ticketDraft trece prin acest whitelist, DAR nu e sursa de adevăr
 * a scrierii - creaza tichetul rămâne STRICT frontend-ul, prin
 * createSupportTicket() deja existent (POST /api/assistant/support/
 * tickets), care are propria validare la scriere. Aici doar ne
 * asigurăm că nu propagăm un obiect arbitrar mai departe prin
 * pipeline-ul de triaj (evaluateSupportRequest/buildTicketDraft).
 */
function normalizeTicketDraft(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const priority = cleanString(value.priority, 20).toUpperCase();

  return {
    subject: cleanString(value.subject, 200),
    category: cleanString(value.category, 60),

    priority: SUPPORT_TICKET_PRIORITIES.has(priority)
      ? priority
      : "MEDIUM",

    audience: cleanString(value.audience, 20),
    message: cleanString(value.message, 4000),
    domain: value.domain ? cleanString(value.domain, 60) : null,

    entityType: value.entityType
      ? cleanString(value.entityType, 40)
      : null,

    entityId: value.entityId
      ? cleanString(value.entityId, 100)
      : null,

    stepsAttempted: Array.isArray(value.stepsAttempted)
      ? value.stepsAttempted
          .slice(0, 10)
          .map((step) => cleanString(step, 500))
      : [],
  };
}

function normalizeSupportTroubleshootContext(value) {
  const collected = value.collectedParams;

  const rawCollectedParams =
    collected &&
    typeof collected === "object" &&
    !Array.isArray(collected)
      ? collected
      : {};

  return {
    activeIntent: "SUPPORT_TROUBLESHOOT",

    currentFlow: value.currentFlow
      ? cleanString(value.currentFlow, 60)
      : null,

    collectedParams: {
      category: rawCollectedParams.category
        ? cleanString(rawCollectedParams.category, 40)
        : null,

      domain: rawCollectedParams.domain
        ? cleanString(rawCollectedParams.domain, 60)
        : null,

      clarificationRound: Number.isFinite(
        Number(rawCollectedParams.clarificationRound)
      )
        ? Math.max(
            0,
            Math.min(
              5,
              Number(rawCollectedParams.clarificationRound)
            )
          )
        : 0,

      stepsAttempted: Array.isArray(
        rawCollectedParams.stepsAttempted
      )
        ? rawCollectedParams.stepsAttempted
            .slice(0, 10)
            .map((step) => cleanString(step, 500))
        : [],

      ticketDraft: normalizeTicketDraft(
        rawCollectedParams.ticketDraft
      ),
    },
  };
}

function normalizeUserOrderCancelContext(value) {
  const collected = value.collectedParams;

  const rawCollectedParams =
    collected &&
    typeof collected === "object" &&
    !Array.isArray(collected)
      ? collected
      : {};

  return {
    activeIntent: "USER_ORDER_CANCEL",

    currentFlow: value.currentFlow
      ? cleanString(value.currentFlow, 60)
      : null,

    collectedParams: {
      orderId: rawCollectedParams.orderId
        ? cleanString(rawCollectedParams.orderId, 100)
        : null,
    },
  };
}

const ACTIVE_INSIGHT_TYPES = new Set([
  "PRODUCT_NO_COSTING",
  "PRODUCT_BELOW_MIN_PRICE",
  "PRODUCT_NEEDS_RECALCULATION",
  "PRODUCT_OUT_OF_STOCK",
  "ORDER_NEEDS_ACTION",
  "QUOTE_REQUEST_UNANSWERED",
  "CUSTOMER_REQUEST_UNANSWERED",
  "HOMEPAGE_FEATURE_PENDING_RESPONSE",
]);

const ACTIVE_INSIGHT_ACTIONS = new Set([
  "RECALCULATE_PRODUCTS",
  "APPLY_RECOMMENDED_PRICE",
]);

/*
 * Scope-urile posibile pentru "arată-mi toate" (vezi
 * detectInsightScope/scopeInsights din copilotRouter.js) - același
 * whitelist, ca clientul să nu poată retrimite o valoare arbitrară.
 */
const ACTIVE_INSIGHT_SCOPES = new Set([
  "urgent",
  "costs",
  "products",
  "orders",
  "all",
]);

/*
 * activeInsight vine STRICT din ce a trimis serverul într-un
 * răspuns anterior (insightContext, vezi copilotRouter.js) - dar
 * clientul îl retrimite la tura următoare, deci tot trece prin
 * whitelist ca orice altă intrare externă. suggestedAction e
 * limitat la whitelist-ul de acțiuni SIGURE deja înregistrate în
 * actionRegistry.js - orice altceva e ignorat, nu doar "curățat".
 */
function normalizeActiveInsightContext(value) {
  const insight = value.activeInsight;

  const type = cleanString(insight?.type, 60).toUpperCase();

  if (!ACTIVE_INSIGHT_TYPES.has(type)) {
    return null;
  }

  const suggestedAction = cleanString(
    insight?.suggestedAction,
    40
  ).toUpperCase();

  const rawActionParams =
    insight?.actionParams &&
    typeof insight.actionParams === "object" &&
    !Array.isArray(insight.actionParams)
      ? insight.actionParams
      : {};

  return {
    activeInsight: {
      type,
      domain: insight?.domain ? cleanString(insight.domain, 40) : null,
      title: insight?.title ? cleanString(insight.title, 200) : null,

      suggestedAction: ACTIVE_INSIGHT_ACTIONS.has(suggestedAction)
        ? suggestedAction
        : null,

      actionParams: {
        productId: rawActionParams.productId
          ? cleanString(rawActionParams.productId, 100)
          : null,
      },

      scope: ACTIVE_INSIGHT_SCOPES.has(insight?.scope)
        ? insight.scope
        : "all",
    },
  };
}

/*
 * Rolul (audience) vine STRICT din req.user, dacă e autentificat -
 * niciodată din body-ul cererii. Endpoint-ul e guest-usable
 * (optionalAuth), la fel ca /api/assistant/chat.
 */
function resolveAudience(req) {
  const role = String(req.user?.role || "").toUpperCase();

  if (role === "VENDOR" || role === "ADMIN") {
    return role;
  }

  if (req.user?.sub) {
    return "USER";
  }

  return "GUEST";
}

/* ======================================================
   POST /ask

   Ruta finală:
   POST /api/assistant/copilot/ask
====================================================== */

router.post(
  "/ask",
  optionalAuth,
  async (req, res) => {
    try {
      const message = cleanString(req.body?.message, 4000);

      if (!message) {
        return res.status(400).json({
          error: "message_required",
          message: "Scrie o întrebare pentru asistent.",
        });
      }

      const history = cleanHistory(req.body?.history);
      const audience = resolveAudience(req);

      const currentPage = normalizePageContext(
        req.body?.currentPage ?? req.body?.pageContext
      );

      const currentEntity = normalizeCurrentEntity(
        req.body?.currentEntity
      );

      const conversationContext = normalizeConversationContext(
        req.body?.conversationContext
      );

      const result = await routeCopilotMessage({
        message,
        history,
        audience,
        userSub: req.user?.sub || null,
        currentPage,
        currentEntity,
        conversationContext,
      });

      const topicSuggestion = computeTopicSuggestion({
        conversationContext,
        result,
      });

      return res.json({
        ...result,
        ...topicSuggestion,
      });
    } catch (error) {
      console.error(
        "[assistant-copilot] ask:",
        error
      );

      /*
       * BUGFIX (audit): error?.message era trimis direct clientului -
       * putea expune text intern (Prisma, OpenAI SDK, alte servicii)
       * unui vendor/guest, contrar principiului "fără câmpuri tehnice
       * în UI". Eroarea completă e deja logată mai sus, pe server.
       */
      return res.status(500).json({
        error: "copilot_router_failed",

        message:
          "Routerul general nu a putut procesa mesajul.",
      });
    }
  }
);

/* ======================================================
   GET /insights

   Ruta finală:
   GET /api/assistant/copilot/insights

   PROACTIVE COPILOT - STRICT read-only, filtrat automat după
   vendorul autentificat (userSub -> vendorId, NICIODATĂ dintr-un
   parametru de request). Nu scrie nimic - vezi insightsService.js.
====================================================== */
router.get(
  "/insights",
  authRequired,
  enforceTokenVersion,
  requireRole("VENDOR"),

  async (req, res) => {
    try {
      const vendor = await resolveVendorByUserId(req.user.sub);

      if (!vendor) {
        return res.status(404).json({
          error: "vendor_not_found",
          message: "Nu am găsit un magazin de vânzător asociat contului tău.",
        });
      }

      const insights = await getVendorInsights(vendor.id);

      return res.json({ ok: true, insights });
    } catch (error) {
      console.error(
        "[assistant-copilot] insights:",
        error
      );

      return res.status(500).json({
        error: "insights_failed",

        message:
          "Nu am putut calcula insight-urile momentan.",
      });
    }
  }
);

router.get(
  "/test",
  (_req, res) => {
    return res.json({
      ok: true,
      assistant: "copilot-router",
      message: "Routerul general Artfest este activ.",
    });
  }
);

export default router;
