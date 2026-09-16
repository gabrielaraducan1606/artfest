// backend/src/services/userAssistantNotifications.js
//
// USER BATCH 2 (audit USER, 2026-09-08) - serviciu SUBȚIRE, read-only,
// pentru întrebările unui cumpărător autentificat despre PROPRIILE
// notificări ("câte notificări necitite am", "ce notificări noi am").
//
// NU duplică business logic - reutilizează EXACT query-urile din
// userNotificationsRoutes.js (GET /unread-count, GET /). Ownership
// IDENTIC: where: { userId }.
//
// Nu inventăm preferințe de notificări inexistente - modelul
// Notification nu are niciun câmp de "tip preferat"/opt-in per tip,
// doar type/title/body/link/readAt/archived - vezi auth.manifest.js
// pentru cele 3 booleane reale de preferințe (email, nu notificări
// in-app).

import { prisma } from "../db.js";

function normalizeForDetection(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function detectUserNotificationsTopic(message, { lastCategory } = {}) {
  const t = normalizeForDetection(message);

  const mentionsNotifications = /\bnotificar/.test(t);

  const inheritsContext =
    !mentionsNotifications &&
    lastCategory === "notifications" &&
    /\bcate\b|\bce\b|\bcare\b/.test(t);

  if (!mentionsNotifications && !inheritsContext) return null;

  if (/necitit/.test(t)) return "UNREAD_COUNT";
  if (/noua|noi\b|recent/.test(t)) return "RECENT";

  return "UNREAD_COUNT";
}

export async function answerUserNotificationsQuestion({ userSub, message, lastCategory }) {
  if (!userSub) return null;

  const topic = detectUserNotificationsTopic(message, { lastCategory });
  if (!topic) return null;

  if (topic === "UNREAD_COUNT") {
    const count = await prisma.notification.count({
      where: { userId: userSub, readAt: null, archived: false },
    });

    return {
      resultType: "answer",
      topicId: "notifications",
      message:
        count === 0
          ? "Nu ai nicio notificare necitită momentan."
          : `Ai ${count === 1 ? "1 notificare necitită" : `${count} notificări necitite`}.`,
    };
  }

  if (topic === "RECENT") {
    const items = await prisma.notification.findMany({
      where: { userId: userSub, archived: false },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { title: true, body: true, readAt: true },
    });

    if (!items.length) {
      return {
        resultType: "answer",
        topicId: "notifications",
        message: "Nu ai nicio notificare momentan.",
      };
    }

    const lines = items.map(
      (n, i) => `${i + 1}. ${n.title || n.body || "Notificare"}${n.readAt ? "" : " (necitită)"}`
    );

    return {
      resultType: "answer",
      topicId: "notifications",
      message: `Cele mai recente notificări:\n\n${lines.join("\n")}`,
    };
  }

  return null;
}
