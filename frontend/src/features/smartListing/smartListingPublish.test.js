// src/features/smartListing/smartListingPublish.test.js
//
// Publicarea din Smart Listing:
//  - răspunsurile de validare ale API-ului păstrează codul, mesajul și câmpul și
//    duc la pasul + câmpul din formular (înainte: „Unele date nu sunt valide.
//    Verifică formularul.” fără câmp);
//  - produs creat + asociere eșuată la colecții = rezultat separat, fără eroare,
//    deci fără o reîncercare care ar crea un duplicat;
//  - doar un răspuns pierdut la creare face următoarea încercare să caute produsul;
//  - verificarea „gata de publicare” prinde ce ar respinge / arunca serverul.
//
// Rulare: node --test src/features/smartListing/smartListingPublish.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { countUnsavableImages, mergeFieldErrors, readServerValidation } from "./smartListingServerErrors.js";
import { describeSaveError, describeSaveResult, isAmbiguousCreateError, publishNewProduct } from "./smartListingSave.js";
import { buildDraftForm, savableAdditionalCategories } from "./smartListingConfig.js";
import { fieldErrorsByAnchor } from "./smartListingVariantChoice.js";
import { CATEGORIES_DETAILED } from "../../../../backend/src/constants/categories.js";

const KEYS = CATEGORIES_DETAILED.map((c) => c.key);
const IMG = "https://pub.example.r2.dev/products/u/a.jpg";

const apiError = (status, data) => Object.assign(new Error(data?.message || data?.error || `Request failed (${status})`), { status, data });

/* ---------------- erori de validare ---------------- */

test("400 cu `field`: mesajul serverului lângă câmp, pasul și ancora corecte", () => {
  const out = describeSaveError(apiError(400, { error: "invalid_lead_time", field: "leadTimeDays", message: "Scrie în câte zile realizezi produsul." }));
  assert.equal(out.code, "invalid_lead_time");
  assert.equal(out.step, "sell");
  assert.equal(out.anchor, "sl-lead");
  assert.deepEqual(out.fieldErrors, { "sl-lead": ["Scrie în câte zile realizezi produsul."] });
});

test("400 fără `message` (server vechi): mesaj explicit după cod, nu textul generic", () => {
  const out = describeSaveError(apiError(400, { error: "invalid_additional_category", detail: "categorie_veche" }));
  assert.equal(out.code, "invalid_additional_category");
  assert.equal(out.anchor, "sl-category");
  assert.equal(out.step, "details");
  assert.doesNotMatch(out.message, /Unele date nu sunt valide/);
});

test("400 necunoscut: eroare generală, fără coduri tehnice în mesaj (codul rămâne în code)", () => {
  const out = describeSaveError(apiError(400, { error: "ceva_nou" }));
  assert.equal(out.anchor, null);
  assert.deepEqual(out.fieldErrors, {});
  assert.equal(out.code, "ceva_nou");
  assert.doesNotMatch(out.message, /ceva_nou|cod:/);
  assert.match(out.message, /ciornă/);
});

test("400 cu răspuns care nu e JSON (proxy): eroare generală, fără excepție", () => {
  const out = describeSaveError(apiError(400, "<html>Bad Request</html>"));
  assert.equal(out.anchor, null);
  assert.equal(out.code, "http_400");
  assert.doesNotMatch(out.message, /http_400|cod:|<html>/);
  assert.match(out.message, /ciornă/);
});

test("GPSR (validare 400 și confirmare 409) -> secțiunea de siguranță din „Verifică și publică”", () => {
  const a = describeSaveError(apiError(400, { error: "manufacturer_email_invalid", message: "Emailul producătorului nu este valid." }));
  assert.equal(a.anchor, "sl-safety");
  assert.equal(a.step, "review");
  const b = describeSaveError(apiError(409, { error: "gpsr_confirmation_required", message: "Confirmă GPSR." }));
  assert.equal(b.anchor, "sl-safety");
  assert.equal(b.message, "Confirmă GPSR.");
});

test("422 date de contact: câte un mesaj lângă fiecare câmp găsit, focus pe primul", () => {
  const out = describeSaveError(
    apiError(422, {
      error: "contact_info_detected",
      message: "Am găsit date de contact în 2 câmpuri.",
      issues: [
        { field: "description", message: "Telefon în descriere." },
        { field: "careInstructions", message: "Email în îngrijire." },
      ],
    })
  );
  assert.equal(out.code, "contact_info");
  assert.equal(out.anchor, "sl-description");
  assert.deepEqual(out.fieldErrors, { "sl-description": ["Telefon în descriere."], "sl-care": ["Email în îngrijire."] });
});

