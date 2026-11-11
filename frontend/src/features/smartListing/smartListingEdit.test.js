// Editarea în Smart Listing: payloadul trimite DOAR ce s-a modificat; tot restul produsului
// rămâne identic. Produse simulate complexe; fără rețea, fără AI real.
// Rulare: node --test src/features/smartListing/smartListingEdit.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  EDIT_AI_FIELDS,
  acceptEditSuggestion,
  buildEditPayload,
  changedSinceLoaded,
  editFormFromProduct,
  editSuggestionsFromProposal,
  hasEditChanges,
  planCollectionChanges,
} from "./smartListingEdit.js";
import { applyProductCollectionChanges, loadProductCollectionMembership } from "./smartListingProductCollections.js";
import { buildProductPayload } from "../../pages/Vendor/ProfilMagazin/utils/productPayload.js";
import { gpsrConfirmationRule } from "../../utils/gpsrConfirmationRule.js";

/* ---------------- produse simulate (forma GET /api/vendors/products/:id) ---------------- */

const base = {
  id: "p-1",
  title: "Lumânare din ceară de soia",
  description: "Turnată manual.\n\nÎn borcan de sticlă.",
  price: 89.5,
  priceCents: 8950,
  currency: "RON",
  images: ["https://media.example.test/a.jpg"],
  videoUrl: null,
  videoMuted: false,
  category: "home_lumanari-parfumate",
  additionalCategories: ["cadouri_pentru-ea"],
  isActive: true,
  isHidden: false,
  moderationStatus: "APPROVED",
  availability: "READY",
  readyQty: 7,
  leadTimeDays: null,
  nextShipDate: null,
  acceptsCustom: false,
  color: "cream",
  materialMain: "Ceară de soia",
  technique: "Turnare manuală",
  styleTags: ["Minimalist", "Rustic"],
  occasionTags: ["Zi de naștere"],
  dimensions: "8 x 10 cm",
  careInstructions: "Taie fitilul la 5 mm.",
  specialNotes: "",
  shippingWeightGrams: 450,
  shippingLengthCm: 12,
  shippingWidthCm: 12,
  shippingHeightCm: 14,
  isOwnManufacturer: true,
  manufacturerName: null,
  manufacturerAddress: null,
  manufacturerEmail: null,
  manufacturerInEU: null,
  responsiblePersonName: null,
  responsiblePersonAddress: null,
  responsiblePersonEmail: null,
  safetyWarnings: "Nu lăsa lumânarea aprinsă nesupravegheată.",
  isForChildren: false,
  orderMode: "READY_TO_BUY",
  optionsSchema: [],
  customSchema: [],
  repeatedGroups: [],
  quoteSchema: [],
  updatedAt: "2026-11-11T10:00:00.000Z",
};

const PRODUCTS = {
  oneImage: base,
  manyPhotos: { ...base, id: "p-2", images: ["https://m.test/1.jpg", "https://m.test/2.jpg", "https://m.test/3.jpg", "https://m.test/4.jpg"] },
  variants: {
    ...base,
    id: "p-3",
    orderMode: "OPTIONS",
    optionsSchema: [
      { key: "marime", label: "Mărime", type: "select", required: true, options: [{ value: "s", label: "S", priceDeltaCents: 0, stock: 3 }, { value: "l", label: "L", priceDeltaCents: 1500, stock: 0 }] },
      { key: "parfum", label: "Parfum", type: "select", required: true, options: [{ value: "lav", label: "Lavandă" }, { value: "van", label: "Vanilie" }] },
    ],
    combinationPriceOverrides: { "marime:l|parfum:van": 12000 },
  },
  personalized: {
    ...base,
    id: "p-4",
    orderMode: "OPTIONS",
    acceptsCustom: true,
    customSchema: [{ key: "nume", label: "Nume pe etichetă", type: "text", required: true, maxLength: 12 }],
    repeatedGroups: [{ key: "persoane", label: "Persoane", min: 1, max: 4, fields: [{ key: "n", label: "Nume", type: "text" }] }],
  },
  madeToOrder: { ...base, id: "p-5", availability: "MADE_TO_ORDER", readyQty: null, leadTimeDays: 10 },
  externalManufacturer: {
    ...base,
    id: "p-6",
    isOwnManufacturer: false,
    manufacturerName: "Ceramica Exemplu SRL",
    manufacturerAddress: "Str. Morii 4, Sibiu",
    manufacturerEmail: "contact@ceramica.test",
    manufacturerInEU: false,
    responsiblePersonName: "Importator SRL",
    responsiblePersonAddress: "Bd. Unirii 1, București",
    responsiblePersonEmail: "rp@importator.test",
  },
  privatePending: { ...base, id: "p-7", isActive: false, isHidden: true, moderationStatus: "PENDING" },
  quote: { ...base, id: "p-8", orderMode: "QUOTE_ONLY", quoteSchema: [{ key: "q1", label: "Ce dimensiune dorești?", type: "text" }] },
  preorder: { ...base, id: "p-9", availability: "PREORDER", readyQty: null, nextShipDate: "2026-12-15T00:00:00.000Z" },
  legacyNoCategory: { ...base, id: "p-10", category: "" },
};

