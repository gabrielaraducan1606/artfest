// Rulare: node --test src/lib/artfestFairAccessories.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateUnits, artfestShareOf, minUnitVendorNetCents, sameAccessories, validateAccessories, accessoriesText } from "./artfestFairAccessories.js";
import { computeLine } from "../services/artfestFairPosService.js";

test("validare: total pe bucată calculat; erori pe câmp; listă goală = fără accesorii", () => {
  const ok = validateAccessories([{ name: " Cutie ", quantity: 1, unitPriceCents: 600 }, { name: "Fundă", quantity: 2, unitPriceCents: 100 }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.unitCents, 800);
  assert.equal(ok.items[0].name, "Cutie");
  assert.equal(ok.items[1].totalCents, 200);
  assert.deepEqual(validateAccessories([]), { ok: true, items: [], unitCents: 0, fields: {} });
  const bad = validateAccessories([{ name: "x".repeat(81), quantity: 1.5, unitPriceCents: 0 }]);
  assert.deepEqual(Object.keys(bad.fields).sort(), ["items.0.name", "items.0.quantity", "items.0.unitPriceCents"]);
  assert.equal(validateAccessories("nu").ok, false);
  assert.equal(sameAccessories(ok.items, [{ name: "Cutie", quantity: 1, unitPriceCents: 600 }, { name: "Fundă", quantity: 2, unitPriceCents: 100 }]), true);
  assert.equal(accessoriesText(ok.items), "Cutie 1 × 6,00 lei + Fundă 2 × 1,00 lei");
});

test("computeLine: exemplul 110 lei; fără accesorii identic; reducere; aceeași rotunjire a comisionului", () => {
  const c = computeLine({ listUnitPriceCents: 11000, quantity: 1, commissionBps: 1000, accessoriesUnitCents: 800 });
  assert.deepEqual([c.commissionCents, c.accessoriesCents, c.vendorNetCents], [1100, 800, 9100]);
  const plain = computeLine({ listUnitPriceCents: 11000, quantity: 3, commissionBps: 1000 });
  const zero = computeLine({ listUnitPriceCents: 11000, quantity: 3, commissionBps: 1000, accessoriesUnitCents: 0 });
  assert.equal(plain.vendorNetCents, 29700);
  assert.deepEqual({ ...plain }, { ...zero });
  // 33,33 lei × 3: comisionul rotunjit ca înainte (round_half_up), accesoriile întregi
  const r = computeLine({ listUnitPriceCents: 3333, quantity: 3, commissionBps: 1000, accessoriesUnitCents: 150 });
  assert.equal(r.commissionCents, 1000);
  assert.equal(r.vendorNetCents, 9999 - 1000 - 450);
});

test("minUnitVendorNetCents = minimul exact pe bucăți (alocarea din retururi)", () => {
  for (const [gross, commission, qty, acc] of [[10001, 1000, 3, 3000], [7, 1, 3, 1], [9999, 1000, 7, 1285], [100, 10, 1, 90]]) {
    let min = Infinity;
    for (let i = 0; i < qty; i++) min = Math.min(min, allocateUnits(gross, qty, i, 1) - allocateUnits(commission, qty, i, 1) - acc);
    assert.equal(minUnitVendorNetCents({ lineGrossCents: gross, commissionCents: commission, quantity: qty, accessoriesUnitCents: acc }), min);
  }
});

test("partea Artfest: comision + accesorii + produse proprii, după retururi, fără dublare", () => {
  const lines = [
    { vendorId: "a", lineGrossCents: 22000, commissionCents: 2200, accessoriesCents: 1600, vendorNetCents: 18200 },
    { vendorId: null, lineGrossCents: 900, commissionCents: 900, accessoriesCents: 0, vendorNetCents: 0 },
  ];
  const rls = [
    { vendorId: "a", refundCents: 11000, commissionReversedCents: 1100, accessoriesReversedCents: 800, vendorNetReversedCents: 9100 },
    { vendorId: "a", refundCents: 11000, commissionReversedCents: 1100, accessoriesReversedCents: 800, vendorNetReversedCents: 9100, refundResponsibility: "ARTFEST" },
  ];
  const share = artfestShareOf(lines, rls);
  assert.deepEqual(share, { commissionCents: 1100, accessoriesCents: 800, ownProductsCents: 900, artfestFundedCents: 0, artfestBorneRefundCents: 11000, totalCents: -8200 });
  const collected = 22900 - 22000;
  const vendorDue = 18200 - 9100;
  assert.equal(share.totalCents, collected - vendorDue);
});
