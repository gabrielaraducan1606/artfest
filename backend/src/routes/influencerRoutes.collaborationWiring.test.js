// Verificare statică (fără a porni toate dependențele grele ale
// influencerRoutes.js - vezi și adminInfluencersRoutes.collaboration.test.js
// pentru testele funcționale complete ale calculului în sine) a secțiunii
// 11 din cerința de prelungire: GET /api/influencer/me trebuie să citească
// InfluencerProfile.collaborationEndOverride și să-l dea mai departe la
// EXACT computeCollaborationState (sursa unică) - fără recalcul propriu.
//
// Rulare: node --test src/routes/influencerRoutes.collaborationWiring.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = (
  await readFile(new URL("./influencerRoutes.js", import.meta.url), "utf8")
).replace(/\r\n/g, "\n");

test("select-ul InfluencerProfile din GET /me include collaborationEndOverride", () => {
  const selectStart = source.indexOf("influencerProfile: {\n              select: {");
  const selectEnd = source.indexOf("_count: {", selectStart);
  const select = source.slice(selectStart, selectEnd);

  assert.match(select, /collaborationEndOverride:\s*\n?\s*true/);
});

test("computeCollaborationState din /me primește collaborationEndOverride din profil (nu recalculează)", () => {
  const callStart = source.indexOf("const collaboration = computeCollaborationState({");
  const callEnd = source.indexOf("});", callStart);
  const call = source.slice(callStart, callEnd);

  assert.match(call, /activatedAt:\s*profile\.createdAt/);
  assert.match(call, /status:\s*profile\.status/);
  assert.match(call, /commissionBps:\s*profile\.commissionBps/);
  assert.match(call, /collaborationEndOverride:\s*profile\.collaborationEndOverride/);
});