/** Serverul: PUT parțial = câmpurile primite peste cele existente. */
const serverMerge = (before, payload) => ({ ...before, ...payload });

function assertOnlyChanged(product, edit, expectedKeys) {
  const original = editFormFromProduct(product);
  const edited = edit({ ...original });
  const { payload, changed } = buildEditPayload(original, edited);
  assert.deepEqual([...changed].sort(), [...expectedKeys].sort(), `${product.id}: câmpuri trimise`);
  // înainte / după: tot ce NU e trimis rămâne identic cu originalul
  let before;
  try {
    before = buildProductPayload(original);
  } catch {
    before = null;
  }
  if (before) {
    const after = serverMerge(before, payload);
    for (const key of Object.keys(before)) {
      if (!expectedKeys.includes(key)) assert.deepEqual(after[key], before[key], `${product.id}: ${key} neatins`);
    }
  }
  return payload;
}

/* ---------------- 1-11: fiecare tip de produs ---------------- */

test("1. o singură imagine: schimbarea titlului trimite DOAR titlul", () => {
  const payload = assertOnlyChanged(PRODUCTS.oneImage, (f) => ({ ...f, title: "Lumânare parfumată din soia" }), ["title"]);
  assert.deepEqual(payload, { title: "Lumânare parfumată din soia" });
});

test("2. mai multe fotografii: reordonarea trimite doar lista de imagini, în noua ordine", () => {
  const payload = assertOnlyChanged(PRODUCTS.manyPhotos, (f) => ({ ...f, images: [f.images[2], f.images[0], f.images[1], f.images[3]] }), ["images"]);
  assert.deepEqual(payload.images, ["https://m.test/3.jpg", "https://m.test/1.jpg", "https://m.test/2.jpg", "https://m.test/4.jpg"]);
});

test("3. variante și stocuri: prețul de bază se schimbă, variantele și prețurile pe combinații NU pleacă", () => {
  const payload = assertOnlyChanged(PRODUCTS.variants, (f) => ({ ...f, price: "95" }), ["price"]);
  assert.equal(payload.price, 95);
  for (const key of ["optionsSchema", "customSchema", "orderMode", "repeatedGroups", "combinationPriceOverrides"]) assert.equal(key in payload, false, key);
  // stocul general: tot grupul de disponibilitate, nimic din variante
  const stock = assertOnlyChanged(PRODUCTS.variants, (f) => ({ ...f, readyQty: "12" }), ["availability", "leadTimeDays", "readyQty", "nextShipDate"]);
  assert.equal(stock.readyQty, 12);
  assert.equal("optionsSchema" in stock, false);
});

test("4. personalizabil: câmpurile de personalizare și grupurile repetate rămân neatinse", () => {
  const payload = assertOnlyChanged(PRODUCTS.personalized, (f) => ({ ...f, description: "Descriere nouă, mai clară." }), ["description"]);
  assert.equal("customSchema" in payload, false);
  assert.equal("repeatedGroups" in payload, false);
  assert.equal("acceptsCustom" in payload, false);
});

