// „Ce poate face comunitatea ta pe Artfest” - verificare că lista e
// construită STRICT din funcționalități reale (nimic inventat, nimic
// dezactivat/admin-only/experimental) și că CTA-urile țintesc rute
// publice reale (extrase direct din App.jsx).
//
// Rulare: node --test src/pages/Influencer/InfluencerDashboardPage/communityFeatures.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CLIENT_CTAS,
  CLIENT_FEATURE_GROUPS,
  CONTENT_IDEAS,
  VENDOR_CTAS,
  VENDOR_FEATURE_GROUPS,
} from "./communityFeaturesData.js";

function allItems(groups) {
  return groups.flatMap((g) => g.items);
}

/* --------------------------- A/B. guest + user (client) --------------------------- */

test("A. funcționalitățile GUEST reale sunt prezente (căutare, foto, asistent, cereri, checkout guest)", () => {
  const titles = allItems(CLIENT_FEATURE_GROUPS).map((i) => i.title);

  for (const expected of [
    "Caută exact ce își doresc",
    "Caută după o fotografie",
    "Cere recomandări asistentului AI",
    "Cere o ofertă personalizată",
    "Primește și compară oferte",
    "Cumpără fără cont",
  ]) {
    assert.ok(titles.includes(expected), expected);
  }

  const guestItems = allItems(CLIENT_FEATURE_GROUPS).filter((i) => i.access === "guest");
  assert.ok(guestItems.length >= 6, "majoritatea funcțiilor client trebuie să fie accesibile fără cont");
});

test("B. funcționalitățile care necesită cont USER sunt marcate distinct (access: \"account\")", () => {
  const items = allItems(CLIENT_FEATURE_GROUPS);
  const accountItems = items.filter((i) => i.access === "account");

  assert.ok(accountItems.length >= 1);
  assert.ok(accountItems.some((i) => /comand/i.test(i.title)));

  // fiecare item are un access valid (guest sau account) - nimic ambiguu
  for (const item of items) {
    assert.ok(["guest", "account"].includes(item.access), item.title);
  }
});

/* --------------------------------- C. vendor --------------------------------- */

test("C. funcționalitățile VENDOR reale sunt prezente (magazin, AI produse, preț, import/export, comenzi, statistici)", () => {
  const titles = allItems(VENDOR_FEATURE_GROUPS).map((i) => i.title);

  for (const expected of [
    "Magazin propriu",
    "Asistent AI pentru produse",
    "Calculator de preț și profit",
    "Import/export produse din Excel",
    "Cereri de ofertă și mesaje",
    "Comenzi și livrare",
    "Coduri de reducere și colecții",
    "Statistici și vizitatori",
  ]) {
    assert.ok(titles.includes(expected), expected);
  }
});

/* ----------------------------- D. zero funcții inventate ----------------------------- */

test("D. nu apar funcționalități inexistente/neconfirmate (produse digitale, video AI, etc.)", () => {
  const allText = JSON.stringify([...CLIENT_FEATURE_GROUPS, ...VENDOR_FEATURE_GROUPS]).toLowerCase();

  // "produse digitale" = doar waitlist (DigitalWaitlistSubscriber), nu funcție live -> exclus deliberat
  assert.equal(allText.includes("produs digital"), false);
  assert.equal(allText.includes("digitale"), false);

  // nu s-au inventat integrări inexistente
  for (const forbidden of ["instagram api", "tiktok shop", "facebook shop", "whatsapp business api"]) {
    assert.equal(allText.includes(forbidden), false, forbidden);
  }
});

/* ------------------------- E. zero funcții disabled/admin-only ------------------------- */

test("E. nu apar funcții admin-only/dezactivate/experimentale", () => {
  const allText = JSON.stringify([...CLIENT_FEATURE_GROUPS, ...VENDOR_FEATURE_GROUPS]).toLowerCase();

  for (const forbidden of ["admin", "experimental", "beta", "în curând", "dezactivat", "waitlist"]) {
    assert.equal(allText.includes(forbidden), false, forbidden);
  }
});

/* --------------------------------- F/G. structură --------------------------------- */

test("F. acordeonul CLIENȚI e grupat inteligent (nu o listă plată de zeci de bullet-uri)", () => {
  assert.ok(CLIENT_FEATURE_GROUPS.length >= 3 && CLIENT_FEATURE_GROUPS.length <= 6);

  const totalItems = allItems(CLIENT_FEATURE_GROUPS).length;
  assert.ok(totalItems >= 5 && totalItems <= 12, `total items: ${totalItems}`);

  for (const group of CLIENT_FEATURE_GROUPS) {
    assert.ok(group.id);
    assert.ok(group.title);
    assert.ok(group.items.length > 0);

    for (const item of group.items) {
      assert.ok(item.icon);
      assert.ok(item.title);
      assert.ok(item.text);
    }
  }
});

test("G. acordeonul VÂNZĂTORI e grupat inteligent", () => {
  assert.ok(VENDOR_FEATURE_GROUPS.length >= 3 && VENDOR_FEATURE_GROUPS.length <= 6);

  const totalItems = allItems(VENDOR_FEATURE_GROUPS).length;
  assert.ok(totalItems >= 5 && totalItems <= 12, `total items: ${totalItems}`);

  for (const group of VENDOR_FEATURE_GROUPS) {
    assert.ok(group.id);
    assert.ok(group.title);
    assert.ok(group.items.length > 0);
  }
});

test("idei de conținut: maxim 5, text simplu", () => {
  assert.ok(CONTENT_IDEAS.length >= 1 && CONTENT_IDEAS.length <= 5);

  for (const idea of CONTENT_IDEAS) {
    assert.equal(typeof idea, "string");
    assert.ok(idea.length > 0);
  }
});

/* ------------------------------- J. CTA-uri / rute reale ------------------------------- */

test("J. toate CTA-urile țintesc rute publice reale, confirmate în App.jsx", async () => {
  const appSource = await readFile(new URL("../../../App.jsx", import.meta.url), "utf8");

  const realPaths = [...appSource.matchAll(/path="([^"]*)"/g)].map((m) => m[1]);

  for (const cta of [...CLIENT_CTAS, ...VENDOR_CTAS]) {
    assert.ok(cta.href.startsWith("/"), `CTA "${cta.label}" trebuie să fie o rută relativă`);

    const matches =
      realPaths.includes(cta.href) ||
      // "/" e ruta rădăcină - poate fi definită ca "path=\"/\"" (deja acoperit mai sus)
      realPaths.some((p) => p === cta.href);

    assert.ok(matches, `CTA "${cta.label}" -> "${cta.href}" nu există ca rută în App.jsx`);
  }
});

test("CTA-urile către rute auth-gated (ex. /onboarding, /vendor/*) nu sunt folosite", () => {
  for (const cta of [...CLIENT_CTAS, ...VENDOR_CTAS]) {
    assert.equal(cta.href.startsWith("/onboarding"), false);
    assert.equal(cta.href.startsWith("/vendor/"), false, cta.href);
    assert.equal(cta.href.startsWith("/cont"), false);
    assert.equal(cta.href.startsWith("/admin"), false);
  }
});
