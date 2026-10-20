// src/lib/phoneRo.test.js
// Rulare: node --test src/lib/phoneRo.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeRoPhone, isValidRoPhone } from "./phoneRo.js";

test("format național rămâne neschimbat (cu sau fără spații)", () => {
  assert.equal(normalizeRoPhone("0712345678"), "0712345678");
  assert.equal(normalizeRoPhone("0712 345 678"), "0712345678");
  assert.equal(normalizeRoPhone("0712-345-678"), "0712345678");
  assert.equal(normalizeRoPhone("0212345678"), "0212345678");
});

test("+40 / 0040 / 40 (autocompletare mobil) -> 07xxxxxxxx, fără trunchiere greșită", () => {
  assert.equal(normalizeRoPhone("+40712345678"), "0712345678");
  assert.equal(normalizeRoPhone("+40 712 345 678"), "0712345678");
  assert.equal(normalizeRoPhone("0040712345678"), "0712345678");
  assert.equal(normalizeRoPhone("0040 712 345 678"), "0712345678");
  assert.equal(normalizeRoPhone("40712345678"), "0712345678");
  assert.equal(normalizeRoPhone("+40 (0)712 345 678"), "0712345678");

  // regresie: vechiul slice(0, 10) producea "4071234567"
  assert.notEqual(normalizeRoPhone("+40712345678"), "4071234567");
});

test("valori goale / invalide nu sunt corupte în numere valide", () => {
  assert.equal(normalizeRoPhone(""), "");
  assert.equal(normalizeRoPhone(null), "");
  assert.equal(normalizeRoPhone(undefined), "");
  assert.equal(isValidRoPhone("071234567"), false);
  assert.equal(isValidRoPhone("07123456789"), false);
  assert.equal(isValidRoPhone("+359888123456"), false);
  assert.equal(isValidRoPhone("4071234567"), false);
});

test("isValidRoPhone acceptă toate formatele românești normalizabile", () => {
  for (const value of [
    "0712345678",
    "+40712345678",
    "0040712345678",
    "40712345678",
    "+40 (0)712 345 678",
  ]) {
    assert.equal(isValidRoPhone(value), true, value);
  }
});
