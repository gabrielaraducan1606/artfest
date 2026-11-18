// src/features/smartListing/smartListingVariantChoice.test.js
//
// „Are variante?” în Smart Listing: „Nu” confirmă direct (fără butonul „Nu are
// variante”), revenirea Da -> Nu, payload-ul salvat și erorile lângă câmpuri.
// Același lanț ca SmartListingPage: răspuns -> variante active -> buildDraftForm ->
// buildCreatePayload (POST) / checkProductForPublish + evaluatePublishGate.
//
// Rulare: node --test src/features/smartListing/smartListingVariantChoice.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  answerHint,
  anchorForBlocker,
  fieldErrorsByAnchor,
  lostOnNo,
  lostOnNoMessage,
  markUnansweredHintsNo,
} from "./smartListingVariantChoice.js";
import { buildDraftForm, evaluatePublishGate } from "./smartListingConfig.js";
import { buildCreatePayload } from "./smartListingSave.js";
import { checkProductForPublish } from "../../utils/productPublishCheck.js";

let counter = 0;
const nextId = (prefix) => `${prefix}-${++counter}`;

const SIZE = { key: "size", label: "Mărime", observedValues: ["S", "M"] };
const COLOR = { key: "color", label: "Culoare", observedValues: [] };

const DETAILS = {
  title: "Lumânare parfumată din ceară de soia",
  description: "Lumânare turnată manual, cu fitil de bumbac și parfum de lavandă.",
  category: "lumanari",
};

// ce face pagina: pe produs ajung doar variantele active (wantsOptions === true)
function payloadFor(state, commerce) {
  const draft = buildDraftForm({
    details: DETAILS,
    images: ["https://cdn.test/p1.jpg"],
    commerce,
    variants: state.wantsOptions === true ? state.variants : [],
    customFields: [],
  });
  const check = checkProductForPublish(draft.form, { knownCategories: ["lumanari"], isNewProduct: true });
  const extra = state.wantsOptions === null ? [{ code: "OPTIONS_UNANSWERED", message: "Răspunde dacă clientul alege o variantă.", step: "sell" }] : [];
  const gate = evaluatePublishGate({ check, draftErrors: draft.errors, extraBlockers: extra });
  return { draft, payload: buildCreatePayload(draft.form), check, gate };
}

const withValues = (variant, labels) => ({
  ...variant,
  values: labels.map((label) => ({ id: nextId("value"), label, deltaLei: "" })),
});

/* ---------------- „Nu” confirmă direct ---------------- */

test("un singur card AI: „Nu” => fără variante (wantsOptions false), pasul nu mai cere alt buton", () => {
  // după analiza AI cu variante propuse, pagina pornește cu wantsOptions = null (nerăspuns)
  const next = answerHint({ hint: SIZE, yes: false, variants: [], variantAnswers: {}, wantsOptions: null, variantHints: [SIZE], nextId });
  assert.equal(next.wantsOptions, false);
  assert.deepEqual(next.variantAnswers, { size: "no" });
  assert.deepEqual(next.variants, []);
});

test("mai multe carduri AI: „Nu” pe unul => cardurile nerăspunse devin „Nu”; „Da” ulterior rămâne posibil", () => {
  const no = answerHint({ hint: SIZE, yes: false, variants: [], variantAnswers: {}, wantsOptions: null, variantHints: [SIZE, COLOR], nextId });
  assert.equal(no.wantsOptions, false);
  assert.deepEqual(no.variantAnswers, { size: "no", color: "no" });

  const yes = answerHint({ hint: COLOR, yes: true, ...no, variantHints: [SIZE, COLOR], nextId });
  assert.equal(yes.wantsOptions, true);
  assert.deepEqual(yes.variantAnswers, { size: "no", color: "yes" });
  assert.deepEqual(yes.variants.map((v) => v.label), ["Culoare"]);
});

test("„Nu” pe un card nu anulează altă variantă aleasă cu „Da” sau adăugată manual", () => {
  const sizeYes = answerHint({ hint: SIZE, yes: true, variants: [], variantAnswers: {}, wantsOptions: null, variantHints: [SIZE, COLOR], nextId });
  const colorNo = answerHint({ hint: COLOR, yes: false, ...sizeYes, variantHints: [SIZE, COLOR], nextId });
  assert.equal(colorNo.wantsOptions, true);
  assert.deepEqual(colorNo.variants.map((v) => v.fromHint), ["size"]);

  const manual = [{ id: "m1", label: "Aromă", required: true, values: [] }];
  const onlyManual = answerHint({ hint: SIZE, yes: false, variants: manual, variantAnswers: {}, wantsOptions: true, variantHints: [SIZE], nextId });
  assert.equal(onlyManual.wantsOptions, true);
});

