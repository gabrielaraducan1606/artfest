// Google + Influencer (cont nou prin invitație): verificare statică.
//
// Confirmă:
//  - fluxul e SELF-CONTAINED în InfluencerRegisterPage.jsx (nu importă
//    nimic din Login.jsx/Register.jsx, nu modifică helperul comun
//    POST /api/auth/google);
//  - mode: "register", asVendor: false (cont USER simplu, ca la Register.jsx
//    partea non-vendor);
//  - NU trimite "influencer_terms" ca și consent către /api/auth/google
//    (schema lui nu îl acceptă - acceptarea o scrie deja
//    /api/influencer/accept-existing, server-side);
//  - după register, apelează /api/influencer/accept-existing cu tokenul
//    invitației (exact rutina deja folosită de Login.jsx -> finishLogin);
//  - gate-ul de consimțăminte (tos/privacy/influencer_terms) e ACELAȘI
//    ca la formularul cu parolă.
//
// Rulare: node --test src/pages/Influencer/InfluencerRegisterPage.google.source.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (
  await readFile(new URL("./InfluencerRegisterPage.jsx", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

test("nu importă nimic din Login.jsx/Register.jsx (flux 100% izolat)", () => {
  assert.equal(/from ".*Login/.test(source), false);
  assert.equal(/from ".*Register\//.test(source), false);
});

test("apelul de înregistrare Google: mode register, asVendor false, fără influencer_terms în consents", () => {
  const handlerStart = source.indexOf("async function handleGoogleCredential");
  const handlerEnd = source.indexOf("googleCallbackRef.current =");
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /mode: "register"/);
  assert.match(handler, /asVendor: false/);
  assert.match(handler, /"\/api\/auth\/google"/);

  const consentsBuild = handler.slice(handler.indexOf("const consents ="), handler.indexOf('"/api/auth/google"'));
  assert.equal(consentsBuild.includes('"influencer_terms"'), false);
  assert.match(consentsBuild, /"tos"/);
  assert.match(consentsBuild, /"privacy_ack"/);
});

test("după register, acceptă invitația prin /api/influencer/accept-existing cu tokenul", () => {
  const handlerStart = source.indexOf("async function handleGoogleCredential");
  const handlerEnd = source.indexOf("googleCallbackRef.current =");
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /"\/api\/influencer\/accept-existing"/);
  assert.match(handler, /body:\s*\{\s*token\s*\}/);
});

test("gestionează aceleași coduri de eroare ca Login.jsx (mismatch/expirat/folosit/rol incompatibil/deja influencer)", () => {
  const handlerStart = source.indexOf("async function handleGoogleCredential");
  const handlerEnd = source.indexOf("googleCallbackRef.current =");
  const handler = source.slice(handlerStart, handlerEnd);

  for (const code of [
    "google_email_already_registered",
    "already_influencer",
    "invitation_email_mismatch",
    "invitation_expired",
    "invitation_unavailable",
    "invitation_already_used",
    "role_incompatible",
  ]) {
    assert.ok(handler.includes(code), code);
  }
});

test("butonul Google e gated de ACELEAȘI 3 consimțăminte obligatorii ca formularul cu parolă", () => {
  assert.match(
    source,
    /const canUseGoogle =[\s\S]{0,300}tosAccepted[\s\S]{0,80}privacyAccepted[\s\S]{0,80}influencerTermsAccepted/
  );
});

test("redirect după succes prin window.location.assign (reîmprospătare completă a sesiunii, ca în Login.jsx)", () => {
  const handlerStart = source.indexOf("async function handleGoogleCredential");
  const handlerEnd = source.indexOf("googleCallbackRef.current =");
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /window\.location\.assign\(/);
});