test("cazurile tratate separat rămân la fel (plan, rețea, 5xx); greutatea coletului nu mai are mesaj propriu", () => {
  assert.equal(describeSaveError(apiError(402, { error: "upgrade_required" })).code, "plan_limit");
  // serverul nu mai cere greutatea la creare: fără trimitere la Editorul avansat pentru greutate
  const weight = describeSaveError(apiError(400, { error: "shipping_weight_required", field: "shippingWeightGrams" }));
  assert.doesNotMatch(weight.message, /Editorul avansat|greutatea coletului/i);
  assert.equal(describeSaveError(new TypeError("Failed to fetch")).code, "no_response");
  assert.equal(describeSaveError(apiError(500, { error: "server_error" })).code, "server");
});

test("readServerValidation: `field` are prioritate față de cod", () => {
  const out = readServerValidation(apiError(400, { error: "invalid_price", field: "price", message: "Preț invalid." }));
  assert.equal(out.anchor, "sl-price");
});

test("mergeFieldErrors: local + server, fără dubluri", () => {
  assert.deepEqual(mergeFieldErrors({ "sl-title": ["a"] }, { "sl-title": ["a", "b"], "sl-lead": ["c"] }), { "sl-title": ["a", "b"], "sl-lead": ["c"] });
});

/* ---------------- publicare: colecții, duplicate, răspuns pierdut ---------------- */

function fakeApi({ createFails = null, list = [] } = {}) {
  const calls = [];
  const api = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || "GET" });
    if ((opts.method || "GET") === "POST") {
      if (createFails) throw createFails;
      return { id: "p-1", title: opts.body.title, images: opts.body.images, moderationStatus: "APPROVED" };
    }
    return { items: list };
  };
  return { api, calls, posts: () => calls.filter((c) => c.method === "POST").length };
}

const form = () => buildDraftForm({
  details: { title: "Lumânare parfumată", description: "Lumânare din ceară de soia.", category: KEYS[0] },
  images: [IMG],
  commerce: { saleType: "IN_STOCK", price: "45", stock: "3" },
  safety: { isOwnManufacturer: true, safetyWarnings: "", isForChildren: false },
}).form;

test("produs creat, colecția eșuează: rezultat de succes cu avertisment, un singur POST", async () => {
  const { api, posts } = fakeApi();
  const order = [];
  const result = await publishNewProduct({
    api,
    storeSlug: "magazin",
    form: form(),
    onCreated: () => order.push("created"),
    attachCollections: async () => {
      order.push("attach");
      throw new Error("attach 500");
    },
  });
  assert.equal(result.saved.id, "p-1");
  assert.equal(result.collectionLines.length, 1);
  assert.match(result.collectionLines[0], /salvat/);
  assert.deepEqual(order, ["created", "attach"]); // ciorna se închide înainte de colecții
  assert.equal(posts(), 1);
});

test("eroare în interfață după creare (onCreated): tot succes, fără reîncercare", async () => {
  const { api, posts } = fakeApi();
  const result = await publishNewProduct({ api, storeSlug: "magazin", form: form(), onCreated: () => { throw new Error("ui"); } });
  assert.equal(result.saved.id, "p-1");
  assert.equal(posts(), 1);
});

test("răspuns pierdut la creare -> ambiguu; reîncercarea găsește produsul și NU face al doilea POST", async () => {
  const lost = fakeApi({ createFails: new TypeError("Failed to fetch") });
  const error = await publishNewProduct({ api: lost.api, storeSlug: "magazin", form: form() }).catch((e) => e);
  assert.equal(error.publishPhase, "create");
  assert.equal(isAmbiguousCreateError(error), true);

  const f = form();
  const retry = fakeApi({ list: [{ id: "p-1", title: f.title, images: f.images }] });
  const result = await publishNewProduct({ api: retry.api, storeSlug: "magazin", form: f, lookupExisting: true });
  assert.equal(result.reused, true);
  assert.equal(retry.posts(), 0);
});

