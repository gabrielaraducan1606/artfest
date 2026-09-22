// src/services/legacyCardLedgerReport.js
//
// RAPORT READ-ONLY pentru ledger-ul CARD "legacy": comenzi plătite înainte de
// introducerea SALE-ului per shipment. NU modifică nimic - doar citește
// (findMany) și clasifică. Recovery-ul NU se execută și NU se propune de aici.
//
// CRITERIUL de recunoaștere a unui SALE legacy ("T"):
//   VendorEarningEntry cu type = SALE, shipmentId = NULL, stripeTransferId
//   NOT NULL și orderId NOT NULL (creat de webhook-ul Stripe vechi, UN rând
//   per vendor per comandă). Rândurile noi au întotdeauna shipmentId.
//
// UNITATEA de analiză = perechea (orderId, vendorId) care are cel puțin un T.
// Pentru fiecare pereche se citesc:
//   T = SALE legacy;  S = SALE cu shipmentId (create la livrare, dublează
//   parțial/integral T);  R = REFUND-uri;  livrările OUTBOUND ale vendorului
//   în comandă;  starea comenzii;  payout-urile/facturile entry-urilor.
//
// FORMULA EXACTĂ A EXCESULUI (comision, în cenți întregi):
//   net       = Σ commissionNet (T + S + R)
//   anulată   = comanda CANCELLED sau o livrare OUTBOUND REFUSED/RETURNED
//   așteptat  = anulată ? 0 : (primul T) + Σ R      (T se contabilizează o dată;
//                                                    refund-urile reduc)
//   exces     = net - așteptat
//   exces > 0 -> comision contabilizat în plus (ar trebui eventual compensat);
//   exces < 0 -> ledger reversat în plus (necesită verificare).
//
// CATEGORII (category):
//   LEGACY_ONLY                     T singur, fără anulare: o singură
//                                   contabilizare, corect.
//   LEGACY_DOUBLE_SALE              T + S, comandă neanulată, fără refund.
//   LEGACY_DOUBLE_SALE_REFUNDED     T + S + REFUND(S): S neutralizat, T rămas.
//   LEGACY_CANCELLED_UNREVERSED     comandă/livrare anulată sau returnată, dar
//                                   comisionul net > 0 (T nereversat).
//   LEGACY_REVERSED_OK              T deja neutralizat (refund cu
//                                   refSaleEntryId sau net zero pe anulată).
//   LEGACY_AMBIGUOUS_MULTI_SHIPMENT T singur, iar vendorul are >1 livrare
//                                   OUTBOUND în comandă: T nu se poate
//                                   atribui unei livrări (fallback-ul de refund
//                                   nu ghicește). `underlying` = starea de fond.
//   MULTIPLE_LEGACY_ROWS            >1 T pentru aceeași pereche (reluare).
//   LEGACY_NO_SHIPMENT              T fără nicio livrare OUTBOUND a vendorului
//                                   în comandă (date lipsă/șterse).
//   LEGACY_OVER_REVERSED            exces negativ sau comision net negativ
//                                   (refund > sale contabilizat).
//
// EVALUARE (assessment):
//   HISTORY_OK          doar istoric corect;
//   NEEDS_VERIFICATION  fără exces demonstrat, dar cu situație neclară;
//   NEEDS_RECOVERY      exces pozitiv de comision demonstrat.
//
// FACTURARE (read-only): entry.payoutId -> VendorPayout (status, paidAt,
// invoiceId) -> Invoice (number, status, paidAt). Stare per payout:
//   PAID   payout.status = PAID sau invoice.status = PAID sau paidAt setat;
//   CANCELLED  payout/factură CANCELLED;  ISSUED  emis, neplătit
//   (DRAFT/UNPAID/OVERDUE);  PAYOUT_NOT_FOUND  payoutId fără payout în DB.
// Per pereche: NOT_BILLED | ISSUED_ONLY | PAID | CANCELLED | MIXED |
// PAYOUT_NOT_FOUND.

