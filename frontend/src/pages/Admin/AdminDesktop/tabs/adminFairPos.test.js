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
import {
  PROMO_QR_MESSAGE,
  classifyScan,
  formatBarcodeDisplay,
  invalidCodeMessage,
  keyTargetKind,
  scanErrorMessage,
  shouldRedirectToScanner,
  scanRejectMessage,
  unsellableMessage,
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

test("etichetă fără preț tipărit: prețul scris pe etichetă e obligatoriu; fără confirmare „peste etichetă”", () => {
  let state = posReducer(initialPosState, {
    type: "SCANNED",
    item: vendorPriceItem({ blankPriceLabel: true, requiresPrice: true, labelPriceCents: null, salePriceCents: 4500, sellable: true }),
  });
  assert.equal(state.cart[0].labelPriceCents, null);
  assert.equal(state.cart[0].priceInput, "");
  assert.deepEqual(cartInputProblems(state.cart), ["Spiriduș: introdu prețul scris pe etichetă."]);
  state = posReducer(state, { type: "SET_PRICE", inventoryItemId: "i1", value: "60" }); // peste prețul declarat / final
  assert.equal(isAboveLabel(state.cart[0]), false);
  assert.deepEqual(cartInputProblems(state.cart), []);
  assert.deepEqual(cartPayload(state.cart)[0], { inventoryItemId: "i1", quantity: 1, effectiveUnitPriceCents: 6000 });
});

/* ===================== Scanner USB / Bluetooth (mod tastatură) ===================== */

test("scanner: caracterele de final (CR, LF, Tab, NUL), spațiile, cratimele și literele mici sunt eliminate", () => {
  for (const raw of ["AF2345678 9", "af-2345-6789\r", "AF23456789\n", "AF23456789\r\n", "\tAF-2345-6789\t", "AF23456789\u0000", " af 2345 6789 "]) {
    const scan = classifyScan(raw);
    assert.equal(scan.kind, "code", JSON.stringify(raw));
    assert.equal(scan.barcode, "AF23456789", JSON.stringify(raw));
    assert.equal(scan.valid, true, JSON.stringify(raw));
  }
  assert.equal(formatBarcodeDisplay("AF23456789"), "AF-2345-6789");
});

test("scanner: câmp gol / doar Enter sau Tab în plus => ignorat (nicio a doua procesare)", () => {
  for (const raw of ["", "   ", "\r", "\n", "\t", null, undefined]) assert.equal(classifyScan(raw).kind, "empty");
});

test("scanner: QR-ul de promovare (adresă web) e recunoscut și explicat, fără cerere la server", () => {
  for (const raw of ["https://www.artfest.ro", "https://artfest.ro/magazin/atelier-ana", "HTTPS://WWW.ARTFEST.RO", "www.artfest.ro", "httpsÖ--www.artfest.ro"]) {
    assert.equal(classifyScan(raw).kind, "promo", raw);
  }
  assert.match(PROMO_QR_MESSAGE, /QR-ul de promovare/);
  assert.match(PROMO_QR_MESSAGE, /nu codul produsului/);
});

test("scanner: cod cu alt format => „Cod negăsit”, cu ce s-a citit (ex. tastatură greșită)", () => {
  const scan = classifyScan("AF1234");
  assert.equal(scan.valid, false);
  assert.match(invalidCodeMessage(scan), /^Cod negăsit: „AF1234” nu este un cod de produs Artfest/);
  // 0/1/I/L/O/U/Y/Z nu apar în coduri (aceeași regulă ca serverul)
  assert.equal(classifyScan("AF2345678O").valid, false);
  assert.equal(classifyScan("5941234567890").valid, false);
});

test("scanner: mesaje clare pentru cod negăsit, conexiune, sesiune, server", () => {
  assert.equal(scanErrorMessage({ status: 404 }, "AF23456789"), "Cod negăsit: AF-2345-6789 nu există în inventarul târgului.");
  assert.match(scanErrorMessage(new TypeError("Failed to fetch"), "AF23456789"), /^Eroare de conexiune: codul AF-2345-6789 nu a fost verificat/);
  assert.match(scanErrorMessage({ status: 401 }, "AF23456789"), /Autentifică-te din nou/);
  assert.match(scanErrorMessage({ status: 503 }, "AF23456789"), /Eroare de server/);
});

test("scanner: produs nerecepționat / lipsă stoc => mesaj clar, nimic în coș", () => {
  const notReceived = scanned({ sellable: false, reasons: ["not_received"], messages: ["Produsul nu a fost recepționat (nu este în stocul târgului)."] });
  assert.match(unsellableMessage(notReceived), /^Spiriduș: produs nerecepționat/);
  let s = posReducer(initialPosState, { type: "SCANNED", item: notReceived });
  assert.equal(s.cart.length, 0);
  assert.match(s.error, /nerecepționat/);
  const noStock = scanned({ sellable: false, availableQty: 0, reasons: ["insufficient_stock"], messages: ["Stoc insuficient."] });
  s = posReducer(initialPosState, { type: "SCANNED", item: noStock });
  assert.equal(s.error, "Spiriduș: lipsă stoc (disponibil 0).");
  assert.equal(s.cart.length, 0);
});

test("scanner: confirmare la scanare reușită; a doua scanare intenționată crește cantitatea (în limita stocului)", () => {
  let s = posReducer(initialPosState, { type: "SCANNED", item: scanned() });
  assert.equal(s.notice, "Adăugat în coș: Spiriduș");
  s = posReducer(s, { type: "SCANNED", item: scanned() });
  assert.equal(s.cart[0].quantity, 2);
  assert.equal(s.notice, "Adăugat în coș: Spiriduș (cantitate 2)");
  s = posReducer(s, { type: "SCANNED", item: scanned() });
  assert.equal(s.cart[0].quantity, 2);
  assert.match(s.error, /stoc insuficient/);
  assert.equal(s.notice, "");
});

const el = (tagName, extra = {}) => ({ tagName, dataset: {}, closest: () => null, ...extra });

test("scanner: ținta tastei (scanner, preț/cantitate, alt câmp, pagină/buton, fereastră)", () => {
  const scanner = el("INPUT");
  assert.equal(keyTargetKind(scanner, scanner), "scanner");
  assert.equal(keyTargetKind(el("INPUT", { dataset: { posNumeric: "" } }), scanner), "posNumeric");
  assert.equal(keyTargetKind(el("INPUT", { type: "date" }), scanner), "text");
  assert.equal(keyTargetKind(el("TEXTAREA"), scanner), "text");
  assert.equal(keyTargetKind(el("INPUT", { type: "checkbox" }), scanner), "other");
  assert.equal(keyTargetKind(el("BUTTON"), scanner), "other");
  assert.equal(keyTargetKind(el("BODY"), scanner), "other");
  assert.equal(keyTargetKind(null, scanner), "other");
  assert.equal(keyTargetKind(el("INPUT", { closest: () => ({}) }), scanner), "dialog");
});

test("scanner: ce se mută în câmpul de scanare (fără a fura focusul la editarea prețului)", () => {
  const k = (key, extra = {}) => ({ key, ...extra });
  // pagină / buton / bifă: orice caracter, nu spațiul (apasă butonul), nu scurtăturile
  assert.equal(shouldRedirectToScanner(k("A"), "other"), true);
  assert.equal(shouldRedirectToScanner(k("7"), "other"), true);
  assert.equal(shouldRedirectToScanner(k(" "), "other"), false);
  assert.equal(shouldRedirectToScanner(k("c", { ctrlKey: true }), "other"), false);
  assert.equal(shouldRedirectToScanner(k("Enter"), "other"), false);
  // preț / cantitate: literele (începutul unui cod AF) da, cifrele / virgula / ștergerea nu
  assert.equal(shouldRedirectToScanner(k("A"), "posNumeric"), true);
  assert.equal(shouldRedirectToScanner(k("f"), "posNumeric"), true);
  for (const key of ["4", ",", ".", "Backspace", "ArrowLeft", "Tab", "Enter"]) {
    assert.equal(shouldRedirectToScanner(k(key), "posNumeric"), false, key);
  }
  // câmpul de scanare, alt câmp text, o fereastră: niciodată
  for (const kind of ["scanner", "text", "dialog"]) assert.equal(shouldRedirectToScanner(k("A"), kind), false, kind);
});

test("camera și scanner: aceeași regulă de adăugare (o bucată; refuz la stoc / nevandabil)", () => {
  assert.equal(scanRejectMessage([], scanned()), "");
  const cart = posReducer(posReducer(initialPosState, { type: "SCANNED", item: scanned() }), { type: "SCANNED", item: scanned() }).cart;
  assert.equal(cart[0].quantity, 2);
  assert.equal(scanRejectMessage(cart, scanned()), "Spiriduș: stoc insuficient (disponibil 2).");
  assert.match(scanRejectMessage([], scanned({ sellable: false, reasons: ["not_received"] })), /nerecepționat/);
});
