// backend/src/services/vendorAssistantPayments.js
//
// BATCH 5 (audit regression Vendor Assistant, 2026-09-06) - serviciu SUBȚIRE,
// read-only, pentru întrebările de tip "cât am câștigat / ce comision
// datorez / ce facturi sunt neachitate / ce comision am plătit luna trecută"
// puse de un vendor autentificat.
//
// NU duplică logica de business din adminInvoicesRoutes.js/vendorInvoices.js
// - reutilizează ACELEAȘI modele Prisma (VendorEarningEntry, Invoice) și
// ACEEAȘI definiție de "sold deschis" (payoutId: null) ca
// computeOpenLedgerTotals (vendorInvoices.js:287-323).
//
// Scop STRICT: sume/liste determinate simplu dintr-o interogare - NU
// "suma exactă de încasat acum" (ambiguă - banii pentru comenzile cu
// cardul au fost deja transferați automat către contul Stripe Connect al
// vendorului la webhook, cele ramburs sunt cash direct la curier, deci nu
// există un singur "sold de încasat" corect fără acces live la Stripe -
// vezi `receivableAmount` mai jos, care e explicit etichetat ca ESTIMARE
// informativă pe baza jurnalului intern, NU un sold real de bancă/Stripe).

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
 * BATCH 2 (FINAL GAP PASS, 2026-09-07) - exportate ca să poată fi
 * reutilizate de vendorAssistantSales.js (vânzări BRUTE, distincte de
 * câștigul net de aici) fără să dubleze matematica de dată/rotunjire -
 * niciun business rule aici, doar calcul generic de interval de lună.
 */
export function round2(n) {
  return Number.parseFloat(Number(n || 0).toFixed(2));
}

/*
 * Ordinea contează: verificăm întâi combinațiile cele mai specifice
 * (comision plătit luna trecută) înainte de cele generice (comision
 * datorez), altfel "trecută" din prima ar fi ratat de un match generic
 * mai lax. Orice întrebare STATICĂ despre CUM funcționează comisionul/
 * Stripe/factura (fără "cât"/"ce comision"/"ce facturi" + un semnal de
 * sumă/listă) întoarce `null` - cade pe manifest, nu pe acest serviciu.
 */
export function detectPaymentsLiveTopic(message) {
  const t = stripDiacritics(message);

  if (/comision/.test(t) && /platit/.test(t) && /trecut/.test(t)) {
    return "COMMISSION_PAID_LAST_MONTH";
  }

  if (/comision/.test(t) && (/datorez/.test(t) || /\bcat\b.*comision|comision.*\bcat\b/.test(t))) {
    return "COMMISSION_OWED";
  }

  if (/factur/.test(t) && /neachitat|neplatit/.test(t)) {
    return "UNPAID_INVOICES";
  }

  if (/comenzi/.test(t) && /castig/.test(t)) {
    return "EARNING_ORDERS";
  }

  if (/suma/.test(t) && /incasat/.test(t)) {
    return "RECEIVABLE_AMOUNT";
  }

  if (/castigat/.test(t) && /trecut/.test(t)) {
    return "EARNED_LAST_MONTH";
  }

  if (/castigat/.test(t) && (/luna asta|\bcat\b/.test(t))) {
    return "EARNED_THIS_MONTH";
  }

  return null;
}

export function monthRange(offsetMonths = 0) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths + 1, 1));
  return { from, to };
}

const EARNING_ENTRY_TYPES = ["SALE", "REFUND", "ADJUSTMENT"];

async function sumEarningsForMonth(vendorId, offsetMonths) {
  const { from, to } = monthRange(offsetMonths);

  const entries = await prisma.vendorEarningEntry.findMany({
    where: {
      vendorId,
      type: { in: EARNING_ENTRY_TYPES },
      occurredAt: { gte: from, lt: to },
    },
    select: { vendorNet: true, commissionNet: true, currency: true },
  });

  const vendorNet = round2(entries.reduce((s, e) => s + Number(e.vendorNet || 0), 0));
  const commissionNet = round2(entries.reduce((s, e) => s + Number(e.commissionNet || 0), 0));
  const currency = entries[0]?.currency || "RON";

  return { vendorNet, commissionNet, currency, count: entries.length };
}

/*
 * "Comision datorez" = sold DESCHIS, exact aceeași definiție ca
 * computeOpenLedgerTotals (vendorInvoices.js:287-323): intrări încă
 * nefacturate (payoutId: null).
 */
async function sumOpenCommission(vendorId) {
  const entries = await prisma.vendorEarningEntry.findMany({
    where: { vendorId, payoutId: null, type: { in: EARNING_ENTRY_TYPES } },
    select: { commissionNet: true, vendorNet: true, currency: true },
  });

  const commissionNet = round2(entries.reduce((s, e) => s + Number(e.commissionNet || 0), 0));
  const vendorNet = round2(entries.reduce((s, e) => s + Number(e.vendorNet || 0), 0));
  const currency = entries[0]?.currency || "RON";

  return { commissionNet, vendorNet, currency, count: entries.length };
}

