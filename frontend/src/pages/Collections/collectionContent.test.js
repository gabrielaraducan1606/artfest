// Rulare: node --test src/pages/Collections/collectionContent.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SHORT_DESCRIPTION,
  buildCollectionIntro,
} from "./collectionContent.js";

const LONG = `<p>${"Text lung despre colecție. ".repeat(30)}</p>`;

test("description scurtă => apare sus, ca text, și NU se mai repetă jos", () => {
  const out = buildCollectionIntro({
    subtitle: "Idei de nuntă",
    seoDescription: "Meta description",
    description: "<p>Invitații și mărturii handmade pentru nuntă.</p>",
  });

  assert.equal(out.lead, "Idei de nuntă");
  assert.equal(out.detail, "Invitații și mărturii handmade pentru nuntă.");
  assert.equal(out.bodyHtml, "");
});

test("description lungă => sus seoDescription (scurt), jos description (o singură dată)", () => {
  const out = buildCollectionIntro({
    subtitle: "Idei de nuntă",
    seoDescription: "Invitații și mărturii pentru nuntă.",
    description: LONG,
  });

  assert.equal(out.detail, "Invitații și mărturii pentru nuntă.");
  assert.equal(out.bodyHtml, LONG);
});

test("description lungă fără seoDescription => sus doar subtitle, jos description (fără bloc mare sus)", () => {
  const out = buildCollectionIntro({ subtitle: "Idei", description: LONG });
  assert.equal(out.lead, "Idei");
  assert.equal(out.detail, "");
  assert.equal(out.bodyHtml, LONG);
});

test("nu dublează: detail identic sau inclus în subtitle este omis", () => {
  assert.equal(
    buildCollectionIntro({ subtitle: "Idei de nuntă", seoDescription: "idei de nuntă!" }).detail,
    ""
  );
  assert.equal(
    buildCollectionIntro({
      subtitle: "Invitații și mărturii handmade pentru nuntă",
      seoDescription: "Invitații și mărturii",
    }).detail,
    ""
  );
});

test("nu dublează jos: description lungă care repetă seoDescription sau subtitle nu se mai afișează", () => {
  const repeated = "Text unic ".repeat(50).trim();
  const out = buildCollectionIntro({
    seoDescription: repeated,
    description: `<p>${repeated}</p>`,
  });
  assert.equal(out.bodyHtml, "");
});

test("HTML în description scurtă devine text simplu sus (fără marcaj)", () => {
  const out = buildCollectionIntro({
    description: '<p>Text <strong>bold</strong> <script>alert(1)</script></p>',
  });
  assert.equal(out.detail, "Text bold");
  assert.ok(!/[<>]/.test(out.detail));
});

test("limita între scurt și lung: exact MAX_SHORT_DESCRIPTION e încă scurt", () => {
  const exact = "a".repeat(MAX_SHORT_DESCRIPTION);
  assert.equal(buildCollectionIntro({ description: exact }).detail, exact);
  assert.equal(buildCollectionIntro({ description: exact }).bodyHtml, "");

  const over = "a".repeat(MAX_SHORT_DESCRIPTION + 1);
  assert.equal(buildCollectionIntro({ description: over }).detail, "");
  assert.equal(buildCollectionIntro({ description: over }).bodyHtml, over);
});

test("câmpuri lipsă => nimic (fără chei nedefinite)", () => {
  assert.deepEqual(buildCollectionIntro(), { lead: "", detail: "", bodyHtml: "" });
  assert.deepEqual(buildCollectionIntro({}), { lead: "", detail: "", bodyHtml: "" });
  assert.deepEqual(
    buildCollectionIntro({ subtitle: null, seoDescription: null, description: null }),
    { lead: "", detail: "", bodyHtml: "" }
  );
});