test("markUnansweredHintsNo păstrează răspunsurile date", () => {
  assert.deepEqual(markUnansweredHintsNo([SIZE, COLOR], { size: "yes" }), { size: "yes", color: "no" });
});

/* ---------------- Da -> Nu: confirmare doar când se pierd date ---------------- */

test("Da -> Nu pe card: confirmare doar dacă varianta are valori completate", () => {
  const yes = answerHint({ hint: SIZE, yes: true, variants: [], variantAnswers: {}, wantsOptions: null, variantHints: [SIZE], nextId });
  assert.deepEqual(lostOnNo({ variants: yes.variants, hint: SIZE }), [], "fără valori => fără confirmare");

  const filled = yes.variants.map((v) => withValues(v, ["S", "M"]));
  const lost = lostOnNo({ variants: filled, hint: SIZE });
  assert.equal(lost.length, 1);
  assert.match(lostOnNoMessage(lost, { fromHint: true }), /„Mărime”.*se șterg/);

  const no = answerHint({ hint: SIZE, yes: false, variants: filled, variantAnswers: yes.variantAnswers, wantsOptions: true, variantHints: [SIZE], nextId });
  assert.equal(no.wantsOptions, false);
  assert.deepEqual(no.variants, []);
});

test("Da -> Nu la întrebarea generală: variantele completate cer confirmare, nu se salvează, revin la „Da”", () => {
  const variants = [withValues({ id: "v1", label: "Aromă", required: true }, ["Lavandă", "Vanilie"]), { id: "v2", label: "", values: [] }];
  const lost = lostOnNo({ variants, wantsOptions: true });
  assert.deepEqual(lost.map((v) => v.id), ["v1"], "doar variantele cu valori");
  assert.match(lostOnNoMessage(lost), /„Aromă”.*nu se salvează pe produs/);
  assert.deepEqual(lostOnNo({ variants, wantsOptions: false }), [], "deja „Nu” => nimic de pierdut");

  const commerce = { saleType: "IN_STOCK", price: "45", stock: "3" };
  const asNo = payloadFor({ wantsOptions: false, variants }, commerce);
  assert.deepEqual(asNo.payload.optionsSchema ?? [], []);
  // ciorna păstrează variantele: la „Da” revin pe produs
  const backToYes = payloadFor({ wantsOptions: true, variants: [variants[0]] }, { ...commerce, leadTimeDays: "5" });
  assert.equal(backToYes.payload.optionsSchema.length, 1);
});

/* ---------------- fluxul complet: payload + validare ---------------- */

test("flux: produs FĂRĂ variante - „Nu” pe card, stoc, payload fără opțiuni, gata de publicare", () => {
  const state = answerHint({ hint: SIZE, yes: false, variants: [], variantAnswers: {}, wantsOptions: null, variantHints: [SIZE], nextId });
  const { payload, gate } = payloadFor(state, { saleType: "IN_STOCK", price: "45", stock: "3" });

  assert.equal(payload.orderMode, "READY_TO_BUY");
  assert.deepEqual(payload.optionsSchema ?? [], []);
  assert.equal(Number(payload.price), 45);
  assert.equal(Number(payload.readyQty), 3);
  // doar blocajele GPSR (separate, la pasul de verificare) - nimic despre variante sau câmpuri de bază
  const codes = gate.blockers.map((b) => b.code);
  assert.ok(!codes.some((c) => /OPTION|VARIANT|PRICE|STOCK|TITLE|CATEGORY|DESCRIPTION/.test(c)), codes.join(","));
});

test("flux: răspuns lipsă => blocaj lângă întrebare; după „Nu” blocajul dispare", () => {
  const unanswered = payloadFor({ wantsOptions: null, variants: [] }, { saleType: "IN_STOCK", price: "45", stock: "3" });
  assert.ok(unanswered.gate.blockers.some((b) => b.code === "OPTIONS_UNANSWERED"));
  assert.ok(fieldErrorsByAnchor(unanswered.gate.blockers)["sl-options"]?.length);

  const answered = answerHint({ hint: SIZE, yes: false, variants: [], variantAnswers: {}, wantsOptions: null, variantHints: [SIZE], nextId });
  const after = payloadFor(answered, { saleType: "IN_STOCK", price: "45", stock: "3" });
  assert.ok(!after.gate.blockers.some((b) => b.code === "OPTIONS_UNANSWERED"));
});

