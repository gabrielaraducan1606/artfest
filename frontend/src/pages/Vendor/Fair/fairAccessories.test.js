// Rulare: node --test src/pages/Vendor/Fair/fairAccessories.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accessoriesListText,
  emptyRow,
  lineSplitText,
  proposedPrice,
  liveUnitTotal,
  parseLeiToCents,
  rowsFromItems,
  splitAtPrice,
  validateAccessoryRows,
} from "./fairAccessories.js";

test("formular: cutie + fundă => 8 lei pe bucată; rândurile goale ignorate; erori pe câmp", () => {
  const rows = [{ name: "Cutie", quantity: "1", price: "6" }, { name: " Fundă ", quantity: "1", price: "2,00" }, emptyRow()];
  const r = validateAccessoryRows(rows);
  assert.equal(r.ok, true);
  assert.equal(r.unitCents, 800);
  assert.deepEqual(r.items, [{ name: "Cutie", quantity: 1, unitPriceCents: 600 }, { name: "Fundă", quantity: 1, unitPriceCents: 200 }]);
  assert.equal(liveUnitTotal(rows), 800);
  const bad = validateAccessoryRows([{ name: "", quantity: "0", price: "abc" }]);
  assert.deepEqual(Object.keys(bad.fields).sort(), ["0.name", "0.price", "0.quantity"]);
  assert.equal(validateAccessoryRows([]).ok, true, "fără accesorii");
  assert.equal(parseLeiToCents("2.5"), 250);
  assert.deepEqual(rowsFromItems([{ name: "Cutie", quantity: 2, unitPriceCents: 650 }]), [{ name: "Cutie", quantity: "2", price: "6,50" }]);
});

test("regula actuală: propus 50 + 5 + 5 = 60 => vânzătorul 50; sub propus: accesorii, apoi 10% / 90%", () => {
  assert.equal(proposedPrice(5000, 500), 6000);
  const atProposed = splitAtPrice(6000, 5000, 500);
  assert.deepEqual([atProposed.financeRule, atProposed.vendorNetCents, atProposed.markupCents, atProposed.artfestCents, atProposed.markupReduced], ["DECLARED_PLUS_MARKUP", 5000, 500, 1000, false]);
  const above = splitAtPrice(6500, 5000, 500);
  assert.deepEqual([above.vendorNetCents, above.artfestCents], [5000, 1500]);
  // exemplul: declarat 12, cutie 3, încasat 15 => bază 12, comision 1,20, vânzător 10,80, Artfest 4,20
  const ex = splitAtPrice(1500, 1200, 300);
  assert.deepEqual([ex.financeRule, ex.baseCents, ex.markupCents, ex.vendorNetCents, ex.artfestCents, ex.markupReduced], ["DISCOUNTED_COMMISSION", 1200, 120, 1080, 420, true]);
  // un ban sub propus (16,19): comision 1,32 din 13,19, vânzător 11,87
  assert.deepEqual([splitAtPrice(1619, 1200, 300).markupCents, splitAtPrice(1619, 1200, 300).vendorNetCents], [132, 1187]);
  assert.equal(splitAtPrice(1620, 1200, 300).financeRule, "DECLARED_PLUS_MARKUP");
  assert.equal(splitAtPrice(300, 1200, 300).negative, false);
  assert.equal(splitAtPrice(299, 1200, 300).negative, true);
  assert.equal(proposedPrice(3333), 3666, "rotunjirea adaosului: round half up");
});

test("texte: lista accesoriilor și împărțirea pe linie", () => {
  assert.equal(accessoriesListText([{ name: "Cutie", quantity: 1, unitPriceCents: 600 }, { name: "Fundă", quantity: 1, unitPriceCents: 200 }]), "Cutie 1 × 6,00 lei + Fundă 1 × 2,00 lei");
  assert.equal(lineSplitText({ commissionCents: 1100, accessoriesCents: 800, vendorNetCents: 9100 }), "Comision 10% 11,00 lei · Ambalare și accesorii 8,00 lei · Vânzător 91,00 lei");
  assert.equal(lineSplitText({ commissionCents: 500, accessoriesCents: 0, vendorNetCents: 4500 }), "Comision 10% 5,00 lei · Vânzător 45,00 lei");
  assert.match(lineSplitText({ artfestOwned: true, commissionCents: 900 }), /integral Artfest/);
  assert.equal(
    lineSplitText({ financeRule: "DECLARED_PLUS_MARKUP", commissionCents: 500, accessoriesCents: 500, vendorNetCents: 5000 }),
    "Vânzător (preț declarat) 50,00 lei · Adaos Artfest 5,00 lei · Accesorii 5,00 lei"
  );
  assert.equal(
    lineSplitText({ financeRule: "DISCOUNTED_COMMISSION", lineGrossCents: 1500, commissionCents: 120, accessoriesCents: 300, vendorNetCents: 1080 }),
    "Sub prețul propus: Accesorii 3,00 lei · Comision 10% 1,20 lei din 12,00 lei · Vânzător 10,80 lei"
  );
});
