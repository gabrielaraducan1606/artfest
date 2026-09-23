// Google pentru CONT EXISTENT (invitație pentru un email care are deja
// un cont Artfest, rol USER) + fix-ul de poziționare/timing pe pagina
// REALĂ de invitație (InfluencerRegisterPage.jsx, ruta /influencer/register).
//
// Context (audit real, nu presupunere): pagina afișată de linkul din
// emailul de invitație este exact InfluencerRegisterPage.jsx (confirmat
// din backend/src/routes/adminInfluencersRoutes.js -> buildInviteUrl()
// -> `${APP_URL}/influencer/register?token=...` -> App.jsx, ruta
// "/influencer/register"). Motivul pentru care butonul Google "nu
// apărea" avea 3 cauze reale, corectate aici:
//
//  1. Pentru un email cu cont Artfest deja existent (foarte probabil
//     cazul testat manual - admin/tester folosește un email propriu,
//     deja înregistrat), pagina NU arăta deloc un buton Google - doar
//     un buton "Conectează-te" care trimitea către /autentificare.
//     Login.jsx are Google funcțional, dar utilizatorul nu-l vede pe
//     pagina de invitație în sine.
//  2. Pentru un email nou (cont nou), butonul Google exista, dar era
//     poziționat ULTIMUL, sub tot formularul cu parolă și butonul
//     principal "Creează contul" - ușor de ratat/de nescrolat.
//  3. Randarea reală a butonului Google (setupGoogle()) rula O SINGURĂ
//     dată, la montare - moment în care invitația încă se verifica și
//     nicio ramură (cont nou/cont existent) nu era montată, deci
//     `googleButtonRef.current` era null. Dacă scriptul Google se
//     încărca mai repede decât răspunsul GET /api/influencer/invite,
//     efectul ieșea fără să randeze nimic și NU se relua ulterior.
//
// Rulare: node --test src/pages/Influencer/InfluencerRegisterPage.googleExisting.source.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (
  await readFile(new URL("./InfluencerRegisterPage.jsx", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start > -1, `marker de start negăsit: ${startMarker}`);

  const end = source.indexOf(endMarker, start);
  assert.ok(end > -1, `marker de sfârșit negăsit: ${endMarker}`);

  return source.slice(start, end);
}

/* --------------------------------------------------------------------
   1. Cauza reală: ramura "cont existent" acum arată Google
-------------------------------------------------------------------- */

test("ramura USER EXISTENT (accountExists) randează un buton Google, nu doar „Conectează-te”", () => {
  const branch = slice(
    "Ai deja un cont Artfest",
    "CONT NOU"
  );

  assert.match(branch, /googleButtonRef/);
  assert.match(branch, /canUseGoogleExisting/);
  assert.match(branch, /Conectează-te cu parola/);
});

test("Google din ramura cont existent NU e gated de checkbox-uri (accept-existing scrie consimțământul server-side)", () => {
  const canUseGoogleExisting = slice(
    "const canUseGoogleExisting =",
    "/* ========================================================="
  );

  assert.equal(canUseGoogleExisting.includes("tosAccepted"), false);
  assert.equal(canUseGoogleExisting.includes("privacyAccepted"), false);
  assert.equal(canUseGoogleExisting.includes("influencerTermsAccepted"), false);
  assert.match(canUseGoogleExisting, /googleReady/);
});

/* --------------------------------------------------------------------
   2. handleGoogleExistingCredential: reutilizează fluxul existent
-------------------------------------------------------------------- */