test("flux: produs CU variante - „Da”, valori completate, payload cu opțiunile, fără blocaje de variante", () => {
  const yes = answerHint({ hint: SIZE, yes: true, variants: [], variantAnswers: {}, wantsOptions: null, variantHints: [SIZE], nextId });
  const filled = { ...yes, variants: yes.variants.map((v) => withValues(v, ["S", "M", "L"])) };

  const { payload, gate } = payloadFor(filled, { saleType: "WITH_OPTIONS", price: "60", leadTimeDays: "5" });
  assert.equal(payload.orderMode, "OPTIONS");
  assert.equal(payload.optionsSchema.length, 1);
  assert.equal(payload.optionsSchema[0].label, "Mărime");
  assert.equal(JSON.stringify(payload.optionsSchema[0]).includes('"M"'), true);
  const codes = gate.blockers.map((b) => b.code);
  assert.ok(!codes.some((c) => /OPTION|VARIANT|PRICE|LEAD/.test(c)), codes.join(","));
});

test("flux: „Da” fără valori => eroare la variante; preț / termen lipsă => erori lângă câmpurile lor", () => {
  const yes = answerHint({ hint: SIZE, yes: true, variants: [], variantAnswers: {}, wantsOptions: null, variantHints: [SIZE], nextId });
  const { gate } = payloadFor(yes, { saleType: "WITH_OPTIONS", price: "", leadTimeDays: "" });
  const errors = fieldErrorsByAnchor(gate.blockers);
  assert.ok(errors["sl-options"]?.length, "variantă fără valori");
  assert.ok(errors["sl-price"]?.length, "preț lipsă");
  assert.ok(errors["sl-lead"]?.length, "termen de realizare lipsă");
});

/* ---------------- erori lângă câmpuri ---------------- */

test("fieldErrorsByAnchor: fiecare blocaj ajunge lângă câmpul lui, fără dubluri", () => {
  const map = fieldErrorsByAnchor([
    { code: "TITLE_MISSING", message: "Completează titlul produsului." },
    { code: "TITLE_MISSING", message: "Completează titlul produsului." },
    { code: "CATEGORY_MISSING", message: "Alege o categorie." },
    { code: "STOCK_INVALID", message: "Stoc invalid." },
    { code: "VARIANT_EMPTY_VALUE", message: "Valoare goală." },
    { code: "COMBINATION_X", message: "Combinație." },
    { code: "GPSR_DECLARATION", message: "Bifează GPSR." },
    { code: "IMAGES_MISSING", message: "Adaugă o fotografie." },
    { code: "SHIPPING_WEIGHT_REQUIRED", message: "Greutate (Editor avansat)." },
  ]);
  assert.deepEqual(map["sl-title"], ["Completează titlul produsului."]);
  assert.deepEqual(map["sl-category"], ["Alege o categorie."]);
  assert.deepEqual(map["sl-stock"], ["Stoc invalid."]);
  assert.deepEqual(map["sl-options"], ["Valoare goală.", "Combinație."]);
  assert.deepEqual(map["sl-safety"], ["Bifează GPSR."]);
  assert.deepEqual(map["sl-photos"], ["Adaugă o fotografie."]);
  assert.equal(anchorForBlocker({ code: "SHIPPING_WEIGHT_REQUIRED" }), null, "are propriul mesaj spre Editorul avansat");
});

/* ---------------- pagina: butonul a dispărut, regulile sunt legate ---------------- */

test("SmartListingPage: fără butonul „Nu are variante”; „Continuă” / „Publică” nu mai sunt blocate fără explicație", () => {
  const page = readFileSync(new URL("./SmartListingPage.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /Nu are variante/);
  assert.doesNotMatch(page, /Răspunde la întrebarea despre opțiuni/);
  assert.doesNotMatch(page, /disabled=\{step === "sell" && wantsOptions === null\}/);
  assert.match(page, /answerHint\(\{ hint, yes, variants, variantAnswers, wantsOptions, variantHints, nextId \}\)/);
  assert.match(page, /onClick=\{onPublishClick\}/);
  // editarea unui produs existent nu are pasul de variante (se editează în Editorul avansat)
  const edit = readFileSync(new URL("./SmartListingEditPage.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(edit, /SellStep|wantsOptions/);
});
