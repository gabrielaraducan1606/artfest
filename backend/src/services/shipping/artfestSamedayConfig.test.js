// node --test src/services/shipping/artfestSamedayConfig.test.js
// Tariful simplu Artfest pe metodă (coșuri cu produse fără greutate): fără valori implicite,
// gol = neconfigurat, 0 lei / text invalid respinse.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ArtfestConfigError, configsFromRows, parseAmountLei } from "./artfestSamedayConfig.js";

test("fără rânduri: toate metodele neconfigurate (nicio sumă presupusă)", () => {
  const cfg = configsFromRows([]);
  for (const m of ["HOME", "LOCKER", "PUDO"]) assert.deepEqual([cfg[m].configured, cfg[m].amountCents], [false, null]);
  assert.equal(configsFromRows([{ method: "HOME", amountCents: 2490 }]).HOME.configured, true);
  assert.equal(configsFromRows([{ method: "HOME", amountCents: null }]).HOME.configured, false);
});

test("suma introdusă de Admin: lei -> bani; gol = neconfigurat; 0 / text / prea mare respinse", () => {
  assert.equal(parseAmountLei("24,90"), 2490);
  assert.equal(parseAmountLei("18.5"), 1850);
  assert.equal(parseAmountLei(""), null);
  for (const bad of ["0", "abc", "-5", "1500"]) {
    assert.throws(() => parseAmountLei(bad), (e) => e instanceof ArtfestConfigError && e.field === "amountLei", bad);
  }
});
