// src/components/AIAssistant/VendorAIAssistant/vendorOrderLeadCards.test.js
//
// Teste pure pentru "Comenzile magazinului" (Vendor Assistant, conectare
// flow, 2026-09-23) - sortare/formatare carduri, FĂRĂ rețea/DOM.
// Comportamentul de rețea (fetch/retry/click "Vezi comanda") e acoperit
// de infrastructura deja existentă (GET /api/vendor/orders + thread-meta,
// navigare la /vendor/orders/:id) - nu se poate testa din
// VendorAssistant.jsx (.jsx, fără transformare JSX în node --test),
// consistent cu restul proiectului (vezi și vendorQuoteLeadCards.test.js).
//
// Rulare: node --test src/components/AIAssistant/VendorAIAssistant/vendorOrderLeadCards.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeVendorOrderList,
  getVendorOrderStatus,
  sortVendorOrderLeads,
  pickTopVendorOrderLeads,
  getVendorOrderStatusLabel,
  getVendorOrderStatusType,
  isVendorOrderActionNeeded,
  formatVendorOrderTotal,
  getVendorOrderPaymentLabel,
  hasVendorOrderDeposit,
  buildVendorOrderDepositDetails,
  formatVendorOrderDepositSummary,
  buildVendorOrderLeadCard,
  buildVendorOrderLeadCards,
  mergeVendorOrderThreadMeta,
  RETRY_VENDOR_ORDER_LEADS_ACTION,
} from "./vendorOrderLeadCards.js";

function makeOrder(overrides = {}) {
  return {
    id: "o1",
    orderNumber: "1001",
    shortId: "ABC123",
    createdAt: "2026-09-20T10:00:00.000Z",
    customerName: "Ion Popescu",
    status: "new",
    total: 250,
    itemsCount: 2,
    paymentMethod: "COD",
    paymentStatus: "COD",
    waitingForCardPayment: false,
    canProcess: true,
    deposit: {
      status: "NOT_REQUESTED",
      percent: null,
      requestedAmount: null,
      paidAmount: null,
      remainingCodAmount: null,
    },
    messageThreadId: null,
    messageUnreadCount: 0,
    ...overrides,
  };
}

/* =========================================================
   A. 0 comenzi
========================================================= */

test("A. 0 comenzi -> normalizare + carduri întorc listă goală, fără crash", () => {
  assert.deepEqual(normalizeVendorOrderList({ items: [] }), []);
  assert.deepEqual(normalizeVendorOrderList(null), []);
  assert.deepEqual(normalizeVendorOrderList(undefined), []);
  assert.deepEqual(buildVendorOrderLeadCards([]), []);
});

/* =========================================================
   B. fiecare status
========================================================= */

test("B. status new -> label 'Nouă', tip badge 'new'", () => {
  const order = makeOrder({ status: "new" });
  assert.equal(getVendorOrderStatusLabel(order), "Nouă");
  assert.equal(getVendorOrderStatusType(order), "new");
});

test("B bis. status preparing -> label 'În pregătire', tip 'discussion'", () => {
  const order = makeOrder({ status: "preparing" });
  assert.equal(getVendorOrderStatusLabel(order), "În pregătire");
  assert.equal(getVendorOrderStatusType(order), "discussion");
});

test("B ter. status confirmed -> label 'Confirmată', tip 'discussion'", () => {
  const order = makeOrder({ status: "confirmed" });
  assert.equal(getVendorOrderStatusLabel(order), "Confirmată");
  assert.equal(getVendorOrderStatusType(order), "discussion");
});

test("B quater. status shipped -> label 'Expediată', tip 'offer'", () => {
  const order = makeOrder({ status: "shipped" });
  assert.equal(getVendorOrderStatusLabel(order), "Expediată");
  assert.equal(getVendorOrderStatusType(order), "offer");
});

test("B quinquies. status fulfilled -> label 'Livrată', tip 'accepted'", () => {
  const order = makeOrder({ status: "fulfilled" });
  assert.equal(getVendorOrderStatusLabel(order), "Livrată");
  assert.equal(getVendorOrderStatusType(order), "accepted");
});

test("B sexies. status cancelled -> label 'Anulată', tip 'pending' (grey, neutru)", () => {
  const order = makeOrder({ status: "cancelled" });
  assert.equal(getVendorOrderStatusLabel(order), "Anulată");
  assert.equal(getVendorOrderStatusType(order), "pending");
});

test("B septies. status necunoscut/lipsă -> fallback sigur 'new'/'Nouă', fără crash", () => {
  assert.equal(getVendorOrderStatus({}), "new");
  assert.equal(getVendorOrderStatus({ status: "CEVA" }), "ceva");
  assert.equal(getVendorOrderStatusLabel({ status: "CEVA" }), "Nouă");
});

