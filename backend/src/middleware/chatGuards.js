// backend/src/middleware/chatGuards.js
import { prisma } from "../db.js";

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
    sentPerMonth: null,
    allowAttachments: true,
    allowAdvanced: true,
    allowChat: true,
  },

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

function subscriptionCta() {
  return {
    label: "Modifică abonamentul",
    url: "/setari?tab=subscription",
  };
}

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

export function requireActiveSubscriptionForChat() {
  return async (req, res, next) => {
    try {
      if (!req._subResolved) {
        await new Promise((resolve, reject) => {
          attachSubscription()(req, res, (err) =>
            err ? reject(err) : resolve()
          );
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
      "Planul tău nu include funcțiile avansate de inbox. Fă upgrade ca să le activezi.",
  };

  return res.status(402).json({
    error: code,
    reason: code,
    planCode,
    title: "Funcție indisponibilă pe planul curent",
    message: messages[code] || "Funcția nu este disponibilă pe planul curent.",
    hint: "Mergi la Setări → Abonament pentru upgrade.",
    cta: subscriptionCta(),
  });
}

export function requireChatEntitlement({
  attachments = false,
  advanced = false,
} = {}) {
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

export async function assertChatQuotaOrThrow({ vendorId, subscription }) {
  const planCode = subscription?.plan?.code || "starter-lite";
  const dbLimit = subscription?.plan?.meta?.limits?.chatMessagesPerMonth;

  let limit;

  if (dbLimit === -1 || dbLimit === null) {
    return null;
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
    where: {
      vendorId_period: {
        vendorId,
        period,
      },
    },
    select: {
      sentCount: true,
    },
  });

  const used = usage?.sentCount || 0;

  if (used >= limit) {
    return {
      ok: false,
      status: 402,
      payload: {
        error: "CHAT_LIMIT_REACHED",
        reason: "CHAT_LIMIT_REACHED",
        title: "Ai atins limita lunară de mesaje",
        message:
          "Ai atins limita lunară de mesaje pentru planul tău. Modifică abonamentul sau așteaptă resetarea lunară.",
        period,
        used,
        limit,
        planCode,
        cta: subscriptionCta(),
      },
    };
  }

  return null;
}

export async function bumpChatUsage({
  tx,
  vendorId,
  incSent = 0,
  incThreads = 0,
}) {
  const period = periodYYYYMM(new Date());

  return tx.chatUsage.upsert({
    where: {
      vendorId_period: {
        vendorId,
        period,
      },
    },
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

export function getPlanCode(req) {
  return planCodeFromReq(req);
}