async function sumCommissionPaidLastMonth(vendorId) {
  const { from, to } = monthRange(-1);

  const invoices = await prisma.invoice.findMany({
    where: {
      vendorId,
      direction: "PLATFORM_TO_VENDOR",
      type: "COMMISSION",
      status: "PAID",
      paidAt: { gte: from, lt: to },
    },
    select: { totalNet: true, currency: true },
  });

  const totalNet = round2(invoices.reduce((s, i) => s + Number(i.totalNet || 0), 0));
  const currency = invoices[0]?.currency || "RON";

  return { totalNet, currency, count: invoices.length };
}

async function loadUnpaidInvoices(vendorId, limit = 5) {
  return prisma.invoice.findMany({
    where: {
      vendorId,
      direction: "PLATFORM_TO_VENDOR",
      status: { in: ["UNPAID", "OVERDUE"] },
    },
    orderBy: { dueDate: "asc" },
    take: limit,
    select: { id: true, number: true, dueDate: true, totalGross: true, currency: true, status: true },
  });
}

async function loadEarningOrders(vendorId, limit = 5) {
  return prisma.vendorEarningEntry.findMany({
    where: { vendorId, type: "SALE" },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      vendorNet: true,
      currency: true,
      order: { select: { orderNumber: true } },
    },
  });
}

const MONTH_LABEL = { 0: "luna asta", "-1": "luna trecută" };

function formatEarnedAnswer(sum, offsetMonths) {
  const label = MONTH_LABEL[String(offsetMonths)];
  if (!sum.count) {
    return `Nu ai încasări înregistrate ${label} (0 ${sum.currency}).`;
  }
  return `Ai câștigat (net, după comision) ${sum.vendorNet} ${sum.currency} ${label}, din ${sum.count} tranzacții.`;
}

/*
 * Punct de intrare unic pentru copilotRouter.js. Întoarce `null` dacă
 * mesajul NU e o întrebare de sumă/listă din acest domeniu (apelantul
 * cade pe comportamentul existent, neschimbat).
 */
export async function answerVendorPaymentsQuestion({ vendorId, message }) {
  const topic = detectPaymentsLiveTopic(message);
  if (!topic) return null;

  switch (topic) {
    case "EARNED_THIS_MONTH": {
      const sum = await sumEarningsForMonth(vendorId, 0);
      return { message: formatEarnedAnswer(sum, 0), topic };
    }

    case "EARNED_LAST_MONTH": {
      const sum = await sumEarningsForMonth(vendorId, -1);
      return { message: formatEarnedAnswer(sum, -1), topic };
    }

    case "COMMISSION_OWED": {
      const sum = await sumOpenCommission(vendorId);
      if (!sum.count) {
        return { message: "Nu ai comision nefacturat momentan - toate tranzacțiile tale sunt deja incluse într-o factură.", topic };
      }
      return {
        message: `Ai un comision de ${sum.commissionNet} ${sum.currency} încă nefacturat, din ${sum.count} tranzacții - va apărea pe următoarea factură de comision.`,
        topic,
      };
    }

    case "COMMISSION_PAID_LAST_MONTH": {
      const sum = await sumCommissionPaidLastMonth(vendorId);
      if (!sum.count) {
        return { message: "Nu ai nicio factură de comision plătită luna trecută.", topic };
      }
      return {
        message: `Ai plătit ${sum.totalNet} ${sum.currency} comision luna trecută, din ${sum.count} factură(i).`,
        topic,
      };
    }

    case "UNPAID_INVOICES": {
      const items = await loadUnpaidInvoices(vendorId);
      if (!items.length) {
        return { message: "Nu ai nicio factură neachitată momentan.", topic };
      }
      const lines = items.map(
        (i, idx) =>
          `${idx + 1}. Factura ${i.number} - ${round2(i.totalGross)} ${i.currency} - scadentă la ${new Date(i.dueDate).toLocaleDateString("ro-RO")}`
      );
      return { message: `Ai ${items.length} factură(i) neachitată(e):\n\n${lines.join("\n")}`, topic };
    }

    case "EARNING_ORDERS": {
      const items = await loadEarningOrders(vendorId);
      if (!items.length) {
        return { message: "Nu ai încă nicio comandă finalizată care să-ți fi adus câștig.", topic };
      }
      const lines = items.map(
        (e, idx) => `${idx + 1}. Comanda ${e.order?.orderNumber || "—"} - ${round2(e.vendorNet)} ${e.currency}`
      );
      return { message: `Comenzile tale recente cu câștig:\n\n${lines.join("\n")}`, topic };
    }

    case "RECEIVABLE_AMOUNT": {
      const sum = await sumOpenCommission(vendorId);
      if (!sum.count) {
        return {
          message:
            "Nu ai sumă nefacturată în acest moment. Notă: pentru comenzile cu cardul, banii (minus comision și taxa Stripe) ajung automat în contul tău Stripe Connect la fiecare comandă - nu se acumulează într-un \"sold de încasat\" separat.",
          topic,
        };
      }
      return {
        message: `Suma netă calculată (informativ, după comision) din tranzacțiile încă nefacturate este ${sum.vendorNet} ${sum.currency}. Pentru comenzile cu cardul, banii au ajuns deja automat în contul tău Stripe Connect la fiecare comandă - asta e doar o estimare a comisionului care va apărea pe următoarea factură, nu un sold separat de încasat.`,
        topic,
      };
    }

    default:
      return null;
  }
}