/* =========================================================
   C. sortare
========================================================= */

test("C. sortare: new -> preparing -> confirmed -> shipped -> fulfilled -> cancelled, apoi recent primul", () => {
  const orders = [
    makeOrder({ id: "cancelled-1", status: "cancelled", createdAt: "2026-09-22T10:00:00.000Z" }),
    makeOrder({ id: "fulfilled-1", status: "fulfilled", createdAt: "2026-09-19T10:00:00.000Z" }),
    makeOrder({ id: "new-old", status: "new", createdAt: "2026-09-10T10:00:00.000Z" }),
    makeOrder({ id: "shipped-1", status: "shipped", createdAt: "2026-09-18T10:00:00.000Z" }),
    makeOrder({ id: "confirmed-1", status: "confirmed", createdAt: "2026-09-17T10:00:00.000Z" }),
    makeOrder({ id: "new-recent", status: "new", createdAt: "2026-09-21T10:00:00.000Z" }),
    makeOrder({ id: "preparing-1", status: "preparing", createdAt: "2026-09-16T10:00:00.000Z" }),
  ];

  const sorted = sortVendorOrderLeads(orders).map((o) => o.id);

  assert.deepEqual(sorted, [
    "new-recent",
    "new-old",
    "preparing-1",
    "confirmed-1",
    "shipped-1",
    "fulfilled-1",
    "cancelled-1",
  ]);
});

test("C bis. sortVendorOrderLeads nu mută array-ul primit", () => {
  const orders = [
    makeOrder({ id: "a", status: "cancelled" }),
    makeOrder({ id: "b", status: "new" }),
  ];

  const snapshot = orders.map((o) => o.id);
  sortVendorOrderLeads(orders);

  assert.deepEqual(orders.map((o) => o.id), snapshot);
});

test("C ter. pickTopVendorOrderLeads limitează la 5 implicit", () => {
  const orders = Array.from({ length: 8 }, (_, i) =>
    makeOrder({
      id: `o${i}`,
      status: "new",
      createdAt: new Date(2026, 8, i + 1).toISOString(),
    })
  );

  const top = pickTopVendorOrderLeads(orders);
  assert.equal(top.length, 5);
  assert.deepEqual(top.map((o) => o.id), ["o7", "o6", "o5", "o4", "o3"]);
});

/* =========================================================
   D. CARD / COD
========================================================= */

test("D. plată CARD, plătită -> 'Card (plătit)'", () => {
  const order = makeOrder({
    paymentMethod: "CARD",
    paymentStatus: "PAID",
    waitingForCardPayment: false,
  });

  assert.equal(getVendorOrderPaymentLabel(order), "Card (plătit)");
});

test("D bis. plată CARD, neplătită -> 'Card'", () => {
  const order = makeOrder({
    paymentMethod: "CARD",
    paymentStatus: "PENDING",
    waitingForCardPayment: false,
  });

  assert.equal(getVendorOrderPaymentLabel(order), "Card");
});

test("D ter. plată COD -> 'Ramburs la livrare'", () => {
  const order = makeOrder({ paymentMethod: "COD" });
  assert.equal(getVendorOrderPaymentLabel(order), "Ramburs la livrare");
});

/* =========================================================
   E. avans PENDING / PAID / REFUNDED
========================================================= */

test("E. avans NOT_REQUESTED -> nu se afișează deloc", () => {
  const order = makeOrder({ deposit: { status: "NOT_REQUESTED" } });
  assert.equal(hasVendorOrderDeposit(order), false);
  assert.equal(buildVendorOrderDepositDetails(order), null);
  assert.equal(formatVendorOrderDepositSummary(order), null);
});

test("E bis. avans PENDING -> status + requestedAmount", () => {
  const order = makeOrder({
    deposit: {
      status: "PENDING",
      requestedAmount: 50,
      paidAmount: null,
      remainingCodAmount: null,
    },
  });

  const details = buildVendorOrderDepositDetails(order);
  assert.equal(details.status, "PENDING");
  assert.equal(details.statusLabel, "în așteptare");
  assert.equal(details.requestedAmount, 50);
  assert.equal(details.paidAmount, null);

  assert.equal(
    formatVendorOrderDepositSummary(order),
    "Avans în așteptare: 50 RON"
  );
});

test("E ter. avans PAID -> paidAmount + eventual rest ramburs", () => {
  const order = makeOrder({
    deposit: {
      status: "PAID",
      requestedAmount: 50,
      paidAmount: 50,
      remainingCodAmount: 200,
    },
  });

  const details = buildVendorOrderDepositDetails(order);
  assert.equal(details.statusLabel, "plătit");
  assert.equal(details.paidAmount, 50);
  assert.equal(details.remainingCodAmount, 200);

  assert.equal(
    formatVendorOrderDepositSummary(order),
    "Avans plătit: 50 RON (rest ramburs 200 RON)"
  );
});

