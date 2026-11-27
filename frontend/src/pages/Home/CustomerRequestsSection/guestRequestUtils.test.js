// Cereri fără cont - funcțiile pure din formular / confirmare / acces:
// validarea câmpurilor de vizitator, payloadul trimis (fără imagini / valută /
// expirare), ciorna păstrată la autentificare (fără fotografii și fără acord),
// tokenul din #t= scos din bara de adrese.
//
// Rulare: node --test src/pages/Home/CustomerRequestsSection/guestRequestUtils.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DRAFT_STORAGE_KEY,
  QR_REQUEST_PATH,
  buildGuestSubmitPayload,
  clearRequestDraft,
  consumeHashToken,
  displayNameError,
  guestFieldsError,
  isValidEmail,
  readRequestDraft,
  readTokenFromHash,
  saveRequestDraft,
} from "./guestRequestUtils.js";

function memoryStore() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

test("email: format simplu, majuscule și spații acceptate", () => {
  assert.equal(isValidEmail(" Ana@Example.com "), true);
  assert.equal(isValidEmail("ana@example"), false);
  assert.equal(isValidEmail("ana example@x.ro"), false);
  assert.equal(isValidEmail(""), false);
});

test("nume afișat: 2-40 caractere, fără email / link / telefon", () => {
  assert.equal(displayNameError("Ana"), "");
  assert.equal(displayNameError("maria_handmade"), "");
  assert.match(displayNameError("A"), /minimum 2/);
  assert.match(displayNameError("ana@example.com"), /email sau link/);
  assert.match(displayNameError("www.site"), /email sau link/);
  assert.match(displayNameError("Ana 0722 123 456"), /telefon/);
  assert.match(displayNameError("x".repeat(41)), /40/);
});

test("câmpuri vizitator: primul câmp greșit, inclusiv acordul", () => {
  assert.equal(guestFieldsError({ displayName: "Ana", email: "ana@example.com", consent: true }), null);
  assert.equal(guestFieldsError({ displayName: "", email: "ana@example.com", consent: true }).field, "displayName");
  assert.equal(guestFieldsError({ displayName: "Ana", email: "x", consent: true }).field, "email");
  assert.equal(guestFieldsError({ displayName: "Ana", email: "ana@example.com", consent: false }).field, "consent");
});

test("payload vizitator: fără imagini / valută / expirare; email normalizat; acord și cont explicite", () => {
  const payload = buildGuestSubmitPayload({
    requestPayload: { title: "Cutie gravată", description: "Detalii suficiente", images: ["a"], currency: "RON", expiresAt: "x", city: "Buzău" },
    guest: { displayName: " Ana ", email: " ANA@example.com ", consent: true, wantsAccount: true, website: "" },
    startedAt: 123,
    source: "flyer",
  });
  assert.equal(payload.images, undefined);
  assert.equal(payload.currency, undefined);
  assert.equal(payload.expiresAt, undefined);
  assert.equal(payload.email, "ana@example.com");
  assert.equal(payload.displayName, "Ana");
  assert.equal(payload.consent, true);
  assert.equal(payload.wantsAccount, true);
  assert.equal(payload.source, "flyer");
  assert.equal(payload.city, "Buzău");

  const noAnswer = buildGuestSubmitPayload({ requestPayload: {}, guest: { wantsAccount: null, consent: "true" } });
  assert.equal(noAnswer.wantsAccount, false, "„Nu acum” / fără răspuns => fără cont");
  assert.equal(noAnswer.consent, false, "doar true boolean");
});

test("ciorna: salvată fără fotografii și fără acord, restaurată, ștearsă; expiră după 2 ore", () => {
  const store = memoryStore();
  const now = 1_000_000;
  saveRequestDraft(
    {
      form: { title: "Cutie", description: "Detalii", images: [{ url: "blob:x" }] },
      categoryQuery: "Cadouri",
      guest: { displayName: "Ana", email: "ana@example.com", wantsAccount: true, consent: true },
    },
    { now, store }
  );

  const raw = JSON.parse(store.getItem(DRAFT_STORAGE_KEY));
  assert.equal(raw.form.images, undefined);
  assert.equal(raw.guest.consent, undefined);

  const draft = readRequestDraft({ now: now + 60_000, store });
  assert.equal(draft.form.title, "Cutie");
  assert.equal(draft.categoryQuery, "Cadouri");
  assert.equal(draft.guest.email, "ana@example.com");
  assert.equal(draft.guest.wantsAccount, true);

  assert.equal(readRequestDraft({ now: now + 3 * 60 * 60 * 1000, store }), null);
  assert.equal(store.getItem(DRAFT_STORAGE_KEY), null, "ciorna expirată e ștearsă");

  saveRequestDraft({ form: { title: "X" } }, { now, store });
  clearRequestDraft({ store });
  assert.equal(readRequestDraft({ now, store }), null);
});

test("ciorna: stocare indisponibilă / JSON corupt => fără eroare", () => {
  assert.equal(saveRequestDraft({ form: {} }, { store: null }), false);
  const store = memoryStore();
  store.setItem(DRAFT_STORAGE_KEY, "{corupt");
  assert.equal(readRequestDraft({ store }), null);
});

test("token din #t=: doar caractere base64url; scos din bara de adrese", () => {
  const token = "A".repeat(43);
  assert.equal(readTokenFromHash(`#t=${token}`), token);
  assert.equal(readTokenFromHash("#t=scurt"), "");
  assert.equal(readTokenFromHash("#t=<script>alert(1)</script>xxxxxxxxxxxxxx"), "");
  assert.equal(readTokenFromHash(""), "");

  const replaced = [];
  const win = {
    location: { hash: `#t=${token}`, pathname: "/cereri/confirmare", search: "" },
    history: { replaceState: (...args) => replaced.push(args[2]) },
  };
  assert.equal(consumeHashToken({ win }), token);
  assert.deepEqual(replaced, ["/cereri/confirmare"]);
});

test("URL-ul pentru QR deschide direct formularul manual, cu sursa flyer", () => {
  const url = new URL(QR_REQUEST_PATH, "https://www.artfest.ro");
  assert.equal(url.pathname, "/cereri");
  assert.equal(url.searchParams.get("action"), "create-customer-request");
  assert.equal(url.searchParams.get("mode"), "manual");
  assert.equal(url.searchParams.get("src"), "flyer");
});

test("/cerere: păstrează parametrii din QR, src implicit flyer, fără auth/redirect injectate", async () => {
  const { buildQrRequestTarget } = await import("./guestRequestUtils.js");
  const plain = new URL(buildQrRequestTarget(""), "https://www.artfest.ro");
  assert.equal(plain.pathname, "/cereri");
  assert.equal(plain.searchParams.get("action"), "create-customer-request");
  assert.equal(plain.searchParams.get("mode"), "manual");
  assert.equal(plain.searchParams.get("src"), "flyer");

  const withUtm = new URL(
    buildQrRequestTarget("?utm_source=flyer&utm_campaign=targ-craciun&src=targ-buzau&mode=ai&auth=login&redirect=//evil.com"),
    "https://www.artfest.ro"
  );
  assert.equal(withUtm.searchParams.get("utm_source"), "flyer");
  assert.equal(withUtm.searchParams.get("utm_campaign"), "targ-craciun");
  assert.equal(withUtm.searchParams.get("src"), "targ-buzau");
  assert.equal(withUtm.searchParams.get("mode"), "manual");
  assert.equal(withUtm.searchParams.get("auth"), null);
  assert.equal(withUtm.searchParams.get("redirect"), null);
});