const CANCELLED_SHIPMENT = ["REFUSED", "RETURNED"];

export const LEGACY_CATEGORIES = [
  "LEGACY_ONLY",
  "LEGACY_DOUBLE_SALE",
  "LEGACY_REVERSED_OK",
  "LEGACY_CANCELLED_UNREVERSED",
  "LEGACY_DOUBLE_SALE_REFUNDED",
  "LEGACY_AMBIGUOUS_MULTI_SHIPMENT",
  "MULTIPLE_LEGACY_ROWS",
  "LEGACY_NO_SHIPMENT",
  "LEGACY_OVER_REVERSED",
];

export const ASSESSMENTS = ["HISTORY_OK", "NEEDS_VERIFICATION", "NEEDS_RECOVERY"];
export const BILLING_STATES = [
  "NOT_BILLED",
  "ISSUED_ONLY",
  "PAID",
  "CANCELLED",
  "MIXED",
  "PAYOUT_NOT_FOUND",
];

const cents = (value) => Math.round(Number(value || 0) * 100);
const money = (c) => Math.round(c) / 100;
const sumCents = (rows, field) => rows.reduce((t, r) => t + cents(r[field]), 0);

const isLegacySale = (e) =>
  e.type === "SALE" && e.shipmentId == null && Boolean(e.stripeTransferId);

/* ----------------------------------------------------
   Facturare
----------------------------------------------------- */

export function payoutBillingState(payout) {
  if (!payout) return "PAYOUT_NOT_FOUND";

  const invoiceStatus = payout.invoice?.status || null;

  if (
    payout.status === "PAID" ||
    invoiceStatus === "PAID" ||
    payout.paidAt ||
    payout.invoice?.paidAt
  ) {
    return "PAID";
  }

  if (payout.status === "CANCELLED" || invoiceStatus === "CANCELLED") {
    return "CANCELLED";
  }

  return "ISSUED"; // DRAFT / UNPAID / OVERDUE
}

function describeBilling(entries, payoutsById) {
  const billed = entries.filter((e) => e.payoutId != null);

  const perEntry = billed.map((e) => {
    const payout = payoutsById.get(e.payoutId) || null;
    return {
      entryId: e.id,
      type: e.type,
      shipmentId: e.shipmentId ?? null,
      commissionNet: money(cents(e.commissionNet)),
      payoutId: e.payoutId,
      payoutState: payoutBillingState(payout),
      payoutStatus: payout?.status ?? null,
      payoutPaidAt: payout?.paidAt ?? null,
      hasInvoice: Boolean(payout?.invoiceId),
      invoiceNumber: payout?.invoice?.number ?? null,
      invoiceStatus: payout?.invoice?.status ?? null,
      invoicePaidAt: payout?.invoice?.paidAt ?? null,
    };
  });

  const states = new Set(perEntry.map((p) => p.payoutState));

  let overall = "NOT_BILLED";
  if (states.size === 1) {
    const only = [...states][0];
    overall = only === "ISSUED" ? "ISSUED_ONLY" : only;
  } else if (states.size > 1) {
    overall = "MIXED";
  }

  return {
    overall,
    entriesWithPayoutId: billed.length,
    payoutIds: [...new Set(billed.map((e) => e.payoutId))],
    entries: perEntry,
  };
}

/* ----------------------------------------------------
   Clasificare pe pereche (orderId, vendorId)
----------------------------------------------------- */

