// backend/src/middleware/chatGuards.js
import { prisma } from "../db.js";

/**
 * Fallback limits mapate pe code-ul din SubscriptionPlan.
 * Priorități:
 * - entitlements: din plan.entitlements, fallback la LIMITS
 * - quota chat: din plan.meta.limits.chatMessagesPerMonth, fallback la LIMITS
 *
 * Valorile de aici sunt fallback/compat.
 * Sursa principală rămâne DB-ul.
 */
const LIMITS = {
  "starter-lite": {
    sentPerMonth: 50,
    allowAttachments: false,
    allowAdvanced: false,
    allowChat: true,
  },

  basic: {
    sentPerMonth: 50,
    allowAttachments: false,
    allowAdvanced: false,
    allowChat: true,
  },

  pro: {
    sentPerMonth: null,
    allowAttachments: true,
    allowAdvanced: false,
    allowChat: true,
  },

  premium: {
    sentPerMonth: null, // nelimitat
    allowAttachments: true,
    allowAdvanced: true,
    allowChat: true,
  },

  // compat vechi, dacă mai există subscriberi pe planuri istorice
  starter: {
    sentPerMonth: 300,
    allowAttachments: true,
    allowAdvanced: false,
    allowChat: true,
  },
  business: {
    sentPerMonth: null,
    allowAttachments: true,
    allowAdvanced: true,
    allowChat: true,
  },
};

