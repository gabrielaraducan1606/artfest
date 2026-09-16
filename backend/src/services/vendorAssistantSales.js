// backend/src/services/vendorAssistantSales.js
//
// BATCH 2 (FINAL GAP PASS, 2026-09-07) - serviciu SUBȚIRE, read-only,
// pentru "Cât am vândut luna asta/trecută? / Care sunt cele mai
// vândute produse? / Ce produse nu s-au vândut?" puse de un vendor
// autentificat.
//
// Auditul inițial a găsit acest domeniu ca MISSING_LIVE_TOOL, cu
// cauza exactă identificată: vendorAssistantAnalytics.js (vizite/
// vizualizări) NU e o sursă validă pentru "vânzări" - urmărește STRICT
// PAGEVIEW-uri, nu tranzacții reale. Sursele REALE, alese după
// verificare directă în schema.prisma:
// - vânzări BRUTE (gross): VendorEarningEntry.itemsNet (type SALE) -
//   EXACT valoarea articolelor vândute, ÎNAINTE de comision -
//   deliberat distinctă de vendorNet (folosit de
//   vendorAssistantPayments.js pentru "cât am câștigat", care e NET,
//   după comision) - cerința explicită a auditului: nu confunda
//   sales/gross cu earnings/profit. Reutilizează `monthRange`/`round2`
//   din vendorAssistantPayments.js (exportate în acest batch), fără
//   duplicare de matematică de dată.
// - produse cele mai/deloc vândute: ShipmentItem (productId, qty),
//   agregat pe shipment-urile vendorului - NU pe VendorEarningEntry
//   (acela e per-shipment, nu are granularitate de produs). Exclude
//   shipment-urile REFUSED/RETURNED (anulate/returnate - nu reprezintă
//   o vânzare reală), la fel ca restul domeniului "orders".

import { prisma } from "../db.js";
import { monthRange, round2 } from "./vendorAssistantPayments.js";

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
 * Ordinea contează: "vândut" + "trecut" ÎNAINTE de "vândut" generic
 * (implicit luna asta), la fel ca în vendorAssistantPayments.js.
 * "cele mai vândute"/"nu s-au vândut" nu se suprapun cu nimic din
 * vendorAssistantAnalytics.js (acela cere "vizualiz/vazut/populare",
 * niciodată "vandut").
 */
export function detectSalesLiveTopic(message) {
  const t = stripDiacritics(message);

  if (/vandut/.test(t) && /trecut/.test(t)) {
    return "GROSS_SOLD_LAST_MONTH";
  }

  if (/vandut/.test(t) && (/\bcat\b/.test(t) || /luna asta/.test(t))) {
    return "GROSS_SOLD_THIS_MONTH";
  }

  if (/cele mai vandute|mai vandute produse|top produse vandute/.test(t)) {
    return "TOP_SELLING_PRODUCTS";
  }

  if (/nu\s*s-?au\s*vandut|nu\s*au\s*vandut|niciodata\s*vandut/.test(t)) {
    return "UNSOLD_PRODUCTS";
  }

  return null;
}

/*
 * Shipment-uri care reprezintă o vânzare REALĂ - exclude anulările/
 * returnările, la fel cum face deja domeniul "orders" (CANCELLED ->
 * REFUSED/RETURNED, vezi vendorAssistantOrders.js).
 */
const SOLD_SHIPMENT_STATUS_FILTER = {
  status: { notIn: ["REFUSED", "RETURNED"] },
};

async function sumGrossSoldForMonth(vendorId, offsetMonths) {
  const { from, to } = monthRange(offsetMonths);

  const entries = await prisma.vendorEarningEntry.findMany({
    where: {
      vendorId,
      type: "SALE",
      occurredAt: { gte: from, lt: to },
    },
    select: { itemsNet: true, currency: true },
  });

  const itemsNet = round2(
    entries.reduce((sum, e) => sum + Number(e.itemsNet || 0), 0)
  );

  const currency = entries[0]?.currency || "RON";

  return { itemsNet, currency, count: entries.length };
}