export function classifyLegacyCardLedger({
  entries,
  shipments = [],
  order = null,
  payoutsById = new Map(),
}) {
  const legacy = entries.filter(isLegacySale);
  const shipmentSales = entries.filter((e) => e.type === "SALE" && e.shipmentId != null);
  const refunds = entries.filter((e) => e.type === "REFUND");

  const outbound = shipments.filter((s) => String(s.direction || "OUTBOUND") !== "RETURN");
  const cancelled =
    order?.status === "CANCELLED" ||
    outbound.some((s) => CANCELLED_SHIPMENT.includes(s.status));

  const legacyIds = legacy.map((e) => e.id);
  const reversedLegacyIds = new Set(
    refunds.map((r) => r.meta?.refSaleEntryId).filter((id) => legacyIds.includes(id))
  );

  const legacyC = sumCents(legacy, "commissionNet");
  const firstLegacyC = sumCents(legacy.slice(0, 1), "commissionNet");
  const shipmentC = sumCents(shipmentSales, "commissionNet");
  const refundC = sumCents(refunds, "commissionNet"); // negativ

  const net = legacyC + shipmentC + refundC;
  const expected = cancelled ? 0 : firstLegacyC + refundC;
  const excess = net - expected;

  const refundedShipmentIds = new Set(refunds.map((r) => r.meta?.refShipmentId).filter(Boolean));
  const refundsForShipmentSales = shipmentSales.some((s) => refundedShipmentIds.has(s.shipmentId));

  const saleShipmentIds = new Set(shipmentSales.map((s) => s.shipmentId));
  const flags = {
    ambiguousShipments: outbound.length > 1,
    allOutboundShipmentsHaveSale:
      outbound.length > 0 && outbound.every((s) => saleShipmentIds.has(s.id)),
    amountMismatch:
      shipmentSales.length > 0 && Math.abs(firstLegacyC - shipmentC) > 1,
    cancelled,
  };

  let category;
  let underlying = null;

  if (legacy.length > 1) {
    category = "MULTIPLE_LEGACY_ROWS";
  } else if (excess < 0 || net < 0) {
    // net negativ = refund-uri mai mari decât SALE-urile contabilizate
    category = "LEGACY_OVER_REVERSED";
  } else if (excess === 0 && (cancelled || reversedLegacyIds.size > 0)) {
    category = "LEGACY_REVERSED_OK";
  } else if (shipmentSales.length > 0) {
    if (refundsForShipmentSales) {
      category = "LEGACY_DOUBLE_SALE_REFUNDED";
    } else {
      category = cancelled ? "LEGACY_CANCELLED_UNREVERSED" : "LEGACY_DOUBLE_SALE";
    }
  } else if (outbound.length === 0) {
    category = "LEGACY_NO_SHIPMENT";
  } else if (outbound.length > 1) {
    category = "LEGACY_AMBIGUOUS_MULTI_SHIPMENT";
    underlying = cancelled && excess > 0 ? "LEGACY_CANCELLED_UNREVERSED" : "LEGACY_ONLY";
  } else if (cancelled && excess > 0) {
    category = "LEGACY_CANCELLED_UNREVERSED";
  } else {
    category = "LEGACY_ONLY";
  }

  let assessment;
  if (["LEGACY_ONLY", "LEGACY_REVERSED_OK"].includes(category)) {
    assessment = "HISTORY_OK";
  } else if (category === "LEGACY_AMBIGUOUS_MULTI_SHIPMENT") {
    assessment = underlying === "LEGACY_CANCELLED_UNREVERSED" ? "NEEDS_RECOVERY" : "NEEDS_VERIFICATION";
  } else if (category === "LEGACY_NO_SHIPMENT") {
    // exces demonstrat la nivel de comandă (ex. comandă anulată) = recovery;
    // altfel doar verificare (nu se poate atribui nicio livrare)
    assessment = excess > 0 ? "NEEDS_RECOVERY" : "NEEDS_VERIFICATION";
  } else if (category === "LEGACY_OVER_REVERSED") {
    assessment = "NEEDS_VERIFICATION";
  } else {
    assessment = excess > 0 ? "NEEDS_RECOVERY" : "NEEDS_VERIFICATION";
  }

  const billing = describeBilling(entries.filter((e) => e.type !== "ADJUSTMENT"), payoutsById);

  // Orice payoutId fără payout în DB face un caz "istoric corect" discutabil.
  if (assessment === "HISTORY_OK" && billing.overall === "PAYOUT_NOT_FOUND") {
    assessment = "NEEDS_VERIFICATION";
  }

  const ids = (rows) => rows.map((r) => r.id);
  const fmt = (c) => money(c).toFixed(2);

  const reasons = {
    LEGACY_ONLY: "Un singur SALE legacy, fără anulare: comision contabilizat o dată. Corect.",
    LEGACY_REVERSED_OK: "SALE legacy neutralizat (net zero sau refund cu refSaleEntryId). Corect.",
    LEGACY_DOUBLE_SALE:
      `Comision contabilizat de două ori: SALE legacy ${ids(legacy).join(",")} (${fmt(legacyC)}) + SALE pe shipment ${ids(shipmentSales).join(",")} (${fmt(shipmentC)}); așteptat ${fmt(expected)}, net ${fmt(net)}, exces ${fmt(excess)}.`,
    LEGACY_DOUBLE_SALE_REFUNDED:
      `Comanda a fost rambursată: refund ${ids(refunds).join(",")} a neutralizat SALE-ul pe shipment, dar SALE-ul legacy ${ids(legacy).join(",")} (${fmt(legacyC)}) a rămas; așteptat ${fmt(expected)}, net ${fmt(net)}, exces ${fmt(excess)}.`,
    LEGACY_CANCELLED_UNREVERSED:
      `Comandă/livrare anulată sau returnată, dar comisionul net este ${fmt(net)} (așteptat 0): SALE ${ids([...legacy, ...shipmentSales]).join(",")} fără refund complet; exces ${fmt(excess)}.`,
    LEGACY_AMBIGUOUS_MULTI_SHIPMENT:
      `Vendorul are ${outbound.length} livrări OUTBOUND în comandă și SALE-ul legacy ${ids(legacy).join(",")} nu poate fi atribuit unei singure livrări (refund-ul automat nu ghicește). Stare de fond: ${underlying}; exces curent ${fmt(excess)}.`,
    MULTIPLE_LEGACY_ROWS:
      `${legacy.length} SALE legacy pentru aceeași pereche (${ids(legacy).join(",")}): reluare de eveniment; net ${fmt(net)}, așteptat ${fmt(expected)}, exces ${fmt(excess)}.`,
    LEGACY_NO_SHIPMENT:
      `SALE legacy ${ids(legacy).join(",")} fără nicio livrare OUTBOUND a vendorului în comandă: nu se poate atribui nicio livrare. Necesită verificare manuală.`,
    LEGACY_OVER_REVERSED:
      `Comisionul net (${fmt(net)}) este negativ sau sub cel așteptat (${fmt(expected)}): refund-urile depășesc SALE-urile contabilizate (diferență ${fmt(Math.max(-excess, -net))}). Necesită verificare.`,
  };

  const notes = [];
  if (billing.overall === "PAYOUT_NOT_FOUND") {
    notes.push("Există entries cu payoutId fără payout în baza de date.");
  }
  if (flags.amountMismatch) {
    notes.push(
      `Comisionul legacy (${fmt(firstLegacyC)}) diferă de Σ SALE pe shipment (${fmt(shipmentC)}): livrare parțială sau rotunjire.`
    );
  }

  return {
    category,
    underlying,
    assessment,
    reason: reasons[category],
    notes,
    flags,
    legacySaleIds: ids(legacy),
    shipmentSaleIds: ids(shipmentSales),
    refundIds: ids(refunds),
    saleShipmentIds: [...saleShipmentIds],
    outboundShipments: outbound.map((s) => ({ id: s.id, status: s.status })),
    billing,
    amounts: {
      legacyCommission: money(legacyC),
      shipmentSalesCommission: money(shipmentC),
      refundsCommission: money(refundC),
      netCommission: money(net),
      expectedCommission: money(expected),
      excessCommission: money(excess),
    },
    // pentru agregare (cenți)
    totalsCents: {
      sales: {
        itemsNet: sumCents([...legacy, ...shipmentSales], "itemsNet"),
        commissionNet: legacyC + shipmentC,
        vendorNet: sumCents([...legacy, ...shipmentSales], "vendorNet"),
      },
      refunds: {
        itemsNet: sumCents(refunds, "itemsNet"),
        commissionNet: refundC,
        vendorNet: sumCents(refunds, "vendorNet"),
      },
      excessCommission: excess,
    },
    counts: {
      saleEntries: legacy.length + shipmentSales.length,
      legacySaleEntries: legacy.length,
      shipmentSaleEntries: shipmentSales.length,
      refundEntries: refunds.length,
    },
  };
}

