// Verificare statică (fără jsdom, nedisponibil în proiect) a cardului
// „Colaborare Artfest”: sursa datelor este STRICT răspunsul backend-ului
// (GET /api/influencer/me -> collaboration), nu un calcul separat în
// frontend.
//
// Rulare: node --test src/pages/Influencer/InfluencerDashboardPage/collaborationCard.source.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (
  await readFile(new URL("./InfluencerDashboardPage.jsx", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

test("„collaboration” este citit din răspunsul /me și transmis cardului", () => {
  assert.match(source, /const\s*\{\s*\n?\s*user,\s*\n?\s*profile,\s*\n?\s*payoutProfile,\s*\n?\s*collaboration,/);
  assert.match(source, /<CollaborationCard/);
  assert.match(source, /collaboration=\{\s*\n?\s*collaboration\s*\n?\s*\}/);
});

test("cardul e montat în tab-ul „home”, vizibil imediat (nu într-un sub-tab ascuns)", () => {
  const homeStart = source.indexOf('activeTab ===\n          "home"');
  const promotionStart = source.indexOf('activeTab ===\n          "promotion"');
  const cardIndex = source.indexOf("<CollaborationCard");

  assert.ok(homeStart > -1 && promotionStart > -1 && cardIndex > -1);
  assert.ok(cardIndex > homeStart && cardIndex < promotionStart, "cardul trebuie să fie în tab-ul home");
});

test("statusul afișat vine din collaborationStatus (backend), nu e recalculat local din date", () => {
  const fn = source.slice(source.indexOf("function CollaborationCard"), source.indexOf("function StatCard"));

  assert.match(fn, /collaborationStatus,/);
  assert.match(fn, /COLLABORATION_STATUS_LABEL\[collaborationStatus\]/);
  // nu trebuie să existe un new Date()/Date.now() propriu pentru a decide statusul
  assert.equal(/new Date\(\)|Date\.now\(\)/.test(fn), false);

  for (const key of ["ACTIVE", "EXPIRED", "DISABLED"]) {
    assert.ok(source.includes(`${key}:`), `lipsește eticheta pentru ${key}`);
  }
});

test("textele informative vin din câmpurile backend-ului, nu sunt duplicate hardcodate", () => {
  const fn = source.slice(source.indexOf("function CollaborationCard"), source.indexOf("function StatCard"));

  assert.match(fn, /\{notice && <div className=\{styles\.infoBox\}>\{notice\}<\/div>\}/);
  assert.match(fn, /\{expiringSoon && expiringSoonNotice && \(/);
  assert.match(fn, /\{expiringSoonNotice\}/);

  // NU un text fix "Condițiile comerciale..." scris direct în JSX (ar duplica sursa)
  assert.equal(fn.includes("Condițiile comerciale pot fi revizuite"), false);
  assert.equal(fn.includes("Colaborarea ta expiră în curând"), false);
});

test("remunerația afișată vine din collaboration.commissionPercent (nu recalculează formula)", () => {
  const fn = source.slice(source.indexOf("function CollaborationCard"), source.indexOf("function StatCard"));

  assert.match(fn, /commissionPercent,/);
  assert.match(fn, /Number\(commissionPercent \|\| 0\)\.toLocaleString\("ro-RO"\)/);
  assert.equal(/commissionBps/.test(fn), false);
});
