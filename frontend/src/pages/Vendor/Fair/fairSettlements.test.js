// Rulare: node --test src/pages/Vendor/Fair/fairSettlements.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { amountHeadline, defaultPeriod, parseLeiToCents, periodText, signedLei } from "./fairSettlements.js";

test("sume: semn explicit pentru ajustări / sold", () => {
  assert.equal(signedLei(1500), "+15,00 lei");
  assert.equal(signedLei(-400), "-4,00 lei");
  assert.equal(signedLei(0), "0,00 lei");
});

test("lei => bani întregi; text invalid => null", () => {
  assert.equal(parseLeiToCents("15,50"), 1550);
  assert.equal(parseLeiToCents("-4"), -400);
  assert.equal(parseLeiToCents("+12.3"), 1230);
  assert.equal(parseLeiToCents(" 1 200,05 "), 120005);
  assert.equal(parseLeiToCents("0,07"), 7);
  assert.equal(parseLeiToCents("1,234"), null);
  assert.equal(parseLeiToCents("abc"), null);
  assert.equal(parseLeiToCents(""), null);
});

test("perioada: periodTo exclusiv => ultima zi inclusă; perioada propusă", () => {
  // 20 dec. 00:00 RO = 19 dec. 22:00 UTC; 23 dec. 00:00 RO = 22 dec. 22:00 UTC
  assert.equal(periodText("2026-12-19T22:00:00Z", "2026-12-22T22:00:00Z"), "2026-12-20 – 2026-12-22");
  const now = new Date("2026-12-28T10:00:00Z");
  assert.deepEqual(defaultPeriod({ now }), { periodFrom: "2026-12-28", periodTo: "2026-12-28" });
  assert.deepEqual(defaultPeriod({ fairStartsAt: "2026-12-19T22:00:00Z", now }), { periodFrom: "2026-12-20", periodTo: "2026-12-28" });
  assert.deepEqual(defaultPeriod({ nextPeriodFrom: "2026-12-22T22:00:00Z", fairStartsAt: "2026-12-19T22:00:00Z", now }), { periodFrom: "2026-12-23", periodTo: "2026-12-28" });
});

test("textul principal pentru vendor", () => {
  assert.equal(amountHeadline({ status: "FINALIZED", finalDueCents: 12345 }), "Sumă de primit: 123,45 lei");
  assert.equal(amountHeadline({ status: "CARRIED_FORWARD", finalDueCents: -3510 }), "Sold reportat: -35,10 lei");
  assert.equal(amountHeadline({ status: "PAID", finalDueCents: 500 }), "Plătit: 5,00 lei");
  assert.equal(amountHeadline({ status: "FINALIZED", finalDueCents: 0 }), "Nimic de plătit (0,00 lei)");
});