async function loadTopProducts(vendorId, order, limit = 5) {
  const grouped = await prisma.shipmentItem.groupBy({
    by: ["productId"],
    where: {
      productId: { not: null },
      shipment: { vendorId, ...SOLD_SHIPMENT_STATUS_FILTER },
    },
    _sum: { qty: true },
    orderBy: { _sum: { qty: order } },
    take: limit,
  });

  const productIds = grouped.map((g) => g.productId).filter(Boolean);

  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: true },
      })
    : [];

  const titleById = new Map(products.map((p) => [p.id, p.title]));

  return grouped.map((g) => ({
    productId: g.productId,
    title: titleById.get(g.productId) || "Produs șters/indisponibil",
    qty: g._sum.qty || 0,
  }));
}

async function loadUnsoldProducts(vendorId, limit = 5) {
  const soldGrouped = await prisma.shipmentItem.groupBy({
    by: ["productId"],
    where: {
      productId: { not: null },
      shipment: { vendorId, ...SOLD_SHIPMENT_STATUS_FILTER },
    },
  });

  const soldProductIds = soldGrouped.map((g) => g.productId).filter(Boolean);

  const [total, unsold] = await Promise.all([
    prisma.product.count({ where: { service: { vendorId } } }),
    prisma.product.findMany({
      where: {
        service: { vendorId },
        id: { notIn: soldProductIds },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { title: true },
    }),
  ]);

  return { total, unsoldCount: total - soldProductIds.length, unsold };
}

function formatGrossSoldAnswer(sum, label) {
  if (!sum.count) {
    return `Nu ai vândut nimic ${label} (0 ${sum.currency}).`;
  }
  return `Ai vândut (brut, înainte de comision) ${sum.itemsNet} ${sum.currency} ${label}, din ${sum.count} tranzacții.`;
}

/*
 * Punct de intrare unic pentru copilotRouter.js. Întoarce `null` dacă
 * mesajul NU ține de acest domeniu (apelantul cade pe comportamentul
 * existent, neschimbat).
 */
export async function answerVendorSalesQuestion({ vendorId, message }) {
  const topic = detectSalesLiveTopic(message);
  if (!topic) return null;

  if (topic === "GROSS_SOLD_THIS_MONTH") {
    const sum = await sumGrossSoldForMonth(vendorId, 0);
    return { message: formatGrossSoldAnswer(sum, "luna asta"), topic };
  }

  if (topic === "GROSS_SOLD_LAST_MONTH") {
    const sum = await sumGrossSoldForMonth(vendorId, -1);
    return { message: formatGrossSoldAnswer(sum, "luna trecută"), topic };
  }

  if (topic === "TOP_SELLING_PRODUCTS") {
    const items = await loadTopProducts(vendorId, "desc");

    if (!items.length) {
      return { message: "Nu ai încă nicio vânzare înregistrată.", topic };
    }

    const lines = items.map(
      (it, i) => `${i + 1}. ${it.title} - ${it.qty} bucăți vândute`
    );

    return {
      message: `Cele mai vândute produse:\n\n${lines.join("\n")}`,
      topic,
    };
  }

  if (topic === "UNSOLD_PRODUCTS") {
    const { total, unsoldCount, unsold } = await loadUnsoldProducts(vendorId);

    if (!total) {
      return { message: "Nu ai niciun produs momentan.", topic };
    }

    if (!unsold.length) {
      return {
        message: "Toate produsele tale au avut cel puțin o vânzare.",
        topic,
      };
    }

    const lines = unsold.map((p, i) => `${i + 1}. ${p.title}`);

    return {
      message: `Ai ${unsoldCount} produs${unsoldCount === 1 ? "" : "e"} fără nicio vânzare:\n\n${lines.join("\n")}`,
      topic,
    };
  }

  return null;
}
