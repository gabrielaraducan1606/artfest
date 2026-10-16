// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/adminFairPos.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { canSubmit, cartPayload, formatLei, initialPosState, normalizeBarcode, posReducer } from "./adminFairPos.js";

const scanned = (extra = {}) => ({
  inventoryItemId: "i1",
  title: "Spiriduș",
  variantLabel: null,
  vendor: { name: "Atelier Ana" },
  barcodeDisplay: "AF-2345-6789",
  priceCents: 3900,
  availableQty: 2,
  sellable: true,
  messages: [],
  ...extra,
});

test("scanare: normalizare cod și produs nou în coș", () => {
  assert.equal(normalizeBarcode(" af-2345 6789\n"), "AF23456789");
  const s = posReducer(initialPosState, { type: "SCANNED", item: scanned() });
  assert.equal(s.cart.length, 1);
  assert.equal(s.cart[0].quantity, 1);
  assert.equal(s.cart[0].vendorName, "Atelier Ana");
});

test("produs duplicat în coș: crește cantitatea, în limita stocului", () => {
  let s = posReducer(initialPosState, { type: "SCANNED", item: scanned() });
  s = posReducer(s, { type: "SCANNED", item: scanned() });
  assert.equal(s.cart.length, 1);
  assert.equal(s.cart[0].quantity, 2);
  s = posReducer(s, { type: "SCANNED", item: scanned() });
  assert.equal(s.cart[0].quantity, 2);
  assert.match(s.error, /stoc insuficient/);
});

test("cantitate +/- și setare directă respectă 1..availableQty; eliminare linie", () => {
  let s = posReducer(initialPosState, { type: "SCANNED", item: scanned({ availableQty: 3 }) });
  s = posReducer(s, { type: "INC", inventoryItemId: "i1" });
  s = posReducer(s, { type: "INC", inventoryItemId: "i1" });
  s = posReducer(s, { type: "INC", inventoryItemId: "i1" });
  assert.equal(s.cart[0].quantity, 3);
  s = posReducer(s, { type: "SET_QTY", inventoryItemId: "i1", quantity: 99 });
  assert.equal(s.cart[0].quantity, 3);
  s = posReducer(s, { type: "SET_QTY", inventoryItemId: "i1", quantity: 0 });
  assert.equal(s.cart[0].quantity, 1);
  s = posReducer(s, { type: "DEC", inventoryItemId: "i1" });
  assert.equal(s.cart[0].quantity, 1);
  s = posReducer(s, { type: "REMOVE", inventoryItemId: "i1" });
  assert.equal(s.cart.length, 0);
});

test("produs nevandabil: eroare clară, coșul neschimbat", () => {
  const s = posReducer(initialPosState, {
    type: "SCANNED",
    item: scanned({ sellable: false, messages: ["Eticheta lipsește."] }),
  });
  assert.equal(s.cart.length, 0);
  assert.equal(s.error, "Spiriduș: Eticheta lipsește.");
});

test("payload-ul conține doar id + cantitate (fără preț)", () => {
  const s = posReducer(initialPosState, { type: "SCANNED", item: scanned() });
  assert.deepEqual(cartPayload(s.cart), [{ inventoryItemId: "i1", quantity: 1 }]);
});

test("busy blochează dublu click; succes => coș gol + vânzarea afișată; vânzare nouă => reset", () => {
  let s = posReducer(initialPosState, { type: "SCANNED", item: scanned() });
  const preview = { canConfirm: true };
  assert.equal(canSubmit(s, preview), true);
  assert.equal(canSubmit(s, { canConfirm: false }), false);
  s = posReducer(s, { type: "SUBMIT_START" });
  assert.equal(canSubmit(s, preview), false);
  s = posReducer(s, { type: "SUBMIT_SUCCESS", sale: { receiptReference: "TA26-000001" } });
  assert.deepEqual({ cart: s.cart.length, busy: s.busy, ref: s.lastSale.receiptReference }, { cart: 0, busy: false, ref: "TA26-000001" });
  s = posReducer(s, { type: "NEW_SALE" });
  assert.equal(s.lastSale, null);

  let e = posReducer(posReducer(initialPosState, { type: "SCANNED", item: scanned() }), { type: "SUBMIT_START" });
  e = posReducer(e, { type: "SUBMIT_ERROR", message: "Stoc insuficient." });
  assert.deepEqual({ busy: e.busy, cart: e.cart.length, error: e.error }, { busy: false, cart: 1, error: "Stoc insuficient." });
});

test("format lei", () => {
  assert.equal(formatLei(14349), "143,49 lei");
  assert.equal(formatLei(0), "0,00 lei");
});

test("ciorna returului: doar liniile cu bucăți nereturnate; responsabil + motiv doar la NOT_RESTOCKED / NOT_RETURNED", async () => {
  const { initialReturnDraft, returnPayload, returnDraftProblems, impactText } = await import("./adminFairPos.js");
  const sale = {
    paymentMethod: "CARD",
    lines: [
      { id: "l1", title: "Glob", quantity: 3, returnedQty: 1 },
      { id: "l2", title: "Cană", quantity: 1, returnedQty: 1 },
    ],
  };
  const draft = initialReturnDraft(sale);
  assert.equal(draft.refundMethod, "CARD");
  assert.deepEqual(draft.lines.map((l) => l.saleLineId), ["l1"]);
  assert.deepEqual(returnDraftProblems(draft), ["Alege cel puțin o bucată de returnat.", "Scrie motivul returului."]);

  draft.reason = "Client nemulțumit";
  draft.lines[0].qty = 3;
  draft.lines[0].disposition = "NOT_RETURNED";
  assert.deepEqual(returnDraftProblems(draft), [
    "Glob: se pot returna cel mult 2 buc.",
    "Glob: alege cine suportă rambursarea.",
    "Glob: scrie motivul pentru cine suportă rambursarea.",
  ]);

  draft.lines[0].qty = 2;
  draft.lines[0].refundResponsibility = "ARTFEST";
  draft.lines[0].responsibilityReason = "Gest comercial";
  assert.deepEqual(returnDraftProblems(draft), []);
  assert.deepEqual(returnPayload(draft), {
    reason: "Client nemulțumit",
    refundMethod: "CARD",
    lines: [{ saleLineId: "l1", quantity: 2, disposition: "NOT_RETURNED", refundResponsibility: "ARTFEST", responsibilityReason: "Gest comercial" }],
  });

  // RESTOCKED: responsabilul rămas din altă alegere NU se trimite
  draft.lines[0].disposition = "RESTOCKED";
  assert.deepEqual(returnPayload(draft).lines, [{ saleLineId: "l1", quantity: 2, disposition: "RESTOCKED" }]);
  assert.deepEqual(returnDraftProblems(draft), []);

  assert.equal(impactText({ refundResponsibility: "ARTFEST", artfestBorneRefundCents: 1700 }), "Vendor neafectat. Rambursare suportată de Artfest: 17,00 lei");
  assert.equal(impactText({ refundResponsibility: "VENDOR", responsibilityRequired: true, vendorNetImpactCents: 1530 }), "Net vendor afectat: -15,30 lei");
  assert.equal(impactText({ refundResponsibility: null, responsibilityRequired: false, vendorNetImpactCents: 3960 }), "Net vendor afectat: -39,60 lei");
  assert.equal(impactText({ refundResponsibility: null, responsibilityRequired: true }), "Alege cine suportă rambursarea.");
});
