// backend/src/services/vendorAssistantMessages.js
//
// BATCH 2 (FINAL GAP PASS, 2026-09-07) - serviciu SUBȚIRE, read-only,
// pentru "Câte mesaje necitite am? / Ce conversații am necitite? /
// Cine mi-a scris ultima dată? / Ce conversații nu au răspuns?" puse
// de un vendor autentificat.
//
// Auditul inițial a găsit acest domeniu ca MISSING_LIVE_TOOL, auto-
// documentat chiar în messages.manifest.js: endpoint-urile
// unread-count și threads?scope=unread EXISTĂ (vendorMessageRoutes.js)
// dar nu erau conectate la Vendor Assistant. NU dublăm logica -
// numărul de necitite reutilizează EXACT `getVendorUnreadMessageCount`
// (extras din handler-ul rutei reale în vendorMessageRoutes.js, Batch
// 2 - un singur query, folosit de ambele).

import { prisma } from "../db.js";
import { getVendorUnreadMessageCount } from "../routes/vendorMessageRoutes.js";

function stripDiacritics(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ă/g, "a")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/ș|ş/g, "s")
    .replace(/ț|ţ/g, "t");
}

/*
 * Ordinea contează: "necitit" + "câte/număr" ÎNAINTE de "necitit"
 * generic (altfel "câte mesaje necitite am" ar fi prins de ramura de
 * listare, mai generică). "cine ... scris" și "nu au răspuns" nu se
 * suprapun cu nimic altceva din acest fișier.
 */
export function detectMessagesLiveTopic(message) {
  const t = stripDiacritics(message);

  /*
   * BUGFIX (verificat prin testare directă, Batch 2): "Cine mi-a scris
   * ultima dată?" nu conține deloc cuvântul "mesaj"/"conversație" -
   * poarta generală de mai jos nu trebuie să blocheze acest pattern
   * specific, altfel întrebarea nu ajunge NICIODATĂ la acest serviciu.
   */
  const mentionsLastSender = /cine.*scris|scris.*ultima/.test(t);

  if (!/mesaj|conversati/.test(t) && !mentionsLastSender) return null;

  if (/necitit/.test(t) && (/\bcate\b/.test(t) || /numar/.test(t))) {
    return "UNREAD_COUNT";
  }

  if (/necitit/.test(t)) return "UNREAD_THREADS";

  if (mentionsLastSender) return "LAST_SENDER";

  if (/nu\s*au\s*raspuns|fara\s*raspuns/.test(t)) {
    return "NO_REPLY";
  }

  return null;
}

const THREAD_BASE_WHERE = (vendorId) => ({
  type: "CUSTOMER",
  vendorId,
  archived: false,
  deletedByVendorAt: null,
});

function contactLabel(t) {
  const userName =
    t.user && [t.user.firstName, t.user.lastName].filter(Boolean).join(" ");
  return userName || t.contactName || "Client";
}

/*
 * Un thread "fără răspuns" = ultimul mesaj din el NU e al vânzătorului
 * - reutilizează exact `messages` (relația reală), fără niciun câmp
 * nou/derivat în DB.
 */
async function loadThreadsWithLastMessage(vendorId, limit = 20) {
  const threads = await prisma.messageThread.findMany({
    where: THREAD_BASE_WHERE(vendorId),
    orderBy: { lastAt: "desc" },
    take: limit,
    select: {
      id: true,
      contactName: true,
      lastAt: true,
      vendorLastReadAt: true,
      user: { select: { firstName: true, lastName: true } },
      messages: {
        where: { deletedByVendorAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { authorType: true, createdAt: true },
      },
    },
  });

  return threads.filter((t) => t.messages.length > 0);
}

/*
 * "Necitit" - definiția REALĂ (identică cu getVendorUnreadMessageCount/
 * scope=unread): ultimul mesaj e de la client ȘI a fost trimis DUPĂ
 * ultima citire a vânzătorului. Distinct de "fără răspuns" (NO_REPLY,
 * mai jos) - un thread poate fi CITIT, dar tot fără răspuns (vânzătorul
 * a văzut mesajul, nu a apucat încă să scrie înapoi) - nu sunt același
 * concept, chiar dacă se suprapun des în practică.
 */
function isThreadUnread(t) {
  const last = t.messages[0];
  if (last.authorType === "VENDOR") return false;
  const readAt = t.vendorLastReadAt ? new Date(t.vendorLastReadAt) : new Date(0);
  return new Date(last.createdAt) > readAt;
}

function isThreadUnanswered(t) {
  return t.messages[0].authorType !== "VENDOR";
}

export async function answerVendorMessagesQuestion({ vendorId, message }) {
  const topic = detectMessagesLiveTopic(message);
  if (!topic) return null;

  if (topic === "UNREAD_COUNT") {
    const count = await getVendorUnreadMessageCount(vendorId);

    if (!count) {
      return { message: "Nu ai niciun mesaj necitit momentan.", topic };
    }

    return {
      message:
        count === 1
          ? "Ai 1 mesaj necitit."
          : `Ai ${count} mesaje necitite.`,
      topic,
    };
  }

  if (topic === "UNREAD_THREADS") {
    const threads = await loadThreadsWithLastMessage(vendorId, 50);

    const unread = threads.filter(isThreadUnread);

    if (!unread.length) {
      return { message: "Nu ai nicio conversație necitită momentan.", topic };
    }

    const lines = unread
      .slice(0, 5)
      .map((t, i) => `${i + 1}. ${contactLabel(t)}`);

    const countPhrase =
      unread.length === 1 ? "1 conversație necitită" : `${unread.length} conversații necitite`;

    return {
      message: `Ai ${countPhrase}.\n\nCele mai recente:\n\n${lines.join("\n")}`,
      topic,
    };
  }

  if (topic === "LAST_SENDER") {
    const threads = await loadThreadsWithLastMessage(vendorId, 20);

    const lastFromCustomer = threads.find(isThreadUnanswered);

    if (!lastFromCustomer) {
      return {
        message: "Nu ai primit niciun mesaj de la un client recent.",
        topic,
      };
    }

    return {
      message: `Ultima persoană care ți-a scris este ${contactLabel(
        lastFromCustomer
      )}.`,
      topic,
    };
  }

  if (topic === "NO_REPLY") {
    const threads = await loadThreadsWithLastMessage(vendorId, 50);

    const needsReply = threads.filter(isThreadUnanswered);

    if (!needsReply.length) {
      return {
        message: "Nu ai nicio conversație fără răspuns momentan.",
        topic,
      };
    }

    const lines = needsReply
      .slice(0, 5)
      .map((t, i) => `${i + 1}. ${contactLabel(t)}`);

    const countPhrase =
      needsReply.length === 1
        ? "1 conversație fără răspuns"
        : `${needsReply.length} conversații fără răspuns`;

    return {
      message: `Ai ${countPhrase}.\n\n${lines.join("\n")}`,
      topic,
    };
  }

  return null;
}