test("E quater. avans REFUNDED -> fără sumă, doar status", () => {
  const order = makeOrder({
    deposit: {
      status: "REFUNDED",
      requestedAmount: null,
      paidAmount: null,
      remainingCodAmount: null,
    },
  });

  assert.equal(
    formatVendorOrderDepositSummary(order),
    "Avans rambursat"
  );
});

/* =========================================================
   F. unread
========================================================= */

test("F. messageUnreadCount > 0 -> 'Necesită acțiune' = true, apare în descriere", () => {
  const order = makeOrder({ status: "fulfilled", messageUnreadCount: 3 });

  assert.equal(isVendorOrderActionNeeded(order), true);

  const card = buildVendorOrderLeadCard(order);
  assert.match(card.description, /Necesită acțiune/);
  assert.match(card.description, /3 mesaje necitite/);
});

test("F bis. messageUnreadCount === 0 și status non-new -> fără 'Necesită acțiune'", () => {
  const order = makeOrder({ status: "fulfilled", messageUnreadCount: 0 });

  assert.equal(isVendorOrderActionNeeded(order), false);

  const card = buildVendorOrderLeadCard(order);
  assert.doesNotMatch(card.description, /Necesită acțiune/);
});

test("F ter. mergeVendorOrderThreadMeta populează messageThreadId/messageUnreadCount", () => {
  const orders = [makeOrder({ id: "o1" }), makeOrder({ id: "o2" })];

  const merged = mergeVendorOrderThreadMeta(orders, {
    o1: { messageThreadId: "t1", messageUnreadCount: 2 },
  });

  assert.equal(merged[0].messageThreadId, "t1");
  assert.equal(merged[0].messageUnreadCount, 2);
  // o2 rămâne neschimbat (fără intrare în thread-meta)
  assert.equal(merged[1].messageThreadId, null);
  assert.equal(merged[1].messageUnreadCount, 0);
});

/* =========================================================
   G. waitingForCardPayment
========================================================= */

test("G. waitingForCardPayment -> mesaj clar, are prioritate peste metoda de plată", () => {
  const order = makeOrder({
    paymentMethod: "CARD",
    paymentStatus: "PENDING",
    waitingForCardPayment: true,
  });

  assert.equal(
    getVendorOrderPaymentLabel(order),
    "Așteaptă confirmarea plății"
  );

  const card = buildVendorOrderLeadCard(order);
  assert.equal(card.waitingForCardPayment, true);
  assert.match(card.description, /Așteaptă confirmarea plății/);
});

/* =========================================================
   H. multi-vendor - shape pur, nimic dincolo de obiectul primit
========================================================= */

test("H. cardul reflectă STRICT totalul/itemsCount ale acestui vendor, nimic agregat/inventat", () => {
  const order = makeOrder({ total: 120.5, itemsCount: 1 });
  const card = buildVendorOrderLeadCard(order);

  assert.equal(formatVendorOrderTotal(order), "120.50 RON");
  assert.match(card.description, /120\.50 RON/);
  assert.match(card.description, /1 produs\b/);
  assert.equal(card.order, order); // referință directă, nicio copie parțială/agregare
});

test("H bis. cerere fără total/itemsCount -> nu crapă, doar omite segmentele lipsă", () => {
  const order = makeOrder({ total: null, itemsCount: null });
  assert.equal(formatVendorOrderTotal(order), null);

  const card = buildVendorOrderLeadCard(order);
  assert.equal(typeof card.description, "string");
});

/* =========================================================
   I. eroare/retry - formatare (structurală, fără rețea)
========================================================= */

test("I. RETRY_VENDOR_ORDER_LEADS_ACTION e un string stabil, nevid", () => {
  assert.equal(typeof RETRY_VENDOR_ORDER_LEADS_ACTION, "string");
  assert.ok(RETRY_VENDOR_ORDER_LEADS_ACTION.length > 0);
});

/* =========================================================
   J. structural - determinism + referință `order` păstrată
========================================================= */

test("J. buildVendorOrderLeadCard e determinist (același input -> același output)", () => {
  const order = makeOrder();
  const a = buildVendorOrderLeadCard(order);
  const b = buildVendorOrderLeadCard(order);

  assert.deepEqual({ ...a, order: null }, { ...b, order: null });
});

test("J bis. card.order e EXACT obiectul original (pentru navigare /vendor/orders/:id)", () => {
  const order = makeOrder({ id: "ref-test" });
  const card = buildVendorOrderLeadCard(order);

  assert.equal(card.order, order);
  assert.equal(card.id, "ref-test");
});
