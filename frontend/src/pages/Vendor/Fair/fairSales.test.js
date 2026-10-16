// Rulare: node --test src/pages/Vendor/Fair/fairSales.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLei, initialFairDate, isValidDate, reportUrl, todayFairDate } from "./fairSales.js";

test("ziua de azi în ora României, nu în UTC", () => {
  // 22:30 UTC pe 20 dec. = 00:30 pe 21 dec. la București
  assert.equal(todayFairDate(new Date("2026-12-20T22:30:00Z")), "2026-12-21");
  assert.equal(todayFairDate(new Date("2026-12-20T21:59:00Z")), "2026-12-20");
  // vara (UTC+3)
  assert.equal(todayFairDate(new Date("2026-07-01T21:30:00Z")), "2026-07-02");
});

test("URL-uri raport și CSV, validare dată, format lei", () => {
  assert.equal(reportUrl("/api/x/daily", "2026-12-20"), "/api/x/daily?date=2026-12-20");
  assert.equal(reportUrl("/api/x/daily", "2026-12-20", { csv: true }), "/api/x/daily.csv?date=2026-12-20");
  assert.equal(isValidDate("2026-12-20"), true);
  assert.equal(isValidDate("20.12.2026"), false);
  assert.equal(formatLei(14349), "143,49 lei");
});

test("ziua inițială: din link-ul notificării, altfel azi", () => {
  const now = new Date("2026-12-20T10:00:00Z");
  assert.equal(initialFairDate("?date=2026-12-18", now), "2026-12-18");
  assert.equal(initialFairDate("?date=18.12.2026", now), "2026-12-20");
  assert.equal(initialFairDate("", now), "2026-12-20");
});
