// Rulare: node --test src/services/aiUsageService.test.js
//
// Prisma SIMULAT (în memorie): fiecare instrucțiune (createMany / updateMany /
// aggregate / findFirst) e atomică, ca un UPDATE ... WHERE în PostgreSQL;
// între instrucțiuni execuția cedează (await), deci cererile simultane din
// Promise.all se intercalează exact ca pe un server real.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  costMicroUsd,
  finishAiCall,
  getAiUsageStatus,
  getVendorCollectionsAiConfig,
  openAiFailureMayBeBilled,
  reserveAiCall,
} from "./aiUsageService.js";

/* ---------- fake AiUsageDaily ---------- */
function createFakeDb() {
  const rows = [];
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const uniq = (r) => `${r.feature}|${r.scope}|${r.subjectId}|${r.day}`;

  function cmp(value, cond) {
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
    if (typeof cond !== "object") return value === cond;
    for (const [op, v] of Object.entries(cond)) {
      if (op === "lt" && !(value !== null && value !== undefined && value < v)) return false;
      if (op === "gt" && !(value !== null && value !== undefined && value > v)) return false;
      if (op === "startsWith" && !String(value ?? "").startsWith(v)) return false;
    }
    return true;
  }
  function matches(row, where = {}) {
    return Object.entries(where).every(([key, cond]) =>
      key === "OR" ? cond.some((w) => matches(row, w)) : cmp(row[key], cond)
    );
  }
  function apply(row, data) {
    for (const [key, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !(v instanceof Date) && "increment" in v) row[key] = (row[key] || 0) + v.increment;
      else if (v && typeof v === "object" && !(v instanceof Date) && "decrement" in v) row[key] = (row[key] || 0) - v.decrement;
      else row[key] = v;
    }
  }

  return {
    rows,
    aiUsageDaily: {
      async createMany({ data }) {
        await tick();
        let count = 0;
        for (const d of data) {
          if (rows.some((r) => uniq(r) === uniq(d))) continue; // skipDuplicates
          rows.push({ requests: 0, failures: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, lockedUntil: null, ...d });
          count += 1;
        }
        return { count };
      },
      async updateMany({ where, data }) {
        await tick();
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => apply(r, data));
        return { count: hit.length };
      },
      async findFirst({ where }) {
        await tick();
        return rows.find((r) => matches(r, where)) || null;
      },
      async aggregate({ where, _sum }) {
        await tick();
        const sum = {};
        for (const key of Object.keys(_sum)) sum[key] = rows.filter((r) => matches(r, where)).reduce((a, r) => a + (r[key] || 0), 0);
        return { _sum: sum };
      },
    },
  };
}

const ENV = { AI_VENDOR_COLLECTIONS_ENABLED: "1", OPENAI_API_KEY: "test-fara-apeluri" };
const NOW = new Date("2026-10-19T10:00:00Z");

test("configurare: implicit 5 / 50 / 5 USD / gpt-4.1-mini / 20 s; dezactivat fără comutator sau fără cheie", () => {
  const c = getVendorCollectionsAiConfig(ENV);
  assert.equal(c.enabled, true);
  assert.equal(c.vendorDailyLimit, 5);
  assert.equal(c.globalDailyLimit, 50);
  assert.equal(c.monthlyBudgetUsd, 5);
  assert.equal(c.model, "gpt-4.1-mini");
  assert.equal(c.timeoutMs, 20000);
  assert.equal(c.maxOutputTokens, 1500);

  assert.equal(getVendorCollectionsAiConfig({ OPENAI_API_KEY: "x" }).enabled, false, "comutatorul e implicit oprit");
  assert.equal(getVendorCollectionsAiConfig({ AI_VENDOR_COLLECTIONS_ENABLED: "0", OPENAI_API_KEY: "x" }).enabled, false);
  assert.equal(getVendorCollectionsAiConfig({ AI_VENDOR_COLLECTIONS_ENABLED: "1" }).enabled, false, "fără cheie OpenAI");
});

test("configurare: limitele se schimbă din env; model nepermis -> gpt-4.1-mini; valori absurde limitate", () => {
  const c = getVendorCollectionsAiConfig({
    ...ENV,
    AI_VENDOR_COLLECTIONS_VENDOR_DAILY_LIMIT: "3",
    AI_VENDOR_COLLECTIONS_GLOBAL_DAILY_LIMIT: "20",
    AI_VENDOR_COLLECTIONS_MONTHLY_BUDGET_USD: "2,5",
    AI_VENDOR_COLLECTIONS_MODEL: "gpt-4.1",
    AI_VENDOR_COLLECTIONS_TIMEOUT_MS: "999999",
  });
  assert.equal(c.vendorDailyLimit, 3);
  assert.equal(c.globalDailyLimit, 20);
  assert.equal(c.monthlyBudgetUsd, 2.5);
  assert.equal(c.model, "gpt-4.1-mini", "modelul scump nu poate fi activat din env");
  assert.equal(c.timeoutMs, 60000);
});

