// node --test src/couriers/awb/parcels.test.js
//
// Greutatea coletului pentru AWB: se completează / confirmă la generarea AWB-ului
// (valorile salvate pe expediere sau introduse de vânzător). Nu se inventează și
// nu vine din greutatea produselor (care poate lipsi: nu mai e cerută la publicare).
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveParcels } from "./parcels.js";

test("fără greutate pe expediere și fără greutate introdusă -> blocaj, fără colete trimise curierului", () => {
  const r = resolveParcels({ parcels: 1, weightKg: null }, {});
  assert.equal(r.weightKg, null);
  assert.deepEqual(r.list, []);
  assert.deepEqual(r.blockers.map((b) => b.code), ["weight_required"]);
});

test("greutatea produselor NU e folosită: doar expedierea și ce introduce vânzătorul", () => {
  // câmpuri de produs pe obiect: ignorate
  const r = resolveParcels({ shippingWeightGrams: 450, items: [{ shippingWeightGrams: 450 }] }, {});
  assert.equal(r.weightKg, null);
  assert.equal(r.blockers[0].code, "weight_required");
});

test("greutatea introdusă la generarea AWB are prioritate și se împarte egal pe colete", () => {
  const r = resolveParcels({ parcels: 1, weightKg: 9 }, { parcels: 2, weightKg: "1.5" });
  assert.deepEqual(r.blockers, []);
  assert.equal(r.weightKg, 1.5);
  assert.deepEqual(r.list.map((p) => p.weightKg), [0.75, 0.75]);
});

test("greutate invalidă -> blocaj (nu se corectează automat)", () => {
  for (const weightKg of [0, -1, "abc", 501]) {
    const r = resolveParcels({}, { weightKg });
    assert.equal(r.blockers[0]?.code, "weight_invalid", String(weightKg));
    assert.deepEqual(r.list, []);
  }
});
