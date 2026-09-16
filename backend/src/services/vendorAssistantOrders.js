// backend/src/services/vendorAssistantOrders.js
//
// BATCH 4 (audit regression Vendor Assistant, 2026-09-06) - serviciu SUBȚIRE,
// read-only, pentru întrebările de tip "câte comenzi am / ce comenzi sunt
// noi / în lucru / așteaptă expedierea / livrate / anulate / plătite" puse
// de un vendor autentificat.
//
// NU duplică logica de business din vendorOrdersRoutes.js - reutilizează
// ACELEAȘI câmpuri Prisma (Shipment.status, Order.paymentMethod/status/
// paidAt) și ACEEAȘI granularitate de status pe care vendorul o vede deja
// în /vendor/orders (Orders.jsx): nouă/în pregătire/confirmată (gata de
// predare)/predată curierului/finalizată/anulată - vezi PATCH
// /orders/:id/status din vendorOrdersRoutes.js (mapping "new"/"preparing"/
// "confirmed"/"shipped"/"fulfilled"/"cancelled" -> shipment.status).
//
// Scop STRICT: numărare/listare comenzi după status - NU comenzi/câștiguri
// din alte domenii (statistici de trafic, cereri de ofertă), NU acțiuni
// (marcare expediată etc, alea rămân STATIC, în manifest).

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
 * Poartă STRICTĂ: doar întrebări de forma "ce comenzi ..."/"câte comenzi
 * ...". Orice întrebare "cum .../pot ... O COMANDĂ" (acțiune pe o singură
 * comandă - marchez expediată, anulez, pregătesc) NU trece de poartă,
 * chiar dacă menționează un cuvânt de status ("Cum marchez o comandă ca
 * expediată?" conține "expediat", dar nu e o cerere de listare) - acelea
 * sunt STATIC, răspunse din manifest, nu de acest serviciu.
 *
 * BATCH 1 (FINAL GAP PASS, 2026-09-07) - `lastCategory` opțional (round-
 * tripped de client, vezi copilotRouter.js) permite unui follow-up
 * ELIPTIC care a pierdut cuvântul "comenzi" ("Unde văd comenzile?" ->
 * "Câte sunt noi?") să rămână pe acest domeniu, DAR STRICT dacă:
 * (a) conversația era deja despre "orders" (lastCategory==="orders"),
 * (b) mesajul curent NU conține deja alt cuvânt de domeniu (comenzi
 *     rămâne poarta normală, neschimbată, dacă e prezent), ȘI
 * (c) mesajul are forma clară de întrebare de numărare/listare
 *     ("câte"/"ce" + "sunt"/"am") - nu orice mesaj scurt după o tură
 *     despre comenzi (ex. "Da" sau "Anulează-o" nu trebuie interceptate
 *     aici). Router-ul (copilotRouter.js) e cel care decide CÂND trimite
 *     lastCategory - acest fișier rămâne "pur" (nu citește conversația
 *     singur, doar primește hint-ul explicit).
 */
export function detectOrderLiveTopic(message, { lastCategory } = {}) {
  const t = stripDiacritics(message);

  const isOrdersListingQuestion = /\bce\s+comenzi\b|\bcate\s+comenzi\b/.test(t);

  const inheritsOrdersContext =
    !isOrdersListingQuestion &&
    lastCategory === "orders" &&
    /\bcate\b|\bce\b/.test(t) &&
    /\bsunt\b|\bam\b/.test(t);

  if (!isOrdersListingQuestion && !inheritsOrdersContext) return null;

  if (/\bnoi\b/.test(t)) return "NEW";
  if (/lucru/.test(t)) return "PREPARING";
  if (/asteapta.*exped|gata.*exped|gata.*predare/.test(t)) return "AWAITING_SHIP";
  if (/livrat|finalizat/.test(t)) return "DELIVERED";
  if (/anulat/.test(t)) return "CANCELLED";
  if (/platit/.test(t)) return "PAID";
  if (/exped|trimis/.test(t)) return "SHIPPED";

  return "TOTAL";
}

const STATUS_LABEL = {
  NEW: "noi (fără procesare începută)",
  PREPARING: "în lucru (în pregătire)",
  AWAITING_SHIP: "gata, în așteptarea predării către curier",
  SHIPPED: "predate curierului",
  DELIVERED: "livrate",
  CANCELLED: "anulate",
  PAID: "plătite cu cardul",
  TOTAL: "în total",
};

/*
 * Confirmat în vendorOrdersRoutes.js (PATCH /orders/:id/status) și
 * userOrdersRoutes.js (computeUiStatus): granularitatea REALĂ pe care
 * vendorul o vede în /vendor/orders, pe shipment.status - NU statusul
 * simplificat afișat clientului (computeUiStatus, care grupează
 * PREPARING/READY_FOR_PICKUP/PICKUP_SCHEDULED laolaltă sub "PROCESSING").
 */
function shipmentStatusFilterFor(topic) {
  switch (topic) {
    case "NEW":
      return { status: "PENDING" };
    case "PREPARING":
      return { status: "PREPARING" };
    case "AWAITING_SHIP":
      return { status: { in: ["READY_FOR_PICKUP", "PICKUP_SCHEDULED"] } };
    case "SHIPPED":
      return { status: { in: ["AWB", "IN_TRANSIT"] } };
    case "DELIVERED":
      return { status: "DELIVERED" };
    case "CANCELLED":
      return { status: { in: ["REFUSED", "RETURNED"] } };
    case "PAID":
      return {
        order: {
          paymentMethod: "CARD",
          OR: [{ status: "PAID" }, { paidAt: { not: null } }],
        },
      };
    case "TOTAL":
    default:
      return {};
  }
}

/*
 * BATCH 2 (FINAL GAP PASS, 2026-09-07) - scop de dată OPȚIONAL. Spre
 * diferență de vendorAssistantAnalytics.js/vendorAssistantPayments.js
 * (care AU deja interval de dată, "azi"/"luna asta"/"luna trecută"),
 * acest fișier nu avea NICIUN filtru temporal - audit confirmat,
 * PRODUCT_FEATURE_MISSING: "Câte comenzi am avut luna asta?" întorcea
 * silențios totalul din toate timpurile, fără avertisment. Întoarce
 * `null` dacă mesajul NU menționează o perioadă - comportamentul
 * existent (lifetime, neschimbat) rămâne IDENTIC, fără regresie.
 */
function resolveOrderDateRange(t) {
  const now = new Date();

  if (/luna\s*trecut/.test(t)) {
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
    );
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from, to, label: "luna trecută" };
  }

  if (/luna\s*asta|luna\s*aceasta/.test(t)) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );
    return { from, to, label: "luna asta" };
  }

  if (/\bazi\b|\bastazi\b/.test(t)) {
    const from = new Date(now.toISOString().slice(0, 10) + "T00:00:00.000Z");
    return { from, to: now, label: "azi" };
  }

  return null;
}

