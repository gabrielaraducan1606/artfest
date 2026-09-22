// „Preferințe cookie”: utilizator fără decizie / cu decizie, deschidere manuală
// după accept/refuz, salvarea modificărilor și retragerea consimțământului.
//
// Rulare: node --experimental-test-module-mocks --test src/lib/cookieConsent.preferences.test.js  (din frontend/)

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// mediu de browser minimal
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = new EventTarget();

const apiCalls = [];
mock.module("./api.js", {
  namedExports: {
    api: async (path, options) => {
      apiCalls.push({ path, body: JSON.parse(options.body) });
      return { ok: true };
    },
  },
});

const {
  COOKIE_CONSENT_VERSION,
  OPEN_COOKIE_PREFERENCES_EVENT,
  hasAnyDecision,
  openCookiePreferences,
  readConsent,
  saveConsent,
} = await import("./cookieConsent.js");
const { initialView, reduceView } = await import("../pages/CookieBanner/cookiePreferencesState.js");

const CONSENT_KEY = "cookie:consent:v1";

beforeEach(() => {
  store.clear();
  apiCalls.length = 0;
});

const categories = (c) => [c.necessary, c.analytics, c.marketing, c.attribution];

test("fără decizie: hasAnyDecision false, valori implicite (doar necesare), banner afișat", () => {
  assert.equal(hasAnyDecision(), false);
  assert.deepEqual(categories(readConsent()), [true, false, false, false]);
  assert.equal(initialView({ hasDecision: hasAnyDecision() }), "banner");
});

test("după ACCEPT ALL: bannerul dispare, dar „Preferințe” se poate deschide și arată valorile curente", () => {
  saveConsent({ analytics: true, marketing: true, attribution: true }, { action: "ACCEPT_ALL" });

  assert.equal(hasAnyDecision(), true);
  assert.equal(initialView({ hasDecision: true }), "closed");

  const received = [];
  window.addEventListener(OPEN_COOKIE_PREFERENCES_EVENT, () => received.push(1));

  assert.equal(openCookiePreferences(), true);
  assert.equal(received.length, 1);

  assert.equal(reduceView("closed", "open-preferences", { hasDecision: hasAnyDecision() }), "preferences");
  assert.deepEqual(categories(readConsent()), [true, true, true, true]);
});

test("după REFUZ (doar necesare): „Preferințe” se deschide și arată tot dezactivat", () => {
  saveConsent({ analytics: false, marketing: false, attribution: false }, { action: "NECESSARY_ONLY" });

  assert.equal(hasAnyDecision(), true);
  assert.equal(reduceView("closed", "open-preferences", { hasDecision: hasAnyDecision() }), "preferences");
  assert.deepEqual(categories(readConsent()), [true, false, false, false]);
});

test("salvarea modificărilor persistă local, emite cookie:consent și trimite către backend", () => {
  saveConsent({ analytics: true, marketing: true, attribution: true }, { action: "ACCEPT_ALL" });

  const events = [];
  window.addEventListener("cookie:consent", (e) => events.push(e.detail));
  apiCalls.length = 0;

  saveConsent(
    { necessary: true, analytics: true, marketing: false, attribution: true },
    { action: "CUSTOM", source: "COOKIE_PREFERENCES" }
  );

  const stored = JSON.parse(store.get(CONSENT_KEY));
  assert.deepEqual([stored.analytics, stored.marketing, stored.attribution], [true, false, true]);
  assert.equal(stored.consentVersion, COOKIE_CONSENT_VERSION);

  assert.equal(events.length, 1);
  assert.equal(events[0].marketing, false);

  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].path, "/api/cookies/consent");
  assert.equal(apiCalls[0].body.action, "CUSTOM");
  assert.equal(apiCalls[0].body.source, "COOKIE_PREFERENCES");
  assert.deepEqual(
    [apiCalls[0].body.analytics, apiCalls[0].body.marketing, apiCalls[0].body.attribution],
    [true, false, true]
  );

  // decizia rămâne validă și se poate redeschide
  assert.equal(hasAnyDecision(), true);
});

test("retragerea atribuirii șterge storage-ul de atribuire, fără să atingă alte chei", () => {
  saveConsent({ analytics: true, marketing: true, attribution: true }, { action: "ACCEPT_ALL" });

  store.set("artfest.influencerAttribution", "x");
  store.set("artfest.referralCode", "REF1");
  store.set("altceva", "ramane");

  saveConsent({ attribution: false }, { action: "CUSTOM", source: "COOKIE_PREFERENCES" });

  assert.equal(store.has("artfest.influencerAttribution"), false);
  assert.equal(store.has("artfest.referralCode"), false);
  assert.equal(store.get("altceva"), "ramane");
  assert.equal(readConsent().attribution, false);
});

test("decizie sub versiune veche: hasAnyDecision false (bannerul reapare), valorile vechi rămân ca inițiale", () => {
  store.set(CONSENT_KEY, JSON.stringify({ analytics: true, marketing: false, consentVersion: "1.0" }));

  assert.equal(hasAnyDecision(), false);
  assert.equal(initialView({ hasDecision: false }), "banner");
  assert.deepEqual(categories(readConsent()), [true, true, false, false]);
});

test("legătura în UI: banner (buton, eveniment, fără dependență de hasAnyDecision) și footer", async () => {
  const banner = await readFile(new URL("../pages/CookieBanner/CookieBanner.jsx", import.meta.url), "utf8");
  const footer = await readFile(new URL("../components/Footer/Footer.jsx", import.meta.url), "utf8");
  const form = await readFile(new URL("../pages/CookieBanner/CookiePreferences.jsx", import.meta.url), "utf8");

  // „Preferințe” nu mai e un link către pagină, ci deschide panoul
  assert.equal(/href="\/preferinte-cookie"/.test(banner), false);
  assert.match(banner, /dispatchView\(\s*"open-preferences"\s*\)/);
  // ascultă evenimentul global
  assert.match(banner, /addEventListener\(\s*OPEN_COOKIE_PREFERENCES_EVENT/);
  assert.match(banner, /isBannerHiddenOnPath\(\s*pathname\s*\)/);

  // footer-ul deschide preferințele oricând
  assert.match(footer, /openCookiePreferences/);
  assert.match(footer, /Preferințe cookie/);

  // formularul are categoriile și acțiunile
  for (const label of ["Statistici", "Marketing și remarketing", "Atribuire recomandări"]) {
    assert.ok(form.includes(label), label);
  }
  assert.match(form, /Salvează preferințele/);
  assert.match(form, /Închide/);
});
