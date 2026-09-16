// backend/src/services/userAssistantSupport.js
//
// USER BATCH 2 (audit USER, 2026-09-08) - serviciu SUBȚIRE, read-only,
// pentru "Câte tichete am? / Ce tichete sunt deschise-rezolvate? / A
// răspuns cineva? / Deschide ultimul meu tichet." puse de un cumpărător
// autentificat.
//
// NU duplică business logic - mirror EXACT al vendorAssistantSupport.js
// (același model SupportTicket, aceeași logică hasAdminReplySince), dar
// pentru audience: "USER" - ownership IDENTIC cu assistantUserSupportRoutes.js
// (GET /me/tickets): where: { requesterId: user.id, audience: "USER",
// deletedAt: null, archivedByRequesterAt: null }.
//
// OWNERSHIP: userSub vine STRICT din auth/context server-side
// (copilotRouter.js), niciodată din mesajul liber - niciun tichet al
// altui user nu poate fi citit.
//
// CTA: spre diferență de VENDOR (care nu are pagină individuală de
// tichet - vezi vendorAssistantSupport.js), pentru USER EXISTĂ o rută
// reală per-tichet (OPEN_SUPPORT_TICKET -> /account/support/tickets/:id,
// confirmată în assistantActionRegistry.js). Nu construim aici un câmp
// de acțiune nou (pipeline-ul de răspuns al acestui tool nu are un
// canal de CTA structurat - vezi handleVendorSupportLiveQuery, care
// aruncă la fel actionTarget) - menționăm doar TEXTUAL, onest, unde se
// găsește tichetul, fără să inventăm vreo rută nouă.

import { prisma } from "../db.js";

function normalizeForDetection(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const TICKET_BASE_WHERE = (userSub) => ({
  requesterId: userSub,
  audience: "USER",
  deletedAt: null,
  archivedByRequesterAt: null,
});

function hasAdminReplySince(ticket) {
  if (!ticket.lastRequesterMessageAt) return false;
  return new Date(ticket.lastMessageAt) > new Date(ticket.lastRequesterMessageAt);
}

export function detectUserSupportTopic(message, { lastCategory } = {}) {
  const t = normalizeForDetection(message);

  const mentionsTicket = /\btichet/.test(t);

  const inheritsContext =
    !mentionsTicket &&
    lastCategory === "support" &&
    /\bcate\b|\bce\b|\bcare\b/.test(t);

  if (!mentionsTicket && !inheritsContext) return null;

  /*
   * BUGFIX (audit USER, 2026-09-08) - fixul pentru misclasificarea
   * "tichet -> ORDER_HELP" (aprobat de user) cere ca acest detector să
   * intercepteze STRICT status/listare pe tichete EXISTENTE, nu orice
   * mențiune a cuvântului "tichet" - o mențiune goală ("Deschide un
   * tichet.", "Vreau un tichet nou.") NU are niciun semnal explicit de
   * mai jos și trebuie să cadă pe fluxul normal de creare/triaj (vezi
   * return null la final), altfel am fi capturat greșit exact genul de
   * frază pe care userul a cerut explicit să NU fie prinsă.
   */
  if (/ultimul/.test(t)) return "LAST_TICKET";
  if (/statusul|\bstatus\b/.test(t)) return "LAST_TICKET";

  if (/raspuns/.test(t) && /cineva|admin|suport|echipa/.test(t)) {
    return "HAS_REPLY";
  }

  if (/rezolvat|inchis/.test(t)) return "RESOLVED_TICKETS";
  if (/deschis/.test(t)) return "OPEN_TICKETS";
  if (/\bcate\b/.test(t)) return "TOTAL";

  return null;
}

export async function answerUserSupportQuestion({ userSub, message, lastCategory }) {
  if (!userSub) return null;

  const topic = detectUserSupportTopic(message, { lastCategory });
  if (!topic) return null;

  if (topic === "LAST_TICKET" || topic === "HAS_REPLY") {
    const ticket = await prisma.supportTicket.findFirst({
      where: TICKET_BASE_WHERE(userSub),
      orderBy: { lastMessageAt: "desc" },
      select: {
        id: true,
        subject: true,
        status: true,
        lastMessageAt: true,
        lastRequesterMessageAt: true,
      },
    });

    if (!ticket) {
      return {
        resultType: "answer",
        topicId: "support",
        message: "Nu ai niciun tichet de suport momentan.",
      };
    }

    if (topic === "HAS_REPLY") {
      const replied = hasAdminReplySince(ticket);
      return {
        resultType: "answer",
        topicId: "support",
        message: replied
          ? `Da - ai un răspuns nou la tichetul „${ticket.subject}”.`
          : `Nu încă - ultimul mesaj din tichetul „${ticket.subject}” este al tău, așteaptă un răspuns.`,
      };
    }

    const statusLabel =
      ticket.status === "CLOSED"
        ? "rezolvat"
        : ticket.status === "PENDING"
          ? "în așteptare"
          : "deschis";

    return {
      resultType: "answer",
      topicId: "support",
      message: `Ultimul tău tichet este „${ticket.subject}” (status: ${statusLabel}). Îl găsești în secțiunea Suport a contului tău.`,
    };
  }

  const statusFilter =
    topic === "OPEN_TICKETS"
      ? { in: ["OPEN", "PENDING"] }
      : topic === "RESOLVED_TICKETS"
        ? "CLOSED"
        : undefined;

  const total = await prisma.supportTicket.count({
    where: { ...TICKET_BASE_WHERE(userSub), ...(statusFilter ? { status: statusFilter } : {}) },
  });

  const labelPlural =
    topic === "OPEN_TICKETS" ? "deschise" : topic === "RESOLVED_TICKETS" ? "rezolvate" : null;
  const labelSingular =
    topic === "OPEN_TICKETS" ? "deschis" : topic === "RESOLVED_TICKETS" ? "rezolvat" : null;

  if (!total) {
    return {
      resultType: "answer",
      topicId: "support",
      message: labelSingular
        ? `Nu ai niciun tichet ${labelSingular} momentan.`
        : "Nu ai niciun tichet de suport momentan.",
    };
  }

  const tickets = await prisma.supportTicket.findMany({
    where: { ...TICKET_BASE_WHERE(userSub), ...(statusFilter ? { status: statusFilter } : {}) },
    orderBy: { lastMessageAt: "desc" },
    take: 5,
    select: { subject: true },
  });

  const lines = tickets.map((t, i) => `${i + 1}. ${t.subject}`);
  const countPhrase = labelSingular
    ? total === 1
      ? `1 tichet ${labelSingular}`
      : `${total} tichete ${labelPlural}`
    : total === 1
      ? "1 tichet de suport"
      : `${total} tichete de suport`;

  return {
    resultType: "answer",
    topicId: "support",
    message: `Ai ${countPhrase}${labelSingular ? "" : " în total"}.\n\n${lines.join("\n")}`,
  };
}
