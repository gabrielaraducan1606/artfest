// Regulamentul Târgului Artfest: ruta HTML a unei versiuni publicate trebuie să
// fie servită de ruta dedicată, nu prinsă de ruta generică
// /legal/:type/v/:version.html (care răspundea 404 „unknown_type”).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import router from "./legalRoutes.js";
import { listPublishedFairRules } from "../lib/artfestFairRules.js";

async function withApp(fn) {
  const app = express();
  app.use(router);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("ruta regulamentului e declarată înaintea rutei generice /legal/:type/v/:version.html", () => {
  const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
  const fair = paths.indexOf("/legal/artfest-fair-rules/v/:version.html");
  const generic = paths.indexOf("/legal/:type/v/:version.html");
  assert.ok(fair >= 0 && generic >= 0);
  assert.ok(fair < generic);
});

test("o versiune publicată se încarcă, fără marcaje de draft și fără variabile lipsă", async () => {
  const published = listPublishedFairRules();
  if (!published.length) return; // nimic publicat => nimic de servit
  await withApp(async (base) => {
    for (const { version } of published) {
      const res = await fetch(`${base}/legal/artfest-fair-rules/v/${version}.html`);
      const html = await res.text();
      assert.equal(res.status, 200, version);
      assert.ok(html.includes(`Versiune: v${version}`));
      assert.doesNotMatch(html, /\[(DE STABILIT|REVIZUIRE JURIDICĂ|TERMEN LIMITĂ PREDARE)/);
      assert.doesNotMatch(html, /\{\{/);
    }
  });
});

test("o versiune nepublicată răspunde 404", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/legal/artfest-fair-rules/v/0.0.1.html`);
    assert.equal(res.status, 404);
  });
});