test("5. realizat la comandă: termenul nou pleacă împreună cu disponibilitatea", () => {
  const payload = assertOnlyChanged(PRODUCTS.madeToOrder, (f) => ({ ...f, leadTimeDays: "14" }), ["availability", "leadTimeDays", "readyQty", "nextShipDate"]);
  assert.equal(payload.availability, "MADE_TO_ORDER");
  assert.equal(payload.leadTimeDays, 14);
  // neatins: nimic despre termen
  assert.deepEqual(buildEditPayload(editFormFromProduct(PRODUCTS.madeToOrder), editFormFromProduct(PRODUCTS.madeToOrder)).changed, []);
});

test("6. producător extern: schimbarea adresei trimite tot grupul GPSR, cu celelalte valori neschimbate", () => {
  const payload = assertOnlyChanged(
    PRODUCTS.externalManufacturer,
    (f) => ({ ...f, manufacturerAddress: "Str. Morii 6, Sibiu" }),
    ["isOwnManufacturer", "manufacturerName", "manufacturerAddress", "manufacturerEmail", "manufacturerInEU", "responsiblePersonName", "responsiblePersonAddress", "responsiblePersonEmail", "safetyWarnings", "isForChildren"]
  );
  assert.equal(payload.manufacturerAddress, "Str. Morii 6, Sibiu");
  assert.equal(payload.manufacturerName, "Ceramica Exemplu SRL");
  assert.equal(payload.responsiblePersonEmail, "rp@importator.test");
  assert.equal(payload.safetyWarnings, "Nu lăsa lumânarea aprinsă nesupravegheată.");
});

test("7+8+12. date GPSR salvate + confirmări anterioare: o editare minoră nu atinge GPSR și nu cere reconfirmare", () => {
  const product = PRODUCTS.externalManufacturer;
  const original = editFormFromProduct(product);
  const edited = { ...original, title: "Vas nou", price: 120 };
  const { payload } = buildEditPayload(original, edited);
  for (const key of ["isOwnManufacturer", "manufacturerName", "safetyWarnings", "isForChildren", "gpsrConfirmation"]) assert.equal(key in payload, false, key);
  assert.equal(gpsrConfirmationRule({ form: edited, editingProduct: original }).required, false);
  // date de siguranță schimbate -> reconfirmare, iar confirmarea pleacă DOAR dacă e bifată
  const safety = { ...original, safetyWarnings: "Conține piese mici." };
  assert.equal(gpsrConfirmationRule({ form: safety, editingProduct: original }).required, true);
  assert.equal("gpsrConfirmation" in buildEditPayload(original, safety).payload, false);
  const confirmed = buildEditPayload(original, { ...safety, gpsrConfirmed: true, gpsrConfirmationSource: "smart_listing" }).payload;
  assert.deepEqual(confirmed.gpsrConfirmation.source, "smart_listing");
  assert.equal(confirmed.gpsrConfirmation.accepted, true);
  assert.ok(!("userId" in confirmed.gpsrConfirmation) && !("acceptedAt" in confirmed.gpsrConfirmation), "identitatea și data le pune serverul");
});

test("10+11. publicat / privat în verificare: vizibilitatea și moderarea nu pleacă la o editare", () => {
  for (const product of [PRODUCTS.oneImage, PRODUCTS.privatePending]) {
    const payload = assertOnlyChanged(product, (f) => ({ ...f, dimensions: "9 x 11 cm" }), ["dimensions"]);
    for (const key of ["isActive", "isHidden", "moderationStatus"]) assert.equal(key in payload, false, `${product.id}: ${key}`);
  }
});

