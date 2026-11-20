// node --test src/pages/Admin/AdminCouriersPage/adminArtfestSamedayView.test.js
// Tariful simplu Artfest: neconfigurat = câmp gol (nu 0).
import { test } from "node:test";
import assert from "node:assert/strict";

import { amountToInput } from "./adminArtfestSamedayView.js";

test("suma salvată -> câmp; neconfigurat rămâne gol", () => {
  assert.equal(amountToInput(2490), "24,90");
  assert.equal(amountToInput(1500), "15,00");
  assert.equal(amountToInput(null), "");
  assert.equal(amountToInput(undefined), "");
});
