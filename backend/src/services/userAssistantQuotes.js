// backend/src/services/userAssistantQuotes.js
//
// USER BATCH 2 (audit USER, 2026-09-08) - serviciu SUBȚIRE, read-only,
// pentru întrebările unui cumpărător autentificat despre PROPRIILE
// cereri de ofertă ("câte cereri am", "care e ultima mea cerere",
// "am cereri noi/în discuție/cu ofertă trimisă/închise").
//
// NU duplică business logic - reutilizează EXACT statusurile reale
// din schema.prisma (QuoteRequestStatus: DRAFT/SUBMITTED/IN_DISCUSSION/
// OFFER_SENT/ACCEPTED/REJECTED/CANCELLED/EXPIRED), aceleași folosite de
// assistantQuotesRoutes.js (GET /me). Ownership IDENTIC: where: { userId }.
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

const QUOTE_STATUS_LABEL = {
  SUBMITTED: "trimise, în așteptare",
  IN_DISCUSSION: "în discuție",
  OFFER_SENT: "cu ofertă trimisă",
  ACCEPTED: "acceptate",
  REJECTED: "refuzate",
  CANCELLED: "anulate",
  EXPIRED: "expirate",
};

/*
 * Poartă STRICTĂ: doar întrebări despre cereri de ofertă proprii.
 * "lastCategory" permite unui follow-up eliptic să rămână pe domeniu.
 */
export function detectUserQuotesTopic(message, { lastCategory } = {}) {
  const t = normalizeForDetection(message);

  const mentionsQuotes = /\bcerer.*ofert|\bofert.*cerer|\bcerer.*pret|\bcerer.*oferta/.test(t);

  const inheritsContext =
    !mentionsQuotes &&
    lastCategory === "quotes" &&
    /\bcate\b|\bce\b|\bcare\b/.test(t);

  if (!mentionsQuotes && !inheritsContext) return null;

  if (/ultima/.test(t)) return "LAST";
  if (/inchis|finaliz/.test(t)) return "CLOSED";
  if (/noua|noi\b|netrimis|in asteptare/.test(t)) return "SUBMITTED";
  if (/discutie/.test(t)) return "IN_DISCUSSION";
  if (/oferta trimisa|primit.*oferta|raspuns/.test(t)) return "OFFER_SENT";

  return "TOTAL";
}

export async function answerUserQuotesQuestion({ userSub, message, lastCategory }) {
  if (!userSub) return null;

  const topic = detectUserQuotesTopic(message, { lastCategory });
  if (!topic) return null;

  const quotes = await prisma.quoteRequest.findMany({
    where: { userId: userSub },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      createdAt: true,
      product: { select: { title: true } },
      service: { select: { title: true, profile: { select: { displayName: true } } } },
    },
  });

  const targetLabel = (q) =>
    q.product?.title || q.service?.profile?.displayName || q.service?.title || "un magazin";

  if (topic === "LAST") {
    if (!quotes.length) {
      return {
        resultType: "answer",
        topicId: "quotes",
        message: "Nu ai nicio cerere de ofertă momentan.",
      };
    }
    const last = quotes[0];
    return {
      resultType: "answer",
      topicId: "quotes",
      message: `Ultima ta cerere de ofertă e pentru ${targetLabel(last)} - status: ${QUOTE_STATUS_LABEL[last.status] || last.status.toLowerCase()}.`,
    };
  }

  if (topic === "CLOSED") {
    const closed = quotes.filter((q) =>
      ["ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"].includes(q.status)
    );
    if (!closed.length) {
      return {
        resultType: "answer",
        topicId: "quotes",
        message: "Nu ai nicio cerere de ofertă închisă momentan.",
      };
    }
    const lines = closed.slice(0, 5).map((q, i) => `${i + 1}. ${targetLabel(q)} - ${QUOTE_STATUS_LABEL[q.status] || q.status.toLowerCase()}`);
    return {
      resultType: "answer",
      topicId: "quotes",
      message: `Ai ${closed.length === 1 ? "1 cerere închisă" : `${closed.length} cereri închise`}:\n\n${lines.join("\n")}`,
    };
  }

  const filtered = topic === "TOTAL" ? quotes : quotes.filter((q) => q.status === topic);

  if (!filtered.length) {
    return {
      resultType: "answer",
      topicId: "quotes",
      message:
        topic === "TOTAL"
          ? "Nu ai nicio cerere de ofertă momentan."
          : `Momentan nu ai cereri de ofertă ${QUOTE_STATUS_LABEL[topic] || topic.toLowerCase()}.`,
    };
  }

  const lines = filtered.slice(0, 5).map((q, i) => `${i + 1}. ${targetLabel(q)} - ${QUOTE_STATUS_LABEL[q.status] || q.status.toLowerCase()}`);
  const countPhrase = filtered.length === 1 ? "1 cerere de ofertă" : `${filtered.length} cereri de ofertă`;
  const heading =
    topic === "TOTAL"
      ? `Ai ${countPhrase} în total.`
      : `Ai ${countPhrase} ${QUOTE_STATUS_LABEL[topic] || topic.toLowerCase()}.`;

  return {
    resultType: "answer",
    topicId: "quotes",
    message: `${heading}\n\n${lines.join("\n")}`,
  };
}