function dateRangeFilter(dateRange) {
  if (!dateRange) return {};
  return { createdAt: { gte: dateRange.from, lt: dateRange.to } };
}

async function loadOrderLines(vendorId, topic, dateRange, limit = 5) {
  return prisma.shipment.findMany({
    where: {
      vendorId,
      ...shipmentStatusFilterFor(topic),
      ...dateRangeFilter(dateRange),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      order: { select: { orderNumber: true } },
    },
  });
}

function formatOrderLine(s, index) {
  const label = s.order?.orderNumber || `#${String(s.id).slice(-6).toUpperCase()}`;
  return `${index + 1}. Comanda ${label}`;
}

/*
 * Punct de intrare unic pentru copilotRouter.js. Întoarce `null` dacă
 * mesajul NU e o întrebare de numărare/listare a comenzilor (apelantul
 * cade pe comportamentul existent, neschimbat).
 */
export async function answerVendorOrderLiveQuestion({ vendorId, message, lastCategory }) {
  const topic = detectOrderLiveTopic(message, { lastCategory });
  if (!topic) return null;

  const dateRange = resolveOrderDateRange(stripDiacritics(message));

  const total = await prisma.shipment.count({
    where: {
      vendorId,
      ...shipmentStatusFilterFor(topic),
      ...dateRangeFilter(dateRange),
    },
  });

  const label = STATUS_LABEL[topic];
  const periodSuffix = dateRange ? ` ${dateRange.label}` : "";

  if (!total) {
    return {
      message:
        topic === "TOTAL"
          ? `Nu ai avut nicio comandă${periodSuffix || " momentan"}.`
          : `Momentan nu ai comenzi ${label}${periodSuffix}.`,
      topic,
    };
  }

  const lines = (await loadOrderLines(vendorId, topic, dateRange)).map(
    formatOrderLine
  );
  const countPhrase = total === 1 ? "1 comandă" : `${total} comenzi`;

  const heading =
    topic === "TOTAL"
      ? `Ai ${countPhrase}${periodSuffix || " în total"}.`
      : `Ai ${countPhrase} ${label}${periodSuffix}.`;

  return {
    message: lines.length ? `${heading}\n\nCele mai recente:\n\n${lines.join("\n")}` : heading,
    topic,
  };
}
