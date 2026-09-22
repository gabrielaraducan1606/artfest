// Verificare statică a montării secțiunii „Ce poate face comunitatea ta
// pe Artfest” în dashboardul influencerului (tab dedicat) și a
// responsivității CSS (desktop grid 2 coloane / mobil 1 coloană).
//
// Rulare: node --test src/pages/Influencer/InfluencerDashboardPage/communityFeaturesWiring.source.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { CONTENT_IDEAS } from "./communityFeaturesData.js";

const dashboardSource = (
  await readFile(new URL("./InfluencerDashboardPage.jsx", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

const css = await readFile(
  new URL("./CommunityFeaturesSection.module.css", import.meta.url),
  "utf8"
);

const sectionSource = (
  await readFile(new URL("./CommunityFeaturesSection.jsx", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

const dataSource = (
  await readFile(new URL("./communityFeaturesData.js", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

test("tab-ul „Ce poți promova” e înregistrat în DASHBOARD_TABS, între Acasă și Promovare", () => {
  const tabsBlock = dashboardSource.slice(
    dashboardSource.indexOf("const DASHBOARD_TABS"),
    dashboardSource.indexOf("];", dashboardSource.indexOf("const DASHBOARD_TABS"))
  );

  const homeIndex = tabsBlock.indexOf('id: "home"');
  const communityIndex = tabsBlock.indexOf('id: "community"');
  const promotionIndex = tabsBlock.indexOf('id: "promotion"');

  assert.ok(homeIndex > -1 && communityIndex > -1 && promotionIndex > -1);
  assert.ok(homeIndex < communityIndex && communityIndex < promotionIndex);
});

test("componenta e montată STRICT sub tab-ul community, nu sub alt tab", () => {
  assert.match(dashboardSource, /import CommunityFeaturesSection/);
  assert.match(
    dashboardSource,
    /activeTab ===\s*\n\s*"community" && \(\s*\n\s*<CommunityFeaturesSection \/>/
  );
});

test("H/I. grilă de carduri: 2 coloane implicit (desktop), 1 coloană sub 640px (mobil)", () => {
  assert.match(css, /\.itemsGrid \{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(css, /@media \(max-width: 640px\)\s*\{\s*\.itemsGrid \{[^}]*grid-template-columns:\s*1fr/);
});

test("H/I. rândul de CTA-uri devine coloană pe mobil (butoane pe lățime întreagă)", () => {
  assert.match(css, /@media \(max-width: 640px\)\s*\{\s*\.ctaRow \{[^}]*flex-direction:\s*column/);
});

test("acordeoanele sunt închise implicit, cu un singur panou deschis o dată (compact, nu listă lungă)", () => {
  assert.match(sectionSource, /useState\("clients"\)/); // un panou deschis implicit, celălalt închis
  assert.match(sectionSource, /setOpenPanel/);
});

/* =========================================================
   VERIFICARE VIZUALĂ/UX (nu pare tehnic, scanabil în ~10 secunde)
========================================================= */

test("titlul secțiunii comunică rapid scopul - fără fraze lungi/tehnice", () => {
  assert.match(sectionSource, /Ce poți arăta comunității tale, în câteva secunde\./);

  const subtitleMatch = sectionSource.match(
    /cardSubtitle\}>\s*\n\s*([^<]+?)\s*\n\s*<\/p>/
  );

  assert.ok(subtitleMatch, "subtitlul principal nu a fost găsit");
  assert.ok(subtitleMatch[1].length <= 60, `subtitlu prea lung: "${subtitleMatch[1]}"`);
});

test("nu apar termeni tehnici/interni (AWB, nume de pagină) în textele AFIȘATE (nu în comentarii)", () => {
  // strict pe conținutul afișat (text/title), nu pe comentariile din cod
  const displayed = [...dataSource.matchAll(/(?:text|title):\s*"([^"]+)"/g)]
    .map((m) => m[1].toLowerCase())
    .join(" \n ");

  assert.equal(displayed.includes("awb"), false);
  assert.equal(displayed.includes("costuri & profit"), false);
  assert.equal(/\bendpoint\b/.test(displayed), false);
  assert.equal(/\bapi\b/.test(displayed), false);
});

test("titlurile cardurilor sunt scurte (scanabile dintr-o privire, nu fraze lungi)", () => {
  const titles = [...dataSource.matchAll(/title:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    // excludem titlurile grupurilor/acordeoanelor citite separat mai jos
    .filter((t) => t !== "Pentru clienți" && t !== "Pentru creatori și vânzători");

  for (const title of titles) {
    assert.ok(title.length <= 34, `titlu prea lung ("${title.length}" caractere): "${title}"`);
  }
});

test("ideile de conținut sunt puține (max. 3 în această versiune) - nu ocupă mult spațiu", () => {
  assert.ok(CONTENT_IDEAS.length <= 3, `${CONTENT_IDEAS.length} idei afișate`);
});

test("CTA-urile au o etichetă scurtă de context, nu apar „din senin”", () => {
  assert.match(sectionSource, /ctaLabel/);
  assert.match(sectionSource, /Arată-i comunității tale:/);
});

test("CTA-urile folosesc stil secundar (non-agresiv), nu butonul principal", () => {
  const ctaBlock = sectionSource.slice(sectionSource.indexOf("styles.ctaRow"));

  assert.match(ctaBlock, /dashboardStyles\.secondaryButton/);
  assert.equal(/dashboardStyles\.primaryButton/.test(ctaBlock), false);
});
