// Verificare statică (fără jsdom) a butonului „Prelungește colaborarea” și
// a reîmprospătării listei/drawer-ului după prelungire (secțiunea 12).
//
// Rulare: node --test src/pages/Admin/AdminMarketing/extendCollaboration.source.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (
  await readFile(new URL("./AdminInfluencersTab.jsx", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

test("drawer: buton „Prelungește colaborarea” în secțiunea Colaborare Artfest, cu Remunerație afișată", () => {
  const section = source.slice(
    source.indexOf("{item.collaboration && ("),
    source.indexOf("Prelungește colaborarea") + 50
  );

  assert.match(section, /label="Remunerație"/);
  assert.match(section, /item\.collaboration\s*\n?\s*\.commissionPercent/);
  assert.match(section, /onExtendCollaboration\?\.\(/);
});

test("modalul e montat condiționat de extendTarget și primește onExtended", () => {
  assert.match(source, /import ExtendCollaborationModal from "\.\/ExtendCollaborationModal\.jsx";/);
  assert.match(source, /\{extendTarget && \(/);
  assert.match(source, /<ExtendCollaborationModal/);
  assert.match(source, /onExtended=\{async \(\) => \{/);
});

test("după prelungire: se reîncarcă lista (loadInfluencers) și se resetează drawer-ul cu itemul actualizat", () => {
  const handler = source.slice(
    source.indexOf("onExtended={async () => {"),
    source.indexOf("onExtended={async () => {") + 900
  );

  assert.match(handler, /await\s*\n?\s*loadInfluencers\(\)/);
  assert.match(handler, /setSelectedInfluencer\(/);
  assert.match(handler, /setExtendTarget\(null\)/);
});

test("deschiderea modalului din drawer închide drawer-ul (același pattern ca la remunerație)", () => {
  const handler = source.slice(
    source.indexOf("onExtendCollaboration={(item) => {"),
    source.indexOf("onExtendCollaboration={(item) => {") + 250
  );

  assert.match(handler, /setSelectedInfluencer\(\s*\n?\s*null\s*\n?\s*\)/);
  assert.match(handler, /setExtendTarget\(\s*\n?\s*item\s*\n?\s*\)/);
});