test("limita per vânzător: 5 / zi; a 6-a refuzată; alt vânzător are cota lui", async () => {
  const db = createFakeDb();
  const config = getVendorCollectionsAiConfig(ENV);

  for (let i = 0; i < 5; i += 1) {
    const r = await reserveAiCall(db, { vendorId: "v1", config, now: NOW });
    assert.equal(r.ok, true);
    await finishAiCall(db, r.reservation, { outcome: "billed", usage: { input_tokens: 1000, output_tokens: 100 }, config });
  }
  assert.deepEqual(await reserveAiCall(db, { vendorId: "v1", config, now: NOW }), { ok: false, reason: "vendor_daily_limit" });
  assert.equal((await reserveAiCall(db, { vendorId: "v2", config, now: NOW })).ok, true);

  const status = await getAiUsageStatus(db, { vendorId: "v1", config, now: NOW });
  assert.equal(status.remaining, 0);
  assert.equal(status.used, 5);
});

test("cereri SIMULTANE același vânzător: exact una trece (lock), restul „în curs”; după încheiere se poate din nou", async () => {
  const db = createFakeDb();
  const config = getVendorCollectionsAiConfig(ENV);

  const results = await Promise.all(Array.from({ length: 10 }, () => reserveAiCall(db, { vendorId: "v1", config, now: NOW })));
  const ok = results.filter((r) => r.ok);
  assert.equal(ok.length, 1);
  assert.ok(results.filter((r) => !r.ok).every((r) => r.reason === "in_progress"));
  assert.equal(db.rows.find((r) => r.scope === "vendor").requests, 1, "doar cererea câștigătoare a consumat");

  await finishAiCall(db, ok[0].reservation, { outcome: "billed", usage: { input_tokens: 10, output_tokens: 10 }, config });
  assert.equal((await reserveAiCall(db, { vendorId: "v1", config, now: NOW })).ok, true);
});

test("cereri SIMULTANE de la 30 de vânzători cu limita globală 50 -> 10 rămase: exact 10 trec, nimeni nu depășește", async () => {
  const db = createFakeDb();
  const config = getVendorCollectionsAiConfig(ENV);
  db.rows.push({ feature: config.feature, scope: "global", subjectId: "all", day: "2026-10-19", requests: 40, failures: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, lockedUntil: null });

  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) => reserveAiCall(db, { vendorId: `v${i}`, config, now: NOW }))
  );
  assert.equal(results.filter((r) => r.ok).length, 10);
  assert.ok(results.filter((r) => !r.ok).every((r) => r.reason === "global_daily_limit"));
  assert.equal(db.rows.find((r) => r.scope === "global").requests, 50);

  // vânzătorii refuzați global NU pierd din cota lor (niciun apel AI)
  const refused = db.rows.filter((r) => r.scope === "vendor" && r.requests === 0);
  assert.equal(refused.length, 20);
  assert.ok(refused.every((r) => r.lockedUntil === null), "lock eliberat");
});

test("repornire: limitele sunt în DB - un modul încărcat din nou vede același consum", async () => {
  const db = createFakeDb();
  const config = getVendorCollectionsAiConfig(ENV);
  for (let i = 0; i < 5; i += 1) {
    const r = await reserveAiCall(db, { vendorId: "v1", config, now: NOW });
    await finishAiCall(db, r.reservation, { outcome: "billed", usage: { input_tokens: 1, output_tokens: 1 }, config });
  }

  // „repornire”: instanță nouă a modulului (nicio stare în memorie), aceeași bază
  const fresh = await import(`./aiUsageService.js?restart=${Date.now()}`);
  const freshConfig = fresh.getVendorCollectionsAiConfig(ENV);
  assert.deepEqual(await fresh.reserveAiCall(db, { vendorId: "v1", config: freshConfig, now: NOW }), {
    ok: false,
    reason: "vendor_daily_limit",
  });
});