/* ----------------------------------------------------
   Raport complet
----------------------------------------------------- */

const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const emptyBucket = () => ({
  orderIds: new Set(),
  pairs: 0,
  saleEntries: 0,
  legacySaleEntries: 0,
  shipmentSaleEntries: 0,
  refundEntries: 0,
  sales: { itemsNet: 0, commissionNet: 0, vendorNet: 0 },
  refunds: { itemsNet: 0, commissionNet: 0, vendorNet: 0 },
  entriesWithPayoutId: 0,
  payoutIds: new Set(),
  billing: Object.fromEntries(BILLING_STATES.map((s) => [s, 0])),
  assessment: Object.fromEntries(ASSESSMENTS.map((s) => [s, 0])),
  excessCommission: 0,
  excessCommissionInBilledPairs: 0,
});

const finalizeBucket = (b) => ({
  orders: b.orderIds.size,
  orderVendorPairs: b.pairs,
  saleEntries: b.saleEntries,
  legacySaleEntries: b.legacySaleEntries,
  shipmentSaleEntries: b.shipmentSaleEntries,
  refundEntries: b.refundEntries,
  sales: {
    itemsNet: money(b.sales.itemsNet),
    commissionNet: money(b.sales.commissionNet),
    vendorNet: money(b.sales.vendorNet),
  },
  refunds: {
    itemsNet: money(b.refunds.itemsNet),
    commissionNet: money(b.refunds.commissionNet),
    vendorNet: money(b.refunds.vendorNet),
  },
  entriesWithPayoutId: b.entriesWithPayoutId,
  distinctPayouts: b.payoutIds.size,
  billingStatePairs: b.billing,
  assessmentPairs: b.assessment,
  excessCommission: money(b.excessCommission),
  // exces în perechi care au deja entries în payout/factură (nu doar NOT_BILLED)
  excessCommissionInBilledPairs: money(b.excessCommissionInBilledPairs),
});

