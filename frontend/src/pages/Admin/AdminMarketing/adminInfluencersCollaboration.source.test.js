// Verificare statică (fără jsdom, nedisponibil în proiect) a coloanelor
// „Status colaborare / Început / Expiră la” din Admin -> Influenceri:
// sursa datelor este STRICT item.collaboration (backend), nu un calcul
// separat în frontend.
//
// Rulare: node --test src/pages/Admin/AdminMarketing/adminInfluencersCollaboration.source.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (
  await readFile(new URL("./AdminInfluencersTab.jsx", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

test("tabelul are coloanele Status colaborare / Început / Expiră la, lângă Remunerație", () => {
  // fișierul are DOUĂ tabele (top influenceri + lista completă) - vrem
  // antetul tabelului complet, cel cu coloana "Status colaborare"
  const theadStart = source.indexOf("<th>Status colaborare</th>") - 500;
  const theadEnd = source.indexOf("</thead>", theadStart);
  const thead = source.slice(theadStart, theadEnd);

  for (const label of ["Status", "Status colaborare", "Început", "Expiră la", "Remunerație"]) {
    assert.ok(thead.includes(`<th>${label}</th>`), label);
  }

  // ordinea: Status colaborare / Început / Expiră la vin înainte de Remunerație
  assert.ok(
    thead.indexOf("Status colaborare") <
      thead.indexOf("Început") &&
      thead.indexOf("Început") < thead.indexOf("Expiră la") &&
      thead.indexOf("Expiră la") < thead.indexOf("Remunerație")
  );
});

test("statusul de colaborare, datele și procentul vin din item.collaboration, nu sunt recalculate", () => {
  assert.match(source, /getCollaborationStatusLabel\(\s*\n?\s*item\.collaboration\s*\n?\s*\.collaborationStatus/);
  assert.match(source, /formatCollaborationDate\(\s*\n?\s*item\.collaboration\s*\n?\s*\.collaborationStart/);
  assert.match(source, /formatCollaborationDate\(\s*\n?\s*item\.collaboration\s*\n?\s*\.collaborationEnd/);

  const helperFn = source.slice(
    source.indexOf("function getCollaborationStatusLabel"),
    source.indexOf("function formatCollaborationDate") + 500
  );

  // niciun calcul de dată propriu (new Date() + aritmetică) în helperii de UI
  assert.equal(/addMonths|setMonth|3 \* 30|90/.test(helperFn), false);

  for (const key of ["ACTIVE", "EXPIRED", "DISABLED"]) {
    assert.ok(source.includes(`${key}:`), `lipsește eticheta pentru ${key}`);
  }
});

test("invitațiile (fără collaboration) afișează „—”, nu o dată inventată", () => {
  assert.match(source, /item\.collaboration \? \(/);
  assert.match(source, /item\.collaboration\s*\n\s*\? formatCollaborationDate/);
});

test("badge-ul „Expiră în curând” apare doar când expiringSoon === true (tabel și drawer)", () => {
  const occurrences = source.split("Expiră în curând").length - 1;

  assert.ok(occurrences >= 2, "trebuie să apară în tabel și în drawer");
  assert.match(source, /\.expiringSoon &&\s*\(/);
  assert.equal(source.includes('"Expiră în curând"'), false, "textul nu trebuie hardcodat necondiționat");
});

test("statusul REAL al contului (DISABLED) rămâne separat de statusul de colaborare", () => {
  // coloana "Status" existentă (contul) folosește getStatusLabel(item.status);
  // coloana nouă folosește getCollaborationStatusLabel(item.collaboration.collaborationStatus) -
  // cele două nu trebuie combinate într-un singur helper.
  assert.match(source, /getStatusLabel\(\s*\n?\s*item\.status\s*\n?\s*\)/);
  assert.notEqual(
    source.indexOf("function getStatusLabel"),
    source.indexOf("function getCollaborationStatusLabel")
  );
});

test("drawer-ul arată secțiunea „Colaborare Artfest” doar pentru profile (item.collaboration truthy)", () => {
  const section = source.slice(
    source.indexOf("{item.collaboration && ("),
    source.indexOf("Colaborare Artfest") + 50
  );

  assert.match(section, /item\.collaboration && \(/);
});
