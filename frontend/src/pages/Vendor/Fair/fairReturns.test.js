// Rulare: node --test src/pages/Vendor/Fair/fairReturns.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConfirmPayload,
  defaultRestoreQty,
  hasDifferences,
  initialConfirmState,
  onlineStateText,
  updateReceived,
  updateReceivedDamaged,
  updateRestore,
} from "./fairReturns.js";

const ret = {
  id: "r1",
  lines: [
    { id: "a", sentQty: 5, restoreCap: 5 },
    { id: "u", sentQty: 1, restoreCap: 1 },
    { id: "m", sentQty: 3, restoreCap: 0 },
  ],
};

test("implicit: readăugare online = tot ce s-a primit și e eligibil", () => {
  assert.equal(defaultRestoreQty(5, 5), 5);
  assert.equal(defaultRestoreQty(3, 5), 3);
  assert.equal(defaultRestoreQty(5, 2), 2);
  assert.equal(defaultRestoreQty(4, 0), 0);
  const state = initialConfirmState(ret);
  assert.deepEqual(
    Object.fromEntries(Object.entries(state).map(([k, v]) => [k, [v.receivedQty, v.restoreOnlineQty]])),
    { a: ["5", "5"], u: ["1", "1"], m: ["3", "0"] }
  );
});

test("primit mai puțin: readăugarea implicită scade; după editare manuală rămâne, doar limitată", () => {
  let state = initialConfirmState(ret);
  state = updateReceived(state, ret.lines[0], "3");
  assert.equal(state.a.restoreOnlineQty, "3");

  state = updateRestore(state, ret.lines[0], "1");
  state = updateReceived(state, ret.lines[0], "4");
  assert.equal(state.a.restoreOnlineQty, "1");

  state = updateRestore(state, ret.lines[0], "4");
  state = updateReceived(state, ret.lines[0], "2");
  assert.equal(state.a.restoreOnlineQty, "2");
});

test("payload: valid => toate liniile; peste plafon sau peste trimis => eroare pe linie", () => {
  const state = initialConfirmState(ret);
  const ok = buildConfirmPayload(ret, state, "Mulțumesc");
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.body.lines.length, 3);
  assert.equal(ok.body.note, "Mulțumesc");
  assert.deepEqual(ok.body.lines[2], { returnLineId: "m", receivedQty: 3, restoreOnlineQty: 0 });

  const bad = buildConfirmPayload(ret, { ...state, a: { ...state.a, receivedQty: "6" }, u: { ...state.u, restoreOnlineQty: "2" } });
  assert.ok(bad.errors.a && bad.errors.u);
  assert.equal(bad.body.lines.length, 1);
});

test("diferențe detectate când primit != trimis", () => {
  const state = initialConfirmState(ret);
  assert.equal(hasDifferences(ret, state), false);
  assert.equal(hasDifferences(ret, updateReceived(state, ret.lines[1], "0")), true);
});

test("deteriorate: confirmate separat, niciodată în plafonul de readăugare online", () => {
  const damagedRet = {
    lines: [
      { id: "d", sentQty: 0, qtyDamaged: 2, restoreCap: 0 },
      { id: "x", sentQty: 3, qtyDamaged: 1, restoreCap: 3 },
    ],
  };
  const state = initialConfirmState(damagedRet);
  assert.deepEqual([state.d.receivedDamagedQty, state.d.restoreOnlineQty], ["2", "0"]);
  assert.equal(state.x.restoreOnlineQty, "3");

  const ok = buildConfirmPayload(damagedRet, state);
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.body.lines[0], { returnLineId: "d", receivedQty: 0, receivedDamagedQty: 2, restoreOnlineQty: 0 });

  const bad = buildConfirmPayload(damagedRet, { ...state, d: { ...state.d, restoreOnlineQty: "1" } });
  assert.ok(bad.errors.d);
  const tooMany = buildConfirmPayload(damagedRet, { ...state, x: { ...state.x, receivedDamagedQty: "2" } });
  assert.ok(tooMany.errors.x);

  assert.equal(hasDifferences(damagedRet, state), false);
  assert.equal(hasDifferences(damagedRet, updateReceivedDamaged(state, damagedRet.lines[0], "1")), true);
});

test("textul rezervării online pentru fiecare stare", () => {
  assert.match(onlineStateText({ state: "reserved", mode: "TRANSFERRED", reservedQty: 5 }), /Rezervat pentru târg: 5 bucăți/);
  assert.match(onlineStateText({ state: "reserved", mode: "FORCED_UNAVAILABLE" }), /unicatul/);
  assert.match(onlineStateText({ state: "released", mode: "TRANSFERRED", releasedQty: 1 }), /1 bucată a revenit/);
  assert.match(onlineStateText({ state: "restored", restoredQty: 2 }), /Readăugat online: 2 bucăți/);
  assert.match(onlineStateText({ state: "none" }), /nu a fost modificat/);
});