test("cerere de ofertă, precomandă, categorii suplimentare și profil de livrare: neatinse", () => {
  const quote = assertOnlyChanged(PRODUCTS.quote, (f) => ({ ...f, title: "Vas la comandă" }), ["title"]);
  assert.equal("quoteSchema" in quote, false);
  const preorder = editFormFromProduct(PRODUCTS.preorder);
  assert.deepEqual(buildEditPayload(preorder, { ...preorder }).changed, [], "data precomenzii nu se rescrie");
  const cat = assertOnlyChanged(PRODUCTS.oneImage, (f) => ({ ...f, careInstructions: "Ține departe de surse de căldură." }), ["careInstructions"]);
  for (const key of ["additionalCategories", "shippingWeightGrams", "shippingLengthCm"]) assert.equal(key in cat, false, key);
});

test("etichetele (listă pe server, text în formular) nu apar „modificate” dacă nu le atingi", () => {
  const original = editFormFromProduct(PRODUCTS.oneImage);
  assert.equal(original.styleTags, "Minimalist, Rustic");
  assert.equal(hasEditChanges(original, { ...original }), false);
  assert.equal(hasEditChanges(original, { ...original, gpsrConfirmed: true }), false, "bifa singură nu e o modificare");
  assert.equal(hasEditChanges(original, { ...original, styleTags: "Minimalist" }), true);
});

test("produs vechi fără categorie: editarea titlului nu trimite o categorie inventată; salvarea cere categoria doar dacă e validată", () => {
  const original = editFormFromProduct(PRODUCTS.legacyNoCategory);
  assert.throws(() => buildEditPayload(original, { ...original, title: "Titlu nou" }), /categoria/, "validarea editorului rămâne");
  const fixed = buildEditPayload(original, { ...original, title: "Titlu nou", category: "home_lumanari-parfumate" }).payload;
  assert.deepEqual(Object.keys(fixed).sort(), ["additionalCategories", "category", "title"].filter((key) => key in fixed).sort());
  assert.equal(fixed.category, "home_lumanari-parfumate");
});

test("validările rămân: titlu gol sau preț invalid nu se trimit", () => {
  const original = editFormFromProduct(PRODUCTS.oneImage);
  assert.throws(() => buildEditPayload(original, { ...original, title: "  " }), /titlu/);
  assert.throws(() => buildEditPayload(original, { ...original, price: "abc" }), /Preț/);
});

test("produsul modificat între timp e detectat (nu suprascriem modificările altcuiva)", () => {
  assert.equal(changedSinceLoaded({ updatedAt: "2026-11-11T10:00:00Z" }, { updatedAt: "2026-11-11T10:00:00.000Z" }), false);
  assert.equal(changedSinceLoaded({ updatedAt: "2026-11-11T10:00:00Z" }, { updatedAt: "2026-11-11T10:05:00Z" }), true);
});

/* ---------------- AI ---------------- */

test("AI: doar propuneri pentru text; nimic aplicat automat; preț / stoc / material / GPSR niciodată", () => {
  const form = editFormFromProduct(PRODUCTS.oneImage);
  const proposal = {
    fields: {
      title: { value: "Lumânare de soia cu parfum de lavandă", reason: "mai descriptiv" },
      description: { value: form.description },
      category: { value: "home_lumanari-parfumate" },
      styleTags: { value: ["Minimalist", "Boho"] },
      careInstructions: { value: "Altceva" },
      materialMain: { value: "Parafină" },
      price: { value: 10 },
      safetyWarnings: { value: "Inventat" },
    },
  };
  const suggestions = editSuggestionsFromProposal(form, proposal);
  assert.deepEqual(suggestions.map((item) => item.field), ["title", "styleTags"], "doar ce diferă și e permis; îngrijirea existentă nu se înlocuiește");
  assert.equal(suggestions[1].proposed, "Minimalist, Boho");
  assert.ok(EDIT_AI_FIELDS.every((field) => !["price", "readyQty", "materialMain", "dimensions", "safetyWarnings", "images", "optionsSchema"].includes(field)));
  const accepted = acceptEditSuggestion(form, suggestions[0]);
  assert.equal(accepted.title, "Lumânare de soia cu parfum de lavandă");
  assert.equal(accepted.styleTags, form.styleTags, "o singură propunere acceptată = un singur câmp schimbat");
  assert.equal(acceptEditSuggestion(form, { field: "price", proposed: "1" }), form);
  const empty = editSuggestionsFromProposal({ ...form, careInstructions: "" }, proposal);
  assert.ok(empty.some((item) => item.field === "careInstructions"), "completează doar dacă lipsește");
});

