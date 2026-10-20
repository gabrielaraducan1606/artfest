// services/indexConsent.test.js
//
// Rulează scriptul inline de Consent Mode din index.html într-un sandbox
// (vm) și verifică starea implicită trimisă către Google ÎNAINTEA GTM.
//
// Rulare: node --test services/indexConsent.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const consentScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => m[1])
  .find((code) => code.includes("'consent', 'default'"));

let lastWindow;
let insertedScripts;

function run({ stored, internal, hostname = "www.artfest.ro", storageThrows = false }) {
  const store = new Map();
  if (stored !== undefined) store.set("cookie:consent:v1", stored);
  if (internal) store.set("artfest:analytics-internal", "1");

  insertedScripts = [];
  const firstScript = {
    parentNode: { insertBefore: (el) => insertedScripts.push(el.src) },
  };

  const window = {
    location: { hostname },
    localStorage: {
      getItem(key) {
        if (storageThrows) throw new Error("blocked");
        return store.has(key) ? store.get(key) : null;
      },
    },
    document: {
      createElement: () => ({}),
      getElementsByTagName: () => [firstScript],
      head: { appendChild: (el) => insertedScripts.push(el.src) },
    },
  };
  window.window = window;

  vm.runInNewContext(consentScript, window);
  lastWindow = window;
  return window.dataLayer.map((entry) =>
    entry && typeof entry === "object" && "length" in entry ? Array.from(entry) : entry
  );
}

const loadsGtm = () => insertedScripts.some((src) => src.includes("gtm.js?id=GTM-TDR5N92F"));
const loadsAds = () => insertedScripts.some((src) => src.includes("gtag/js?id=AW-18196187164"));

// obiectele vin din alt realm (vm) - le copiem ca să comparăm doar valorile
const consentDefault = (dl) =>
  JSON.parse(JSON.stringify(dl.find((c) => c[0] === "consent" && c[1] === "default")[2]));

test("BASIC: niciun tag Google încărcat static în HTML (nici <script src>, nici iframe noscript GTM)", () => {
  assert.ok(consentScript, "scriptul de consent default lipsește");
  assert.doesNotMatch(html, /<script[^>]+src="https:\/\/www\.googletagmanager\.com/);
  assert.doesNotMatch(html, /ns\.html\?id=GTM/);
});

test("BASIC: fără alegere salvată -> nici GTM, nici Google Ads; în dataLayer doar consimțământ și setări", () => {
  const dl = run({});
  assert.equal(insertedScripts.length, 0);
  assert.ok(!dl.some((c) => c && c.event === "gtm.js"));
  assert.ok(!dl.some((c) => Array.isArray(c) && c[0] === "event"), "niciun eveniment în coadă");
  assert.ok(!dl.some((c) => Array.isArray(c) && c[0] === "config"));
});

test("BASIC: doar statistici -> GTM (GA4), fără Google Ads", () => {
  run({ stored: JSON.stringify({ analytics: true, marketing: false }) });
  assert.equal(loadsGtm(), true);
  assert.equal(loadsAds(), false);
});

test("BASIC: doar marketing -> Google Ads, fără GTM (GA4 nu rulează fără statistici)", () => {
  const dl = run({ stored: JSON.stringify({ analytics: false, marketing: true }) });
  assert.equal(loadsAds(), true);
  assert.equal(loadsGtm(), false);
  assert.ok(dl.some((c) => Array.isArray(c) && c[0] === "config" && c[1] === "AW-18196187164"));
});

test("BASIC: ambele acceptate -> ambele, ordinea: consent default înaintea gtm.js", () => {
  const dl = run({ stored: JSON.stringify({ analytics: true, marketing: true }) });
  assert.equal(loadsGtm(), true);
  assert.equal(loadsAds(), true);
  const consentIdx = dl.findIndex((c) => Array.isArray(c) && c[0] === "consent");
  const gtmIdx = dl.findIndex((c) => c && c.event === "gtm.js");
  assert.ok(consentIdx >= 0 && consentIdx < gtmIdx);
});

test("acord dat ulterior (banner): încărcare la cerere, o singură dată", () => {
  run({});
  assert.equal(insertedScripts.length, 0);

  lastWindow.artfestApplyConsentTags({ analytics: true, marketing: false });
  assert.equal(loadsGtm(), true);
  assert.equal(loadsAds(), false);

  lastWindow.artfestApplyConsentTags({ analytics: true, marketing: true });
  lastWindow.artfestApplyConsentTags({ analytics: true, marketing: true });
  assert.equal(insertedScripts.length, 2, "GTM și Ads câte o singură dată");
});

test("fără alegere salvată: totul refuzat (niciun tracking publicitar înainte de acord)", () => {
  assert.deepEqual(consentDefault(run({})), {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
});

test("doar statistici acceptate: analytics granted, publicitate refuzată", () => {
  const c = consentDefault(run({ stored: JSON.stringify({ analytics: true, marketing: false }) }));
  assert.equal(c.analytics_storage, "granted");
  assert.equal(c.ad_storage, "denied");
  assert.equal(c.ad_user_data, "denied");
  assert.equal(c.ad_personalization, "denied");
});

test("accept total salvat: toate cele 4 semnale granted", () => {
  const c = consentDefault(run({ stored: JSON.stringify({ analytics: true, marketing: true }) }));
  assert.deepEqual(Object.values(c), ["granted", "granted", "granted", "granted"]);
});

test("valori ne-boolean / JSON corupt / storage blocat: refuzat", () => {
  for (const options of [
    { stored: JSON.stringify({ analytics: "true", marketing: 1 }) },
    { stored: "{corupt" },
    { stored: JSON.stringify({ analytics: true }), storageThrows: true },
  ]) {
    const c = consentDefault(run(options));
    assert.equal(c.analytics_storage, "denied");
    assert.equal(c.ad_storage, "denied");
  }
});

test("ads_data_redaction mereu activ; traffic_type=internal doar pe dispozitive marcate", () => {
  const normal = run({});
  assert.ok(normal.some((c) => c[0] === "set" && c[1] === "ads_data_redaction" && c[2] === true));
  assert.ok(!normal.some((c) => c[0] === "set" && c[1]?.traffic_type));

  const internal = run({ internal: true });
  assert.ok(internal.some((c) => c[0] === "set" && c[1]?.traffic_type === "internal"));
});

test("debug_mode doar în afara domeniului de producție", () => {
  assert.ok(!run({}).some((c) => c[0] === "set" && c[1]?.debug_mode));
  assert.ok(!run({ hostname: "artfest.ro" }).some((c) => c[0] === "set" && c[1]?.debug_mode));
  assert.ok(run({ hostname: "localhost" }).some((c) => c[0] === "set" && c[1]?.debug_mode === true));
});