test("erori: 4xx (OpenAI a refuzat) -> cota se restituie; timeout / 5xx -> cota RĂMÂNE + cost estimat", async () => {
  assert.equal(openAiFailureMayBeBilled({ status: 429 }), false);
  assert.equal(openAiFailureMayBeBilled({ status: 400 }), false);
  assert.equal(openAiFailureMayBeBilled({ status: 500 }), true);
  assert.equal(openAiFailureMayBeBilled({ name: "APIConnectionTimeoutError" }), true);
  assert.equal(openAiFailureMayBeBilled(new Error("socket hang up")), true);

  const db = createFakeDb();
  const config = getVendorCollectionsAiConfig(ENV);
  const vendorRow = () => db.rows.find((r) => r.scope === "vendor");
  const globalRow = () => db.rows.find((r) => r.scope === "global");

  const a = await reserveAiCall(db, { vendorId: "v1", config, now: NOW });
  await finishAiCall(db, a.reservation, { outcome: "not_sent", config });
  assert.equal(vendorRow().requests, 0, "restituită");
  assert.equal(globalRow().requests, 0);
  assert.equal(vendorRow().failures, 1);

  const b = await reserveAiCall(db, { vendorId: "v1", config, now: NOW });
  await finishAiCall(db, b.reservation, { outcome: "maybe_billed", estimatedInputTokens: 10000, config });
  assert.equal(vendorRow().requests, 1, "NU se restituie: poate fi fost facturată");
  assert.equal(globalRow().costMicroUsd, costMicroUsd({ inputTokens: 10000, outputTokens: 1500 }, config));
  assert.equal(vendorRow().lockedUntil, null, "lock eliberat");
});

test("costul real din răspuns se adună (vânzător + global)", async () => {
  const db = createFakeDb();
  const config = getVendorCollectionsAiConfig(ENV);
  const r = await reserveAiCall(db, { vendorId: "v1", config, now: NOW });
  await finishAiCall(db, r.reservation, { outcome: "billed", usage: { input_tokens: 12000, output_tokens: 900 }, config });

  const expected = Math.ceil(12000 * 0.4 + 900 * 1.6); // 4800 + 1440 micro-USD = 0,00624 USD
  assert.equal(expected, 6240);
  assert.equal(db.rows.find((x) => x.scope === "global").costMicroUsd, expected);
  assert.equal(db.rows.find((x) => x.scope === "vendor").inputTokens, 12000);
});

test("bugetul lunar: la 5 USD consumați în lună se oprește; luna trecută nu contează", async () => {
  const db = createFakeDb();
  const config = getVendorCollectionsAiConfig(ENV);
  const base = { feature: config.feature, scope: "global", subjectId: "all", requests: 0, failures: 0, inputTokens: 0, outputTokens: 0, lockedUntil: null };
  db.rows.push({ ...base, day: "2026-09-30", costMicroUsd: 9_000_000 });
  db.rows.push({ ...base, day: "2026-10-01", costMicroUsd: 2_000_000 });

  assert.equal((await reserveAiCall(db, { vendorId: "v1", config, now: NOW })).ok, true, "octombrie: 2 USD < 5 USD");

  db.rows.push({ ...base, day: "2026-10-02", costMicroUsd: 3_000_000 });
  assert.deepEqual(await reserveAiCall(db, { vendorId: "v2", config, now: NOW }), { ok: false, reason: "monthly_budget" });
  assert.equal((await getAiUsageStatus(db, { vendorId: "v2", config, now: NOW })).available, false);
});

test("lock expirat (proces căzut): se poate prelua; vechea cerere nu eliberează lock-ul noului proprietar", async () => {
  const db = createFakeDb();
  const config = getVendorCollectionsAiConfig(ENV);

  const first = await reserveAiCall(db, { vendorId: "v1", config, now: NOW });
  const later = new Date(NOW.getTime() + config.lockMs + 1000);
  const second = await reserveAiCall(db, { vendorId: "v1", config, now: later });
  assert.equal(second.ok, true, "lock-ul expirat se preia");

  await finishAiCall(db, first.reservation, { outcome: "billed", usage: {}, config });
  assert.ok(db.rows.find((r) => r.scope === "vendor").lockedUntil, "lock-ul celei de-a doua cereri rămâne");
});

test("zi nouă (Europe/Bucharest): cota se reface; comutator oprit -> refuz fără nicio scriere", async () => {
  const db = createFakeDb();
  const config = getVendorCollectionsAiConfig({ ...ENV, AI_VENDOR_COLLECTIONS_VENDOR_DAILY_LIMIT: "1" });
  const r = await reserveAiCall(db, { vendorId: "v1", config, now: NOW });
  await finishAiCall(db, r.reservation, { outcome: "billed", usage: {}, config });
  assert.equal((await reserveAiCall(db, { vendorId: "v1", config, now: NOW })).ok, false);
  assert.equal((await reserveAiCall(db, { vendorId: "v1", config, now: new Date("2026-10-19T21:30:00Z") })).ok, true);

  const off = createFakeDb();
  const disabled = getVendorCollectionsAiConfig({ OPENAI_API_KEY: "x", AI_VENDOR_COLLECTIONS_ENABLED: "0" });
  assert.deepEqual(await reserveAiCall(off, { vendorId: "v1", config: disabled, now: NOW }), { ok: false, reason: "disabled" });
  assert.equal(off.rows.length, 0);
});