/* ---------------- 9: colecții ---------------- */

test("9. colecții: cele existente apar bifate; se scoate DOAR din colecțiile verificate", async () => {
  const calls = [];
  const api = async (path, init = {}) => {
    calls.push(`${init.method || "GET"} ${path}`);
    if (path === "/api/vendor/collections") {
      return { collections: [
        { id: "c1", title: "Crăciun" },
        { id: "c2", title: "Lumânări" },
        { id: "c3", title: "Eroare" },
        { id: "c4", title: "Toate", allOwnProducts: true },
      ] };
    }
    if (path === "/api/vendor/collections/c1") return { collection: { items: [{ productId: "p-1" }] } };
    if (path === "/api/vendor/collections/c2") return { collection: { items: [{ productId: "p-1" }, { productId: "alt" }] } };
    if (path === "/api/vendor/collections/c3") throw Object.assign(new Error("500"), { status: 500 });
    return { ok: true, added: ["c5"], already: [] };
  };
  const membership = await loadProductCollectionMembership({ api, productId: "p-1" });
  assert.deepEqual(membership.memberIds.sort(), ["c1", "c2"]);
  assert.deepEqual(membership.unknownIds, ["c3"]);
  assert.ok(!calls.includes("GET /api/vendor/collections/c4"), "colecția automată nu se citește");

  // debifează c2 (verificată), c3 nu se poate atinge, adaugă c5
  assert.deepEqual(planCollectionChanges({ initialIds: ["c1", "c2", "c3"], selectedIds: ["c1", "c5"], knownIds: ["c1", "c2"] }), { attach: ["c5"], detach: ["c2"] });
  calls.length = 0;
  const result = await applyProductCollectionChanges({ api, productId: "p-1", initialIds: ["c1", "c2"], selectedIds: ["c1", "c5"], knownIds: membership.knownIds });
  assert.deepEqual(calls, ["POST /api/vendor/collections/attach-product", "DELETE /api/vendor/collections/c2/products/p-1"]);
  assert.deepEqual(result.attached, ["c5"]);
  assert.deepEqual(result.detached, ["c2"]);

  // lista nu s-a încărcat -> nimic de eliminat
  const failing = await loadProductCollectionMembership({ api: async () => { throw new Error("x"); }, productId: "p-1" });
  assert.deepEqual(planCollectionChanges({ initialIds: failing.memberIds, selectedIds: [], knownIds: failing.knownIds }), { attach: [], detach: [] });
  assert.match(failing.error, /rămân neschimbate/);
});

/* ---------------- legătura cu interfața ---------------- */

test("editorul salvează prin PUT /api/vendors/products/:id (nu prin creare) și nu arată JSON", () => {
  const page = readFileSync(new URL("./SmartListingEditPage.jsx", import.meta.url), "utf8");
  assert.match(page, /method: "PUT", body: built\.payload/);
  assert.doesNotMatch(page, /store\/[^"]*\/products|createProduct|method: "POST"/, "fără endpointul de creare");
  assert.doesNotMatch(page, /<pre\b|JSON\.stringify|payloadPreview/);
  assert.ok(page.indexOf("changedSinceLoaded(") < page.indexOf('method: "PUT"'), "verificarea modificărilor simultane e înainte de scriere");
  assert.ok(page.indexOf("saveLockRef.current = true") < page.indexOf('method: "PUT"'), "un singur PUT la dublu-click");
  const profil = readFileSync(new URL("../../pages/Vendor/ProfilMagazin/ProfilMagazin.jsx", import.meta.url), "utf8");
  assert.match(profil, /import\.meta\.env\.DEV && !options\.advanced && smartListingAccessFor\(me\)\.canSave/, "doar local + flag; producția rămâne pe ProductModal");
});