/*
 * `db` trebuie să expună DOAR findMany pe vendorEarningEntry, shipment, order
 * și vendorPayout. Orice altă metodă (create/update/delete/...) nu există ->
 * nu se poate scrie nimic din acest raport.
 */
export async function buildLegacyCardLedgerReport({ db, orderIdChunkSize = 500 }) {
  const legacyRows = await db.vendorEarningEntry.findMany({
    where: {
      type: "SALE",
      shipmentId: null,
      stripeTransferId: { not: null },
      orderId: { not: null },
    },
    select: { id: true, orderId: true, vendorId: true },
  });

  const orderIds = [...new Set(legacyRows.map((r) => r.orderId))];
  const pairKeys = [...new Set(legacyRows.map((r) => `${r.orderId}::${r.vendorId}`))].sort();

  const entries = [];
  const shipments = [];
  const orders = [];

  for (const ids of chunk(orderIds, orderIdChunkSize)) {
    entries.push(
      ...(await db.vendorEarningEntry.findMany({
        where: { orderId: { in: ids } },
        select: {
          id: true, orderId: true, vendorId: true, shipmentId: true, type: true,
          itemsNet: true, commissionNet: true, vendorNet: true,
          payoutId: true, stripeTransferId: true, occurredAt: true, meta: true,
        },
      }))
    );
    shipments.push(
      ...(await db.shipment.findMany({
        where: { orderId: { in: ids } },
        select: { id: true, orderId: true, vendorId: true, status: true, direction: true },
      }))
    );
    orders.push(
      ...(await db.order.findMany({
        where: { id: { in: ids } },
        select: { id: true, orderNumber: true, status: true, paymentMethod: true, paidAt: true },
      }))
    );
  }

  const payoutIds = [...new Set(entries.map((e) => e.payoutId).filter(Boolean))];
  const payouts = [];

  for (const ids of chunk(payoutIds, orderIdChunkSize)) {
    payouts.push(
      ...(await db.vendorPayout.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, vendorId: true, status: true, paidAt: true, issuedAt: true,
          periodFrom: true, periodTo: true, invoiceId: true, totalCommissionNet: true,
          invoice: { select: { id: true, number: true, status: true, paidAt: true } },
        },
      }))
    );
  }

  const orderById = new Map(orders.map((o) => [o.id, o]));
  const payoutsById = new Map(payouts.map((p) => [p.id, p]));

  const buckets = Object.fromEntries(LEGACY_CATEGORIES.map((c) => [c, emptyBucket()]));
  const overall = emptyBucket();
  const details = [];

  for (const key of pairKeys) {
    const [orderId, vendorId] = key.split("::");

    const result = classifyLegacyCardLedger({
      entries: entries.filter((e) => e.orderId === orderId && e.vendorId === vendorId),
      shipments: shipments.filter((s) => s.orderId === orderId && s.vendorId === vendorId),
      order: orderById.get(orderId) || null,
      payoutsById,
    });

    details.push({
      orderId,
      orderNumber: orderById.get(orderId)?.orderNumber || null,
      vendorId,
      orderStatus: orderById.get(orderId)?.status || null,
      ...result,
    });

    for (const b of [buckets[result.category], overall]) {
      b.orderIds.add(orderId);
      b.pairs += 1;
      b.saleEntries += result.counts.saleEntries;
      b.legacySaleEntries += result.counts.legacySaleEntries;
      b.shipmentSaleEntries += result.counts.shipmentSaleEntries;
      b.refundEntries += result.counts.refundEntries;
      for (const f of ["itemsNet", "commissionNet", "vendorNet"]) {
        b.sales[f] += result.totalsCents.sales[f];
        b.refunds[f] += result.totalsCents.refunds[f];
      }
      b.entriesWithPayoutId += result.billing.entriesWithPayoutId;
      result.billing.payoutIds.forEach((id) => b.payoutIds.add(id));
      b.billing[result.billing.overall] += 1;
      b.assessment[result.assessment] += 1;
      if (result.totalsCents.excessCommission > 0) {
        b.excessCommission += result.totalsCents.excessCommission;
        if (result.billing.overall !== "NOT_BILLED") {
          b.excessCommissionInBilledPairs += result.totalsCents.excessCommission;
        }
      }
    }
  }

  const categories = Object.fromEntries(
    LEGACY_CATEGORIES.map((c) => [c, finalizeBucket(buckets[c])])
  );

  return {
    readOnly: true,
    criteria:
      "SALE cu shipmentId NULL și stripeTransferId NOT NULL (creat de webhook-ul vechi, un rând per vendor/comandă)",
    excessFormula:
      "exces = net(T+S+R) - așteptat; așteptat = anulată ? 0 : primul T + Σ R",
    totals: {
      legacyRows: legacyRows.length,
      ...finalizeBucket(overall),
      pairsNeedingRecovery: details.filter((d) => d.assessment === "NEEDS_RECOVERY").length,
      pairsNeedingVerification: details.filter((d) => d.assessment === "NEEDS_VERIFICATION").length,
      totalExcessCommission: money(overall.excessCommission),
    },
    categories,
    details,
  };
}
