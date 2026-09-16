// backend/src/services/vendorAssistantSupport.js
//
// BATCH 2 (FINAL GAP PASS, 2026-09-07) - serviciu SUBȚIRE, read-only,
// pentru "A răspuns cineva la tichet? / Ce tichete sunt încă
// deschise/rezolvate? / Deschide ultimul tichet." puse de un vendor
// autentificat.
//
// NU duplică logica de business din vendorSupportRoutes.js -
// reutilizează ACELEAȘI câmpuri Prisma (SupportTicket.status/
// lastMessageAt/lastRequesterMessageAt) și ACEEAȘI definiție de
// ownership (requesterId = User.id al vendorului, NU Vendor.id -
// verificat direct în vendorSupportRoutes.js, GET /me/tickets:
// `where: { requesterId: user.id, audience: "VENDOR", ... }`).
//
// OWNERSHIP: `userSub` vine STRICT din auth/context server-side
// (copilotRouter.js), niciodată din body - identic cu restul
// domeniilor live. Niciun tichet al altui user/vendor nu poate fi
// citit - orice query e filtrat pe `requesterId: userSub`.
//
// "Deschide ultimul tichet" - NU există (verificat în
// assistantActionRegistry.js, OPEN_SUPPORT_TICKET e explicit STRICT
// pentru rolul USER, cu ruta /account/support/tickets/:ticketId - un
// VENDOR nu are o rută individuală de tichet, doar lista /vendor/
// support) - deci acest tool rezolvă tichetul REAL (id/subiect/status),
// dar ținta de navigare rămâne lista (VENDOR_SUPPORT), nu o rută
// inventată per-tichet.

import { prisma } from "../db.js";

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
 * Ordinea contează: "ultimul" (acțiune de navigare) ÎNAINTE de
 * "deschis" generic - "Deschide ultimul tichet" conține și rădăcina
 * "deschi*" (verbul "deschide"), care s-ar suprapune altfel cu "Ce
 * tichete sunt încă deschise?" (adjectiv, stare). "răspuns" nu se
 * suprapune cu nimic altceva de aici.
 */
export function detectSupportLiveTopic(message) {
  const t = stripDiacritics(message);

  if (!/tichet/.test(t)) return null;

  if (/ultimul/.test(t)) return "OPEN_LAST_TICKET";

  if (/raspuns/.test(t) && /cineva|admin|suport|echipa/.test(t)) {
    return "HAS_REPLY";
  }

  if (/rezolvat|inchis|closed/.test(t)) return "RESOLVED_TICKETS";

  if (/deschis/.test(t)) return "OPEN_TICKETS";

  return null;
}

const TICKET_BASE_WHERE = (userSub) => ({
  requesterId: userSub,
  audience: "VENDOR",
  deletedAt: null,
});

function hasAdminReplySince(ticket) {
  if (!ticket.lastRequesterMessageAt) {
    /*
     * Niciun mesaj de la vendor încă înregistrat separat (tichet
     * foarte vechi, dinainte de acest câmp) - considerăm că orice
     * mesaj mai nou decât creare e răspuns, cazul e rar/istoric.
     */
    return false;
  }

  return (
    new Date(ticket.lastMessageAt) > new Date(ticket.lastRequesterMessageAt)
  );
}

/*
 * Punct de intrare unic pentru copilotRouter.js. Întoarce `null` dacă
 * mesajul NU ține de acest domeniu (apelantul cade pe comportamentul
 * existent, neschimbat - triajul general de suport, supportEscalationService.js).
 */
export async function answerVendorSupportQuestion({ userSub, message }) {
  const topic = detectSupportLiveTopic(message);
  if (!topic) return null;

  if (topic === "HAS_REPLY" || topic === "OPEN_LAST_TICKET") {
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
      return { message: "Nu ai niciun tichet de suport momentan.", topic };
    }

    if (topic === "HAS_REPLY") {
      const replied = hasAdminReplySince(ticket);

      return {
        message: replied
          ? `Da - ai un răspuns nou la tichetul „${ticket.subject}".`
          : `Nu încă - ultimul mesaj din tichetul „${ticket.subject}" este al tău, așteaptă un răspuns.`,
        topic,
        ticketId: ticket.id,
      };
    }

    const statusLabel =
      ticket.status === "CLOSED"
        ? "rezolvat"
        : ticket.status === "PENDING"
          ? "în așteptare"
          : "deschis";

    return {
      message: `Ultimul tău tichet este „${ticket.subject}" (status: ${statusLabel}). Nu există o pagină individuală pentru un tichet de vânzător - îl găsești în lista de tichete.`,
      topic,
      ticketId: ticket.id,
      actionTarget: "VENDOR_SUPPORT",
    };
  }

  if (topic === "OPEN_TICKETS" || topic === "RESOLVED_TICKETS") {
    const statusFilter =
      topic === "OPEN_TICKETS" ? { in: ["OPEN", "PENDING"] } : "CLOSED";

    const total = await prisma.supportTicket.count({
      where: { ...TICKET_BASE_WHERE(userSub), status: statusFilter },
    });

    const labelPlural = topic === "OPEN_TICKETS" ? "deschise" : "rezolvate";
    const labelSingular = topic === "OPEN_TICKETS" ? "deschis" : "rezolvat";

    if (!total) {
      return {
        message: `Nu ai niciun tichet ${labelSingular} momentan.`,
        topic,
      };
    }

    const tickets = await prisma.supportTicket.findMany({
      where: { ...TICKET_BASE_WHERE(userSub), status: statusFilter },
      orderBy: { lastMessageAt: "desc" },
      take: 5,
      select: { subject: true },
    });

    const lines = tickets.map((t, i) => `${i + 1}. ${t.subject}`);
    const countPhrase =
      total === 1 ? `1 tichet ${labelSingular}` : `${total} tichete ${labelPlural}`;

    return {
      message: `Ai ${countPhrase}.\n\n${lines.join("\n")}`,
      topic,
    };
  }

  return null;
}
