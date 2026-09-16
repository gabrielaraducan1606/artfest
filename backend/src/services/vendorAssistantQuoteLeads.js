// backend/src/services/vendorAssistantQuoteLeads.js
//
// BATCH 3 (audit regression Vendor Assistant, 2026-09-06) - serviciu SUBȚIRE,
// read-only, pentru întrebările de tip "câte cereri de ofertă am / ce cereri
// sunt noi / în discuții / pierdute / cu ofertă trimisă" puse de un vendor
// autentificat.
//
// NU duplică logica de business din vendorQuotesRoutes.js sau
// vendorMessageRoutes.js - reutilizează ACELAȘI câmp Prisma (
// MessageThread.leadStatus, enum LeadStatus: NEW/IN_DISCUSSION/OFFER_SENT/
// RESERVED/LOST) deja folosit de PATCH /api/inbox/threads/:id/meta-advanced
// și de GET /api/inbox/threads?status=... (vendorMessageRoutes.js).
//
// Scop STRICT: cereri de ofertă (thread-uri cu QuoteRequest asociat), NU
// orice conversație cu un client - un thread simplu de mesaje, fără cerere
// de ofertă, are și el leadStatus (implicit NEW), dar nu e o "cerere de
// ofertă" în sensul întrebării, deci filtrăm explicit pe
// `quoteRequest: { isNot: null }`.

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
 * Ordinea contează: verificăm întâi "pierdut"/"rezervat" (semnale
 * neambigue), apoi "fără răspuns"/"nu au răspuns" (= NEW) ÎNAINTE de
 * verificarea generică "răspuns" (care altfel ar prinde greșit și
 * negația), apoi "noi", apoi "trimisă" (ofertă trimisă), apoi
 * "discuții"/"răspuns" generic (= IN_DISCUSSION - "cereri la care am
 * răspuns" e inerent ambiguu între IN_DISCUSSION și OFFER_SENT; alegem
 * IN_DISCUSSION ca interpretare principală, documentat aici), apoi
 * "câte"/"număr" generic (= total). Orice altă formulare despre cereri/
 * oferte care NU e o cerere de numărare/listare (ex. "cum trimit o
 * ofertă", "pot negocia") întoarce `null` - acelea sunt STATIC knowledge,
 * răspunse din manifest, nu de acest serviciu.
 */
export function detectQuoteLeadTopic(message) {
  const t = stripDiacritics(message);

  if (!/cerer|oferta|oferte/.test(t)) return null;

  /*
   * BUGFIX (auto-identificat de sesiunea de audit, 2026-09-06):
   * "Pot marca o cerere ca rezervată?" / "Cum schimb statusul unei
   * cereri?" conțin cuvinte-status ("rezervat"), dar sunt întrebări
   * STATICE despre CAPACITATE/mecanism ("pot"/"cum" + acțiune), nu
   * cereri de numărare/listare - trebuie să cadă pe manifest, nu să
   * fie interceptate aici. Le distingem de "Cum văd cererile
   * pierdute?" (tot are "cum", dar e clar o cerere de listare) prin
   * prezența unui semnal explicit de listare/numărare ("vad"/"vezi"/
   * "cate"/"numar") - fără el, o formulare gen "pot"/"cum ... unei
   * cereri" rămâne STATIC.
   */
  const looksLikeHowToOrCapability = /\bpot\b|\bpotem\b|\bse poate\b/.test(t);
  const looksLikeCountOrList = /\bcate\b|numar|\bvad\b|\bvezi\b/.test(t);

  if (looksLikeHowToOrCapability && !looksLikeCountOrList) return null;

  if (/pierdut/.test(t)) return "LOST";
  if (/rezervat/.test(t)) return "RESERVED";
  if (/nu\s*au\s*raspuns|fara\s*raspuns|neraspuns/.test(t)) return "NEW";
  if (/\bnoi\b/.test(t)) return "NEW";
  if (/trimis/.test(t)) return "OFFER_SENT";
  if (/discuti/.test(t) || /raspuns/.test(t)) return "IN_DISCUSSION";
  if (/\bcate\b|numar/.test(t)) return "TOTAL";

  return null;
}

const STATUS_LABEL = {
  NEW: "noi (fără răspuns)",
  IN_DISCUSSION: "în discuții",
  OFFER_SENT: "cu ofertă trimisă",
  RESERVED: "rezervate",
  LOST: "pierdute",
  TOTAL: "în total",
};

async function loadQuoteLeadThreads(vendorId, status, limit = 5) {
  return prisma.messageThread.findMany({
    where: {
      vendorId,
      type: "CUSTOMER",
      deletedByVendorAt: null,
      quoteRequest: { isNot: null },
      ...(status && status !== "TOTAL" ? { leadStatus: status } : {}),
    },
    orderBy: { lastAt: "desc" },
    take: limit,
    select: {
      id: true,
      contactName: true,
      user: { select: { firstName: true, lastName: true } },
      quoteRequest: {
        select: {
          product: { select: { title: true } },
        },
      },
    },
  });
}

function formatThreadLine(t, index) {
  const name =
    (t.user && [t.user.firstName, t.user.lastName].filter(Boolean).join(" ")) ||
    t.contactName ||
    "Client";
  const product = t.quoteRequest?.product?.title;
  return `${index + 1}. ${name}${product ? ` - ${product}` : ""}`;
}

/*
 * Punct de intrare unic pentru copilotRouter.js. Întoarce `null` dacă
 * mesajul NU e o întrebare de numărare/listare a cererilor de ofertă
 * (apelantul cade pe comportamentul existent, neschimbat).
 */
export async function answerVendorQuoteLeadQuestion({ vendorId, message }) {
  const status = detectQuoteLeadTopic(message);
  if (!status) return null;

  const total = await prisma.messageThread.count({
    where: {
      vendorId,
      type: "CUSTOMER",
      deletedByVendorAt: null,
      quoteRequest: { isNot: null },
      ...(status !== "TOTAL" ? { leadStatus: status } : {}),
    },
  });

  const label = STATUS_LABEL[status];

  if (!total) {
    return {
      message: `Nu ai nicio cerere de ofertă ${label} momentan.`,
      status,
    };
  }

  const threads = await loadQuoteLeadThreads(vendorId, status);
  const lines = threads.map(formatThreadLine);

  const countPhrase = total === 1 ? "1 cerere de ofertă" : `${total} cereri de ofertă`;

  const heading =
    status === "TOTAL"
      ? `Ai ${countPhrase} în total.`
      : `Ai ${countPhrase} ${label}.`;

  return {
    message:
      lines.length ? `${heading}\n\nCele mai recente:\n\n${lines.join("\n")}` : heading,
    status,
  };
}
