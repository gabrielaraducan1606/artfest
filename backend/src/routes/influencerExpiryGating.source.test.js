// Verificare de sursă (fișierele de rute pentru colecții/propuneri de
// remunerație au dependințe grele - multer/R2/openai/bcrypt/mailer - un
// harness HTTP complet ar cere un fake DB disproporționat de mare pentru
// un singur punct de gating). Verificat funcțional, end-to-end, prin HTTP:
// influencerCollaborationGate.test.js (helper pur) și
// influencerDiscountCodesRoutes.expiry.test.js (aceeași integrare, pe un
// fișier cu dependințe ușoare) - EXACT ACELAȘI helper e apelat aici.
//
// Rulare: node --test src/routes/influencerExpiryGating.source.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readSource(name) {
  return (await readFile(new URL(`./${name}`, import.meta.url), "utf8")).replace(
    /\r\n/g,
    "\n"
  );
}

test("colecții: creare nouă e gated de resolveCollaborationGate, imediat după requireInfluencer", async () => {
  const source = await readSource("influencerCollectionRoutes.js");

  const createHandler = source.slice(
    source.indexOf('router.post(\n  "/",'),
    source.indexOf('router.post(\n  "/",') + 1500
  );

  assert.match(createHandler, /requireInfluencer\(/);
  assert.match(createHandler, /resolveCollaborationGate\(influencer\)/);
  assert.match(createHandler, /canStartNewCommercialActivity/);
  assert.match(createHandler, /status\(403\)/);
  // gate-ul trebuie să fie ÎNAINTE de create, nu după
  assert.ok(
    createHandler.indexOf("resolveCollaborationGate") <
      createHandler.indexOf("influencerCollection.create")
  );
});

test("colecții: PATCH blochează DOAR publicarea (isActive: true), nu și restul editărilor", async () => {
  const source = await readSource("influencerCollectionRoutes.js");

  const patchStart = source.indexOf('router.patch(\n  "/:id",');
  const patchHandler = source.slice(patchStart, patchStart + 4000);

  // gate-ul e în interiorul ramurii isActive, nu global la începutul handler-ului
  const isActiveBranch = patchHandler.slice(
    patchHandler.indexOf("parsed.data.isActive !==\n        undefined"),
    patchHandler.indexOf("parsed.data.sort !==\n        undefined")
  );

  assert.match(isActiveBranch, /resolveCollaborationGate/);
  assert.match(isActiveBranch, /if \(parsed\.data\.isActive\)/);

  // titlul/descrierea/coverImage nu sunt gated (rămân libere la EXPIRED)
  const titleBranch = patchHandler.slice(0, patchHandler.indexOf("parsed.data.description"));
  assert.equal(/resolveCollaborationGate/.test(titleBranch), false);
});

test("commission-agreement: ACCEPT e gated, DECLINE rămâne neatins", async () => {
  const source = await readSource("influencerRoutes.js");

  const acceptStart = source.indexOf('"/commission-agreement/:id/accept"');
  const declineStart = source.indexOf('"/commission-agreement/:id/decline"');

  assert.ok(acceptStart > -1 && declineStart > -1 && declineStart > acceptStart);

  const acceptHandler = source.slice(acceptStart, declineStart);
  const declineHandler = source.slice(declineStart, declineStart + 6000);

  assert.match(acceptHandler, /resolveCollaborationGate\(user\.influencerProfile\)/);
  assert.match(acceptHandler, /canStartNewCommercialActivity/);

  // refuzul unei propuneri NU trebuie blocat de colaborare
  assert.equal(/resolveCollaborationGate/.test(declineHandler), false);
});

test("dashboard/istoric/payout/fișiere rămân NEATINSE (fără gating de colaborare, cum a cerut secțiunea 9)", async () => {
  const meWiring = await readSource("influencerRoutes.js");
  const payouts = await readSource("influencerPayoutsRoutes.js");
  const files = await readSource("influencerFilesRoutes.js");

  // GET /me
  const meStart = meWiring.indexOf('"/me",');
  const meHandler = meWiring.slice(meStart, meStart + 6000);
  assert.equal(/resolveCollaborationGate/.test(meHandler), false);

  // GET /orders (istoric/earnings)
  const ordersStart = meWiring.indexOf('"/orders",');
  const ordersHandler = meWiring.slice(ordersStart, ordersStart + 3000);
  assert.equal(/resolveCollaborationGate/.test(ordersHandler), false);

  // payout-uri + upload factură + billing-info
  assert.equal(/resolveCollaborationGate/.test(payouts), false);

  // fișierele influencerului
  assert.equal(/resolveCollaborationGate/.test(files), false);
});

test("payout-profile (date fiscale) rămâne accesibil oricând - neatins", async () => {
  const source = await readSource("influencerRoutes.js");

  const getStart = source.indexOf('"/payout-profile",');
  const patchStart = source.indexOf('router.patch(\n  "/payout-profile",');

  const getHandler = source.slice(getStart, getStart + 1500);
  const patchHandler = source.slice(patchStart, patchStart + 3000);

  assert.equal(/resolveCollaborationGate/.test(getHandler), false);
  assert.equal(/resolveCollaborationGate/.test(patchHandler), false);
});
