// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/adminFairPos.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSubmit,
  cartInputProblems,
  cartPayload,
  cartSignature,
  formatLei,
  isAboveLabel,
  initialPosState,
  normalizeBarcode,
  parseLeiToCents,
  posReducer,
} from "./adminFairPos.js";

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

/* ---------- regulamentul 2.0.0: prețul efectiv introdus la casă, doar pentru vânzarea curentă ---------- */

const vendorPriceItem = (extra = {}) =>
  scanned({ pricingModel: "FAIR_PRICE", canEditPrice: true, labelPriceCents: 4333, priceCents: 4333, vendorPriceCents: 3900, suggestedPriceCents: 4333, ...extra });

test("parseLeiToCents: virgulă / punct, gol = fără modificare, invalid = NaN", () => {
  assert.equal(parseLeiToCents("40"), 4000);
  assert.equal(parseLeiToCents("40,5"), 4050);
  assert.equal(parseLeiToCents(" 40.50 "), 4050);
  assert.equal(parseLeiToCents(""), null);
  assert.ok(Number.isNaN(parseLeiToCents("4o")));
  assert.ok(Number.isNaN(parseLeiToCents("40,555")));
});

test("coș: doar prețul efectiv intră în cerere (banii 10% / 90% se calculează pe server); regula 1.x nu trimite prețuri", () => {
  let state = posReducer(initialPosState, { type: "SCANNED", item: vendorPriceItem() });
  state = posReducer(state, { type: "SCANNED", item: scanned({ inventoryItemId: "i2", title: "Cană" }) });
  assert.deepEqual(cartPayload(state.cart), [
    { inventoryItemId: "i1", quantity: 1 },
    { inventoryItemId: "i2", quantity: 1 },
  ]);

  state = posReducer(state, { type: "SET_PRICE", inventoryItemId: "i1", value: "40,00" });
  assert.deepEqual(cartPayload(state.cart)[0], { inventoryItemId: "i1", quantity: 1, effectiveUnitPriceCents: 4000 });

  // prețul declarat și sugerat ajung pe rând, pentru afișare
  assert.equal(state.cart[0].vendorPriceCents, 3900);
  assert.equal(state.cart[0].suggestedPriceCents, 4333);
  // nu există câmpuri pentru suma vânzătorului: rezultă din regula de comision
  assert.deepEqual(Object.keys(cartPayload(state.cart)[0]).sort(), ["effectiveUnitPriceCents", "inventoryItemId", "quantity"]);

  // regula veche: chiar dacă ar exista un preț în stare, nu se trimite
  const old = { ...state.cart[1], priceInput: "10" };
  assert.deepEqual(cartPayload([old]), [{ inventoryItemId: "i2", quantity: 1 }]);
});

test("încasarea: blocată la preț invalid și pe un total calculat pentru alt coș", () => {
  let state = posReducer(initialPosState, { type: "SCANNED", item: vendorPriceItem() });
  const sig = cartSignature(state.cart);
  const preview = { canConfirm: true, signature: sig };
  assert.equal(canSubmit(state, preview, sig), true);

  // prețul s-a schimbat: totalul afișat e vechi până la noul calcul
  state = posReducer(state, { type: "SET_PRICE", inventoryItemId: "i1", value: "41" });
  const newSig = cartSignature(state.cart);
  assert.notEqual(newSig, sig);
  assert.equal(canSubmit(state, preview, newSig), false);
  assert.equal(canSubmit(state, { canConfirm: true, signature: newSig }, newSig), true);

  state = posReducer(state, { type: "SET_PRICE", inventoryItemId: "i1", value: "abc" });
  assert.equal(canSubmit(state, { canConfirm: true, signature: cartSignature(state.cart) }, cartSignature(state.cart)), false);
  assert.deepEqual(cartInputProblems(state.cart), ["Spiriduș: prețul efectiv nu este valid."]);
});

test("preț peste etichetă: cere confirmare explicită; schimbarea prețului anulează confirmarea", () => {
  let state = posReducer(initialPosState, { type: "SCANNED", item: vendorPriceItem({ salePriceCents: 4333 }) });
  state = posReducer(state, { type: "SET_PRICE", inventoryItemId: "i1", value: "45" });
  assert.equal(isAboveLabel(state.cart[0]), true);
  assert.deepEqual(cartInputProblems(state.cart), ["Spiriduș: confirmă prețul mai mare decât cel de pe etichetă."]);
  assert.equal(canSubmit(state, { canConfirm: true, signature: cartSignature(state.cart) }, cartSignature(state.cart)), false);
  // fără confirmare, cererea nu poartă confirmarea
  assert.deepEqual(cartPayload(state.cart)[0], { inventoryItemId: "i1", quantity: 1, effectiveUnitPriceCents: 4500 });

  state = posReducer(state, { type: "CONFIRM_ABOVE_LABEL", inventoryItemId: "i1", value: true });
  assert.deepEqual(cartInputProblems(state.cart), []);
  assert.deepEqual(cartPayload(state.cart)[0], { inventoryItemId: "i1", quantity: 1, effectiveUnitPriceCents: 4500, aboveLabelConfirmed: true });

  // prețul se schimbă => confirmarea se pierde
  state = posReducer(state, { type: "SET_PRICE", inventoryItemId: "i1", value: "46" });
  assert.equal(state.cart[0].aboveLabelConfirmed, false);
  // sub etichetă: fără confirmare
  state = posReducer(state, { type: "SET_PRICE", inventoryItemId: "i1", value: "40" });
  assert.equal(isAboveLabel(state.cart[0]), false);
  assert.deepEqual(cartInputProblems(state.cart), []);
});