test("eroare la datele producătorului (fără status) NU marchează salvarea ca ambiguă", async () => {
  const { api, posts } = fakeApi();
  const error = await publishNewProduct({
    api,
    storeSlug: "magazin",
    form: form(),
    saveProducer: async () => {
      throw new Error("Datele producătorului: adresa nu este validă.");
    },
  }).catch((e) => e);
  assert.equal(error.publishPhase, "producer");
  assert.equal(isAmbiguousCreateError(error), false);
  assert.equal(posts(), 0);
});

test("400 de validare la creare: nu e ambiguu (produsul nu există)", async () => {
  const { api } = fakeApi({ createFails: apiError(400, { error: "invalid_title" }) });
  const error = await publishNewProduct({ api, storeSlug: "magazin", form: form() }).catch((e) => e);
  assert.equal(error.publishPhase, "create");
  assert.equal(isAmbiguousCreateError(error), false);
  assert.equal(describeSaveError(error).anchor, "sl-title");
});

/* ---------------- „gata de publicare” = ce acceptă serverul ---------------- */

test("categorii suplimentare: doar chei existente, fără principala, max 3 (ca serverul)", () => {
  assert.deepEqual(savableAdditionalCategories(["categorie_veche", KEYS[0], KEYS[1], KEYS[1]], KEYS[0]), [KEYS[1]]);
  assert.equal(savableAdditionalCategories(KEYS.slice(1, 6), KEYS[0]).length, 3);
  const draft = buildDraftForm({ details: { title: "x", category: KEYS[0], additionalCategories: ["categorie_veche"] } });
  assert.deepEqual(draft.form.additionalCategories, []);
});

test("fotografii cu adresă relativă (serverul le-ar arunca) -> blocaj lângă fotografii", () => {
  assert.equal(countUnsavableImages([IMG, "/uploads/a.jpg", "blob:http://x/1"]), 2);
  assert.equal(countUnsavableImages([IMG]), 0);
  assert.deepEqual(fieldErrorsByAnchor([{ code: "PHOTOS_INVALID", message: "m" }]), { "sl-photos": ["m"] });
});

/* ---------------- moderare în coadă + cheia operațiunii de creare ---------------- */

test("cheia operațiunii ajunge în header-ul Idempotency-Key al creării", async () => {
  const headers = [];
  const api = async (path, opts = {}) => {
    if ((opts.method || "GET") === "POST") {
      headers.push(opts.headers || {});
      return { id: "p-1", moderationStatus: "PENDING", moderationQueued: true };
    }
    return { items: [] };
  };
  await publishNewProduct({ api, storeSlug: "magazin", form: form(), idempotencyKey: "op_0123456789abcdef0123" });
  assert.deepEqual(headers, [{ "Idempotency-Key": "op_0123456789abcdef0123" }]);
});

test("după creare cu verificarea în coadă: „salvat și în curs de verificare”, NU „publicat”", () => {
  const view = describeSaveResult({ id: "p", moderationStatus: "PENDING", moderationQueued: true });
  assert.equal(view.tone, "pending");
  assert.equal(view.title, "Produsul a fost salvat și este în curs de verificare.");
  assert.doesNotMatch(JSON.stringify(view), /publicat\./);
  // „Publicat” doar dacă e efectiv public
  assert.equal(describeSaveResult({ moderationStatus: "APPROVED" }).title, "Produsul a fost publicat.");
  assert.notEqual(describeSaveResult({ moderationStatus: "APPROVED", isHidden: true }).title, "Produsul a fost publicat.");
});

test("502 / 504 la creare = fără confirmare (ambiguu), nu „eroare de server”", () => {
  for (const status of [502, 503, 504, 408]) {
    const error = Object.assign(apiError(status, "<html>Bad gateway</html>"), { publishPhase: "create" });
    assert.equal(describeSaveError(error).code, "no_response", String(status));
    assert.equal(isAmbiguousCreateError(error), true, String(status));
  }
});

test("500 real: mesaj în română + codul de diagnostic, fără „server_error”", () => {
  const out = describeSaveError(apiError(500, { error: "server_error", message: "x", diagnosticId: "PAB12C3D" }));
  assert.equal(out.code, "server");
  assert.match(out.message, /eroare pe server/);
  assert.match(out.message, /PAB12C3D/);
  assert.doesNotMatch(out.message, /server_error/);
});

test("409 cheie folosită deja (alte date): mesaj clar, nu validare de câmp", () => {
  const out = describeSaveError(apiError(409, { error: "idempotency_key_reused", productId: "p-1" }));
  assert.equal(out.code, "idempotency_conflict");
  assert.match(out.message, /deja creat/);
});
