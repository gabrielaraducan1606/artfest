// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/adminFairCancellation.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReturnLines,
  canConfirmOnBehalf,
  cancellationImpact,
  fullConfirmationLines,
  initialReturnDraft,
  validateCancellation,
} from "./adminFairCancellation.js";

test("validarea anulării: cauză, motiv intern și bifa de expediere sunt obligatorii", () => {
  const errors = validateCancellation({ cause: "", reason: " a ", goodsAlreadyShipped: undefined });
  assert.deepEqual(Object.keys(errors).sort(), ["cause", "goodsAlreadyShipped", "reason"]);
  assert.deepEqual(validateCancellation({ cause: "VENDOR_REQUEST", reason: "Cerere scrisă", goodsAlreadyShipped: false }), {});
});

test("impactul anulării depinde de bifa „deja expediate”", () => {
  const preview = {
    ifNotShipped: { linesToCancel: 4, inTransit: 0, atArtfest: 1, rejectedAtArtfest: 0 },
    ifShipped: { linesToCancel: 1, inTransit: 3, atArtfest: 1, rejectedAtArtfest: 0 },
  };
  assert.equal(cancellationImpact(preview, false)[0].value, 4);
  assert.equal(cancellationImpact(preview, true)[1].value, 3);
});

test("retur: draft implicit = tot ce se poate returna; cantități invalide respinse", () => {
  const candidates = [
    { inventoryItemId: "x", maxFromStock: 4, maxRejected: 1 },
    { inventoryItemId: "y", maxFromStock: 0, maxRejected: 2 },
  ];
  const draft = initialReturnDraft(candidates);
  const ok = buildReturnLines(candidates, draft);
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.lines, [
    { inventoryItemId: "x", qtyFromStock: 4, qtyRejected: 1, qtyDamaged: 0 },
    { inventoryItemId: "y", qtyFromStock: 0, qtyRejected: 2, qtyDamaged: 0 },
  ]);

  const tooMuch = buildReturnLines(candidates, { ...draft, x: { qtyFromStock: "5", qtyRejected: "0" } });
  assert.ok(tooMuch.errors.x);

  const empty = buildReturnLines(candidates, { x: { qtyFromStock: "0", qtyRejected: "0" }, y: { qtyFromStock: "0", qtyRejected: "0" } });
  assert.ok(empty.errors._);
});

test("retur cu deteriorate: cantitate separată, validată față de maxDamaged", () => {
  const candidates = [{ inventoryItemId: "z", maxFromStock: 1, maxRejected: 0, maxDamaged: 2 }];
  const draft = initialReturnDraft(candidates);
  assert.deepEqual(buildReturnLines(candidates, draft).lines, [{ inventoryItemId: "z", qtyFromStock: 1, qtyRejected: 0, qtyDamaged: 2 }]);
  const onlyDamaged = buildReturnLines(candidates, { z: { qtyFromStock: "0", qtyRejected: "0", qtyDamaged: "1" } });
  assert.deepEqual(onlyDamaged.lines, [{ inventoryItemId: "z", qtyFromStock: 0, qtyRejected: 0, qtyDamaged: 1 }]);
  assert.ok(buildReturnLines(candidates, { z: { qtyFromStock: "0", qtyRejected: "0", qtyDamaged: "3" } }).errors.z);
  assert.deepEqual(fullConfirmationLines({ lines: [{ id: "l", sentQty: 0, qtyDamaged: 2 }] }), [
    { returnLineId: "l", receivedQty: 0, receivedDamagedQty: 2 },
  ]);
});

test("confirmarea în numele vendorului: doar SHIPPED și după termenul de la server", () => {
  const from = "2026-12-20T10:00:00.000Z";
  const ret = { status: "SHIPPED", actions: { confirmOnBehalfFrom: from }, lines: [{ id: "l1", sentQty: 3 }] };
  assert.equal(canConfirmOnBehalf(ret, new Date("2026-12-19T10:00:00Z")), false);
  assert.equal(canConfirmOnBehalf(ret, new Date("2026-12-21T10:00:00Z")), true);
  assert.equal(canConfirmOnBehalf({ ...ret, status: "CONFIRMED" }, new Date("2026-12-21T10:00:00Z")), false);
  assert.deepEqual(fullConfirmationLines(ret), [{ returnLineId: "l1", receivedQty: 3 }]);
});
