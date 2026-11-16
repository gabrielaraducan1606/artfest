// Rulare: node --test src/pages/Vendor/Fair/fairInventoryQuantity.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAdjustBody,
  itemQuantities,
  onlineEffectText,
  qtyChangeText,
  validateAdjustQty,
} from "./fairInventoryQuantity.js";

const item = (extra = {}) => ({
  id: "i1",
  declaredQty: 1,
  isManual: false,
  quantities: { declaredQty: 1, issuedQty: 0, receivedQty: 0, availableForNoteQty: 1, minAdjustQty: 1, maxQty: 1000 },
  online: { mode: "TRANSFERRED", reservedQty: 1, productAvailability: "SOLD_OUT", onlineAvailableQty: 0 },
  ...extra,
});

test("validare: întreg, între minim (avizat) și maxim, diferit de cantitatea actuală", () => {
  assert.deepEqual(validateAdjustQty("5", item()), { ok: true, qty: 5 });
  assert.equal(validateAdjustQty("", item()).ok, false);
  assert.equal(validateAdjustQty("2,5", item()).ok, false);
  assert.equal(validateAdjustQty("0", item()).ok, false);
  assert.equal(validateAdjustQty("1001", item()).ok, false);
  assert.match(validateAdjustQty("1", item()).message, /aceeași/);

  const noted = item({ declaredQty: 4, quantities: { declaredQty: 4, issuedQty: 3, availableForNoteQty: 1, minAdjustQty: 3, maxQty: 1000 } });
  assert.match(validateAdjustQty("2", noted).message, /avize emise/);
  assert.deepEqual(validateAdjustQty("3", noted), { ok: true, qty: 3 });
});

test("efect online: majorare pe produs epuizat nu atinge stocul; READY rezervă diferența; diminuare redă surplusul", () => {
  assert.match(onlineEffectText(item(), 5), /nu se modifică/);

  const ready = item({ online: { mode: "TRANSFERRED", reservedQty: 2, productAvailability: "READY", onlineAvailableQty: 3 }, declaredQty: 2, quantities: { declaredQty: 2 } });
  assert.match(onlineEffectText(ready, 4), /încă 2 buc\..*disponibil acum: 3/);
  assert.match(onlineEffectText(ready, 7), /doar 3 buc\./);
  assert.match(onlineEffectText(ready, 1), /1 buc\. rezervate revin/);

  assert.equal(onlineEffectText(item({ isManual: true }), 5), "");
});

test("corpul cererii poartă cantitatea văzută; textele motivelor", () => {
  assert.deepEqual(buildAdjustBody(item(), 5), { declaredQty: 5, expectedDeclaredQty: 1 });
  assert.match(qtyChangeText({ mode: "request", reason: "deadline" }), /Asistență/);
  assert.match(qtyChangeText({ mode: "request", reason: "received" }), /recepționat/);
  assert.equal(qtyChangeText({ mode: "adjust", reason: null }), "");
  // răspuns fără `quantities` (compatibilitate)
  assert.deepEqual(itemQuantities({ declaredQty: 3 }), {
    declaredQty: 3,
    issuedQty: 0,
    receivedQty: 0,
    availableForNoteQty: 0,
    minAdjustQty: 1,
    maxQty: 1000,
  });
});
