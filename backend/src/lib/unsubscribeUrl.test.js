// Teste: adresa linkului de dezabonare (/api/unsubscribe) și verificarea configurației.
// Fără email, fără bază de date; secret de test setat înainte de import.
//
// Rulare: node --test src/lib/unsubscribeUrl.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.UNSUBSCRIBE_SECRET = "secret-de-test-0123456789-abcdefghij";

const { unsubscribeApiBase, buildApiUnsubscribeUrl, checkUnsubscribeConfig } = await import("./unsubscribeUrl.js");
const { verifyUnsubToken } = await import("./unsubscribe.js");
const SECRET = process.env.UNSUBSCRIBE_SECRET;

test("baza: ruta reală e sub /api (adăugat o singură dată)", () => {
  assert.equal(unsubscribeApiBase({ APP_URL: "https://www.artfest.ro" }), "https://www.artfest.ro/api");
  assert.equal(unsubscribeApiBase({ APP_URL: "https://www.artfest.ro/" }), "https://www.artfest.ro/api");
  assert.equal(unsubscribeApiBase({ PUBLIC_API_URL: "https://artfest.onrender.com/api", APP_URL: "https://www.artfest.ro" }), "https://artfest.onrender.com/api");
  assert.equal(unsubscribeApiBase({ API_URL: "https://artfest.onrender.com" }), "https://artfest.onrender.com/api");
  assert.equal(unsubscribeApiBase({}), null);
});

test("link: semnat, verificabil, categoria marketing, către /api/unsubscribe", () => {
  const url = buildApiUnsubscribeUrl("Ana@T.ro", { env: { APP_URL: "https://www.artfest.ro", UNSUBSCRIBE_SECRET: SECRET, NODE_ENV: "production" } });
  assert.match(url, /^https:\/\/www\.artfest\.ro\/api\/unsubscribe\?token=/);
  const token = decodeURIComponent(url.split("token=")[1]);
  const data = verifyUnsubToken(token);
  assert.equal(data.email, "ana@t.ro");
  assert.equal(data.category, "marketing");
});

test("fără link valid => null (emailul nu pleacă): lipsă secret, lipsă bază, http în producție", () => {
  assert.equal(buildApiUnsubscribeUrl("a@t.ro", { env: { APP_URL: "https://www.artfest.ro" } }), null);
  assert.equal(buildApiUnsubscribeUrl("a@t.ro", { env: { UNSUBSCRIBE_SECRET: SECRET } }), null);
  assert.equal(buildApiUnsubscribeUrl("a@t.ro", { env: { APP_URL: "http://www.artfest.ro", UNSUBSCRIBE_SECRET: SECRET, NODE_ENV: "production" } }), null);
  // în dezvoltare, http local e permis
  assert.match(buildApiUnsubscribeUrl("a@t.ro", { env: { API_URL: "http://localhost:5000", UNSUBSCRIBE_SECRET: SECRET } }), /^http:\/\/localhost:5000\/api\/unsubscribe\?token=/);
});

test("verificarea configurației nu afișează secretul", () => {
  const ok = checkUnsubscribeConfig({ APP_URL: "https://www.artfest.ro", UNSUBSCRIBE_SECRET: SECRET });
  assert.equal(ok.ok, true);
  assert.equal(ok.unsubscribeEndpoint, "https://www.artfest.ro/api/unsubscribe");
  assert.equal(ok.tokenRoundTrip, true);
  assert.equal(JSON.stringify(ok).includes(SECRET), false);

  const bad = checkUnsubscribeConfig({ API_URL: "http://localhost:5000", UNSUBSCRIBE_SECRET: "scurt" });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((i) => /scurt/.test(i)));
  assert.ok(bad.issues.some((i) => /https/.test(i)));
  assert.ok(bad.issues.some((i) => /localhost/.test(i)));
  assert.equal(JSON.stringify(bad).includes("scurt\""), false);
});