test("handleGoogleExistingCredential foloseşte mode:\"login\" (nu register) + accept-existing, ca Login.jsx", () => {
  const handler = slice(
    "async function handleGoogleExistingCredential",
    "googleCallbackRef.current ="
  );

  assert.match(handler, /"\/api\/auth\/google"/);
  assert.match(handler, /mode:\s*"login"/);
  assert.equal(handler.includes('mode: "register"'), false);

  assert.match(handler, /"\/api\/influencer\/accept-existing"/);
  assert.match(handler, /body:\s*\{\s*token\s*\}/);

  assert.match(handler, /window\.location\.assign\(/);
});

test("handleGoogleExistingCredential nu importă/duplică helperul Google comun și nu atinge Login.jsx", () => {
  assert.equal(/from ".*Login/.test(source), false);
  assert.equal(/from ".*authGoogle/i.test(source), false);
});

test("handleGoogleExistingCredential mapează codurile de eroare specifice mode:\"login\" (nu doar cele de register)", () => {
  const handler = slice(
    "async function handleGoogleExistingCredential",
    "googleCallbackRef.current ="
  );

  for (const code of [
    "google_account_not_registered",
    "account_locked",
    "google_account_conflict",
    "google_account_unverified",
    "invitation_email_mismatch",
    "invitation_expired",
    "invitation_unavailable",
    "invitation_already_used",
    "role_incompatible",
    "already_influencer",
  ]) {
    assert.ok(handler.includes(code), code);
  }
});

/* --------------------------------------------------------------------
   3. Routare corectă a callback-ului Google (register vs. login)
-------------------------------------------------------------------- */

test("googleCallbackRef routează pe googleMode (\"login\" -> cont existent, altfel -> register)", () => {
  assert.match(
    source,
    /googleCallbackRef\.current =\s*\n?\s*googleMode === "login"\s*\n?\s*\?\s*handleGoogleExistingCredential\s*\n?\s*:\s*handleGoogleCredential/
  );
});

test("googleMode e null pentru alreadyInfluencer/incompatibleRole (acolo NU se randează niciun buton Google)", () => {
  const googleModeBlock = slice(
    "const googleMode =",
    "/* -"
  );

  assert.match(googleModeBlock, /alreadyInfluencer/);
  assert.match(googleModeBlock, /incompatibleRole/);
  assert.match(googleModeBlock, /\?\s*null/);
});

/* --------------------------------------------------------------------
   4. Fix-ul de rasă (timing): butonul se randează DUPĂ ce invitația
      s-a încărcat, nu doar o dată la montare
-------------------------------------------------------------------- */

test("setupGoogle() reia randarea după ce loadingInvite devine false (fix rasă de timing)", () => {
  const effect = slice(
    "GOOGLE - încărcare script + randare buton",
    "  /* =========================================================\n     SUBMIT"
  );

  assert.match(effect, /if \(\s*\n?\s*loadingInvite \|\|\s*\n?\s*!googleMode\s*\n?\s*\)\s*\{\s*\n?\s*return;/);
  assert.match(effect, /!googleButtonRef\.current/);
  assert.match(effect, /\},\s*\[\s*\n?\s*loadingInvite,\s*\n?\s*googleMode,?\s*\n?\s*\]\);/);
});

test("setGoogleReady(true) se apelează DOAR după ce butonul chiar s-a randat (nu necondiționat)", () => {
  const effect = slice(
    "GOOGLE - încărcare script + randare buton",
    "  /* =========================================================\n     SUBMIT"
  );

  const renderButtonIndex = effect.indexOf("renderButton(");
  const readyTrueIndex = effect.indexOf("setGoogleReady(true)");

  assert.ok(renderButtonIndex > -1 && readyTrueIndex > -1);
  assert.ok(
    readyTrueIndex > renderButtonIndex,
    "setGoogleReady(true) trebuie să vină DUPĂ randarea reală a butonului"
  );
});

/* --------------------------------------------------------------------
   5. Fix-ul de poziționare: pe formularul CONT NOU, Google e primul
      lucru vizibil, nu ultimul (sub parolă + submit)
-------------------------------------------------------------------- */

test("CONT NOU: butonul Google apare ÎNAINTE de câmpul Prenume, nu după „Creează contul”", () => {
  const formStart = source.indexOf("CONT NOU\n          =================================================== */");
  assert.ok(formStart > -1);

  const formEnd = source.indexOf("</form>", formStart);
  assert.ok(formEnd > -1);

  const formSlice = source.slice(formStart, formEnd);

  const googleIndex = formSlice.indexOf("styles.googleSection");
  const prenumeIndex = formSlice.indexOf("Prenume");
  const submitIndex = formSlice.indexOf("Creează contul");

  assert.ok(googleIndex > -1 && prenumeIndex > -1 && submitIndex > -1);
  assert.ok(googleIndex < prenumeIndex, "Google trebuie să apară înainte de câmpul Prenume");
  assert.ok(googleIndex < submitIndex, "Google trebuie să apară înainte de butonul de submit, nu după");
});

test("CONT NOU: mesajul de disabled indică explicit unde sunt checkbox-urile (formularul de mai jos)", () => {
  assert.match(source, /Completează formularul de mai jos și acceptă Termenii/);
});
