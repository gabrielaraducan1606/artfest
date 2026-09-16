// backend/src/services/userAssistantMessages.js
//
// USER BATCH 2 (audit USER, 2026-09-08) - serviciu SUBȚIRE, read-only,
// pentru întrebările unui cumpărător autentificat despre PROPRIILE
// mesaje/conversații ("câte mesaje necitite am", "ce conversații sunt
// necitite", "cine mi-a scris ultima dată", "care este ultima
// conversație", "ce conversații nu au răspuns").
//
// NU duplică business logic - reutilizează EXACT query-urile din
// userMessagesRoutes.js (GET /unread-count, GET /threads): aceleași
// câmpuri (userLastReadAt, archivedByUser, deletedByUserAt), ownership
// IDENTIC (where: { userId }).
//
// Ownership STRICT: userId vine din req.user.sub (server-side, prin
// copilotRouter.js), NICIODATĂ din mesajul liber al userului.

import { prisma } from "../db.js";

function normalizeForDetection(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/*
 * Poartă STRICTĂ: doar întrebări despre mesaje/conversații proprii.
 * "lastCategory" permite unui follow-up eliptic ("Câte sunt necitite?"
 * după "Cum văd mesajele?") să rămână pe acest domeniu.
 */
export function detectUserMessagesTopic(message, { lastCategory } = {}) {
  const t = normalizeForDetection(message);

  const mentionsMessages = /\bmesaj|\bconversat|\bexpeditor/.test(t);

  const inheritsContext =
    !mentionsMessages &&
    lastCategory === "messages" &&
    /\bcate\b|\bce\b|\bcare\b|\bcine\b/.test(t);

  if (!mentionsMessages && !inheritsContext) return null;

  if (/necitit/.test(t)) {
    if (/conversat/.test(t)) return "UNREAD_THREADS";
    return "UNREAD_COUNT";
  }

  if (/cine.*scris|ultimul.*expeditor|expeditor/.test(t)) return "LAST_SENDER";
  if (/ultima.*conversat/.test(t)) return "LAST_THREAD";
  if (/fara.*raspuns|nu.*raspuns/.test(t)) return "NO_REPLY";

  return null;
}

export async function answerUserMessagesQuestion({ userSub, message, lastCategory }) {
  if (!userSub) return null;

  const topic = detectUserMessagesTopic(message, { lastCategory });
  if (!topic) return null;

  if (topic === "UNREAD_COUNT") {
    const rows = await prisma.$queryRaw`
      SELECT COUNT(m.*)::int as "count"
      FROM "MessageThread" t
      JOIN "Message" m ON m."threadId" = t.id
      WHERE t."userId" = ${userSub}
        AND t."archivedByUser" = false
        AND t."deletedByUserAt" IS NULL
        AND m."deletedByUserAt" IS NULL
        AND m."authorType" <> 'USER'
        AND m."createdAt" > COALESCE(t."userLastReadAt", to_timestamp(0))
    `;
    const count = rows?.[0]?.count ?? 0;

    return {
      resultType: "answer",
      topicId: "messages",
      message:
        count === 0
          ? "Nu ai niciun mesaj necitit momentan."
          : `Ai ${count === 1 ? "1 mesaj necitit" : `${count} mesaje necitite`}.`,
    };
  }

  const threads = await prisma.messageThread.findMany({
    where: {
      userId: userSub,
      deletedByUserAt: null,
      archivedByUser: false,
    },
    orderBy: [{ lastAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      contactName: true,
      lastMsg: true,
      lastAt: true,
      userLastReadAt: true,
      service: {
        select: { profile: { select: { displayName: true } } },
      },
    },
  });

  const vendorLabel = (t) =>
    t.service?.profile?.displayName || t.contactName || "un vânzător";

  if (topic === "UNREAD_THREADS") {
    const unread = threads.filter(
      (t) => !t.userLastReadAt || t.lastAt > t.userLastReadAt
    );

    if (!unread.length) {
      return {
        resultType: "answer",
        topicId: "messages",
        message: "Nu ai nicio conversație necitită momentan.",
      };
    }

    const lines = unread
      .slice(0, 5)
      .map((t, i) => `${i + 1}. ${vendorLabel(t)}`);

    return {
      resultType: "answer",
      topicId: "messages",
      message: `Ai ${unread.length === 1 ? "1 conversație necitită" : `${unread.length} conversații necitite`}:\n\n${lines.join("\n")}`,
    };
  }

  if (topic === "LAST_SENDER" || topic === "LAST_THREAD") {
    if (!threads.length) {
      return {
        resultType: "answer",
        topicId: "messages",
        message: "Nu ai nicio conversație momentan.",
      };
    }

    const last = threads[0];

    return {
      resultType: "answer",
      topicId: "messages",
      message: `Ultima conversație e cu ${vendorLabel(last)}${
        last.lastMsg ? ` - „${String(last.lastMsg).slice(0, 80)}”` : ""
      }.`,
    };
  }

  if (topic === "NO_REPLY") {
    /*
     * "Fără răspuns" - determinist: ultimul mesaj al firului a fost al
     * userului (nu al vânzătorului), deci userul așteaptă un răspuns.
     * Verificăm direct pe Message.authorType, nu presupunem din
     * userLastReadAt (acela ține de CITIRE, nu de CINE a scris ultimul).
     */
    const withLastMessage = await prisma.messageThread.findMany({
      where: {
        userId: userSub,
        deletedByUserAt: null,
        archivedByUser: false,
      },
      orderBy: [{ lastAt: "desc" }],
      take: 50,
      select: {
        id: true,
        contactName: true,
        service: { select: { profile: { select: { displayName: true } } } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { authorType: true },
        },
      },
    });

    const noReply = withLastMessage.filter(
      (t) => t.messages?.[0]?.authorType === "USER"
    );

    if (!noReply.length) {
      return {
        resultType: "answer",
        topicId: "messages",
        message: "Nu am găsit conversații în care să aștepți încă un răspuns.",
      };
    }

    const lines = noReply
      .slice(0, 5)
      .map((t, i) => `${i + 1}. ${vendorLabel(t)}`);

    return {
      resultType: "answer",
      topicId: "messages",
      message: `Ai ${noReply.length === 1 ? "1 conversație" : `${noReply.length} conversații`} fără răspuns încă:\n\n${lines.join("\n")}`,
    };
  }

  return null;
}
