// Rulare: node --test src/pages/Admin/AdminMarketing/collaborationExtension.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXTENSION_PRESETS,
  addMonthsUtc,
  buildExtensionPayload,
  formatExtensionDate,
  previewValidationError,
  proposeExtensionDate,
  toDateInputValue,
} from "./collaborationExtension.js";

test("presetii sunt +1/+3/+6 luni, în ordine", () => {
  assert.deepEqual(
    EXTENSION_PRESETS.map((p) => p.months),
    [1, 3, 6]
  );
});

test("B/C/D. propunerea pornește de la collaborationEnd CURENT (nu de la createdAt)", () => {
  const currentEnd = new Date("2026-12-18T09:00:00.000Z");

  assert.equal(proposeExtensionDate(currentEnd, 1).toISOString(), "2027-01-18T09:00:00.000Z");
  assert.equal(proposeExtensionDate(currentEnd, 3).toISOString(), "2027-03-18T09:00:00.000Z");
  assert.equal(proposeExtensionDate(currentEnd, 6).toISOString(), "2027-06-18T09:00:00.000Z");
});

test("addMonthsUtc: ajustare corectă la finalul lunii", () => {
  assert.equal(
    addMonthsUtc(new Date("2026-01-31T00:00:00.000Z"), 1).toISOString(),
    "2026-02-28T00:00:00.000Z"
  );
});

test("toDateInputValue: format yyyy-mm-dd, gol pentru date invalide", () => {
  assert.equal(toDateInputValue("2026-12-18T09:00:00.000Z"), "2026-12-18");
  assert.equal(toDateInputValue("nu-e-o-data"), "");
  assert.equal(toDateInputValue(null), "");
});

test("payload-ul trimis la backend conține doar collaborationEnd, ca ISO", () => {
  assert.deepEqual(buildExtensionPayload("2027-03-18"), {
    collaborationEnd: new Date("2027-03-18").toISOString(),
  });
});

test("previewValidationError: dată invalidă / anterioară end-ului curent / validă", () => {
  const currentEnd = "2026-12-18T00:00:00.000Z";

  assert.match(previewValidationError("", currentEnd), /dată validă/);
  assert.match(previewValidationError("nu-e-o-data", currentEnd), /dată validă/);
  assert.match(previewValidationError("2026-10-01T00:00:00.000Z", currentEnd), /ulterioară/);
  assert.equal(previewValidationError("2027-01-01T00:00:00.000Z", currentEnd), null);
});

test("formatExtensionDate: dată lungă în română, „—” pentru lipsă", () => {
  assert.equal(formatExtensionDate(null), "—");
  assert.equal(formatExtensionDate("2026-12-18T00:00:00.000Z"), "18 decembrie 2026");
});