function periodYYYYMM(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Helper: vendorId pentru userul logat (cached pe request)
 */
export async function getVendorIdForUser(req) {
  if (req._vendorIdResolved !== undefined) return req._vendorIdResolved;

  const userId = req.user?.sub;
  if (!userId) {
    req._vendorIdResolved = null;
    return null;
  }

  if (req.meVendor?.id) {
    req._vendorIdResolved = req.meVendor.id;
    return req._vendorIdResolved;
  }

  const vendor = await prisma.vendor.findUnique({
    where: { userId },
    select: { id: true },
  });

  req._vendorIdResolved = vendor?.id || null;
  return req._vendorIdResolved;
}

/**
 * Atașează subscription-ul activ în req.subscription
 * - nu blochează
 * - consideră activ dacă:
 *   - status=active și endAt > now
 *   - sau trialEndsAt > now
 */
export function attachSubscription() {
  return async (req, _res, next) => {
    try {
      if (req._subResolved) return next();
      req._subResolved = true;

      const userId = req.user?.sub;
      if (!userId) return next();

      const vendorId = await getVendorIdForUser(req);
      if (!vendorId) return next();

      const now = new Date();

      const sub = await prisma.vendorSubscription.findFirst({
        where: {
          vendorId,
          OR: [
            { status: "active", endAt: { gt: now } },
            { trialEndsAt: { gt: now } },
          ],
        },
        orderBy: [{ startAt: "desc" }, { createdAt: "desc" }],
        include: {
          plan: {
            select: {
              code: true,
              name: true,
              entitlements: true,
              meta: true,
            },
          },
        },
      });

      if (sub) req.subscription = sub;
      return next();
    } catch (e) {
      return next(e);
    }
  };
}

/**
 * Blochează complet chat-ul dacă vendorul nu are subscription/trial activ
 */
export function requireActiveSubscriptionForChat() {
  return async (req, res, next) => {
    try {
      if (!req._subResolved) {
        await new Promise((resolve, reject) => {
          attachSubscription()(req, res, (err) => (err ? reject(err) : resolve()));
        });
      }

      if (!req.subscription) {
        return res.status(402).json({
          error: "subscription_required",
          message:
            "Ai nevoie de un abonament activ sau de un trial activ ca să folosești chat-ul.",
        });
      }

      return next();
    } catch (e) {
      return next(e);
    }
  };
}

function planCodeFromReq(req) {
  return req.subscription?.plan?.code || "starter-lite";
}

/**
 * Citește entitlements din DB dacă există.
 * Acceptă chei:
 * - chat
 * - attachments
 * - advanced
 * - advancedChat
 */
function entitlementsFromReq(req) {
  const raw = req.subscription?.plan?.entitlements;
  if (!raw || typeof raw !== "object") return null;

  const advanced =
    raw.advanced !== undefined
      ? raw.advanced
      : raw.advancedChat !== undefined
      ? raw.advancedChat
      : false;

  return {
    chat: raw.chat === undefined ? true : !!raw.chat,
    attachments: !!raw.attachments,
    advanced: !!advanced,
  };
}

function friendlyUpgrade(res, code, planCode) {
  const messages = {
    CHAT_NOT_ALLOWED:
      "Planul tău nu include acces la chat. Te rog fă upgrade ca să poți trimite mesaje.",
    CHAT_ATTACHMENTS_NOT_ALLOWED:
      "Planul tău nu include trimiterea de atașamente. Fă upgrade ca să poți atașa fișiere.",
    CHAT_ADVANCED_NOT_ALLOWED:
      "Planul tău nu include funcțiile avansate de inbox (note interne, follow-up, status lead etc.). Fă upgrade ca să le activezi.",
  };

  return res.status(402).json({
    error: code,
    planCode,
    message: messages[code] || "Funcția nu este disponibilă pe planul curent.",
    hint: "Mergi la Abonament / Billing pentru upgrade.",
  });
}

/**
 * Verifică entitlement pe plan
 * - preferă plan.entitlements din DB
 * - fallback la LIMITS
 */
export function requireChatEntitlement({ attachments = false, advanced = false } = {}) {
  return (req, res, next) => {
    const planCode = planCodeFromReq(req);

    const ent = entitlementsFromReq(req);
    const cfg = LIMITS[planCode] || LIMITS["starter-lite"];

    const allowChat = ent ? ent.chat : cfg.allowChat;
    const allowAttachments = ent ? ent.attachments : cfg.allowAttachments;
    const allowAdvanced = ent ? ent.advanced : cfg.allowAdvanced;

    if (!allowChat) return friendlyUpgrade(res, "CHAT_NOT_ALLOWED", planCode);
    if (attachments && !allowAttachments) {
      return friendlyUpgrade(res, "CHAT_ATTACHMENTS_NOT_ALLOWED", planCode);
    }
    if (advanced && !allowAdvanced) {
      return friendlyUpgrade(res, "CHAT_ADVANCED_NOT_ALLOWED", planCode);
    }

    return next();
  };
}

/**
 * Quota check (mesaje trimise / lună)
 * Prioritate:
 * 1. subscription.plan.meta.limits.chatMessagesPerMonth
 * 2. LIMITS fallback
 *
 * Returnează:
 * - null dacă e ok
 * - { ok:false, status, payload } dacă e depășit
 */
export async function assertChatQuotaOrThrow({ vendorId, subscription }) {
  const planCode = subscription?.plan?.code || "starter-lite";
  const dbLimit = subscription?.plan?.meta?.limits?.chatMessagesPerMonth;

  let limit;

  if (dbLimit === -1 || dbLimit === null) {
    return null; // nelimitat
  }

  if (typeof dbLimit === "number" && Number.isFinite(dbLimit) && dbLimit >= 0) {
    limit = dbLimit;
  } else {
    const cfg = LIMITS[planCode] || LIMITS["starter-lite"];
    if (cfg.sentPerMonth == null) return null;
    limit = cfg.sentPerMonth;
  }

  const period = periodYYYYMM(new Date());

  const usage = await prisma.chatUsage.findUnique({
    where: { vendorId_period: { vendorId, period } },
    select: { sentCount: true },
  });

  const used = usage?.sentCount || 0;

  if (used >= limit) {
    return {
      ok: false,
      status: 402,
      payload: {
        error: "CHAT_LIMIT_REACHED",
        message:
          "Ai atins limita lunară de mesaje pentru planul tău. Te rog fă upgrade sau așteaptă resetarea lunară.",
        period,
        used,
        limit,
        planCode,
      },
    };
  }

  return null;
}

/**
 * Increment usage (într-un transaction)
 */
export async function bumpChatUsage({ tx, vendorId, incSent = 0, incThreads = 0 }) {
  const period = periodYYYYMM(new Date());

  return tx.chatUsage.upsert({
    where: { vendorId_period: { vendorId, period } },
    create: {
      vendorId,
      period,
      sentCount: incSent,
      threadCount: incThreads,
    },
    update: {
      ...(incSent ? { sentCount: { increment: incSent } } : {}),
      ...(incThreads ? { threadCount: { increment: incThreads } } : {}),
    },
  });
}

/**
 * Helper export
 */
export function getPlanCode(req) {
  return planCodeFromReq(req);
}