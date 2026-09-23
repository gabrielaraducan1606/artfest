// src/components/ScrollManager/scrollRestorationLogic.test.js
//
// Rulare: node --test src/components/ScrollManager/scrollRestorationLogic.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildScrollKey,
  readScrollPosition,
  writeScrollPosition,
  resolveShouldRestore,
  waitUntilReady,
} from "./scrollRestorationLogic.js";

/* =========================================================
   STORAGE FALS (mimic sessionStorage)
========================================================= */

function makeFakeStorage({ throwOnGet = false, throwOnSet = false } = {}) {
  const map = new Map();
  return {
    getItem: (key) => {
      if (throwOnGet) throw new Error("storage indisponibil");
      return map.has(key) ? map.get(key) : null;
    },
    setItem: (key, value) => {
      if (throwOnSet) throw new Error("storage indisponibil");
      map.set(key, value);
    },
    __map: map,
  };
}

/* =========================================================
   buildScrollKey
========================================================= */

test("buildScrollKey - format exact cerut, inclusiv query string", () => {
  assert.equal(
    buildScrollKey("/produse", "?occasionTag=wedding"),
    "scroll:/produse?occasionTag=wedding"
  );
});

test("buildScrollKey - fără query string", () => {
  assert.equal(buildScrollKey("/colectii", ""), "scroll:/colectii");
  assert.equal(buildScrollKey("/colectii", null), "scroll:/colectii");
  assert.equal(buildScrollKey("/colectii", undefined), "scroll:/colectii");
});

test("buildScrollKey - query string diferit = cheie SEPARATĂ", () => {
  const a = buildScrollKey("/produse", "?occasionTag=wedding");
  const b = buildScrollKey("/produse", "?occasionTag=baptism");
  const c = buildScrollKey("/produse", "");
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(b, c);
});

/* =========================================================
   read/writeScrollPosition
========================================================= */

test("write apoi read - round trip", () => {
  const storage = makeFakeStorage();
  writeScrollPosition(storage, "scroll:/produse", 1234.6);
  assert.equal(readScrollPosition(storage, "scroll:/produse"), 1235);
});

test("read - cheie inexistentă -> null", () => {
  const storage = makeFakeStorage();
  assert.equal(readScrollPosition(storage, "scroll:/nimic"), null);
});

test("read - valoare invalidă în storage -> null (nu aruncă)", () => {
  const storage = makeFakeStorage();
  storage.setItem("scroll:/x", "not-a-number");
  assert.equal(readScrollPosition(storage, "scroll:/x"), null);
});

test("write - valoare negativă e clampată la 0", () => {
  const storage = makeFakeStorage();
  writeScrollPosition(storage, "scroll:/x", -50);
  assert.equal(readScrollPosition(storage, "scroll:/x"), 0);
});

test("write - valoare non-finită e ignorată silențios", () => {
  const storage = makeFakeStorage();
  writeScrollPosition(storage, "scroll:/x", NaN);
  assert.equal(readScrollPosition(storage, "scroll:/x"), null);
});

test("storage indisponibil (mod privat) - read/write nu aruncă", () => {
  const storage = makeFakeStorage({ throwOnGet: true, throwOnSet: true });
  assert.doesNotThrow(() => writeScrollPosition(storage, "scroll:/x", 100));
  assert.equal(readScrollPosition(storage, "scroll:/x"), null);
});

/* =========================================================
   resolveShouldRestore - inima fix-ului (punctele A și F)
========================================================= */

test("A. reload (prima randare) -> NU restaurăm", () => {
  assert.equal(
    resolveShouldRestore({
      navigationType: "POP", // react-router raportează mereu POP la mount
      isFirstRun: true,
      navigationTimingType: "reload",
    }),
    false
  );
});

test("intrare directă pe URL / link extern (prima randare) -> NU restaurăm", () => {
  assert.equal(
    resolveShouldRestore({
      navigationType: "POP",
      isFirstRun: true,
      navigationTimingType: "navigate",
    }),
    false
  );
});

test("back/forward real, chiar la prima randare a filei -> restaurăm", () => {
  assert.equal(
    resolveShouldRestore({
      navigationType: "POP",
      isFirstRun: true,
      navigationTimingType: "back_forward",
    }),
    true
  );
});

test("navigare ulterioară în SPA - POP (Back real) -> restaurăm", () => {
  assert.equal(
    resolveShouldRestore({
      navigationType: "POP",
      isFirstRun: false,
      navigationTimingType: "reload", // irelevant după prima randare
    }),
    true
  );
});

test("navigare ulterioară în SPA - PUSH (click pe link) -> NU restaurăm", () => {
  assert.equal(
    resolveShouldRestore({
      navigationType: "PUSH",
      isFirstRun: false,
      navigationTimingType: null,
    }),
    false
  );
});

test("navigare ulterioară în SPA - REPLACE (redirect) -> NU restaurăm", () => {
  assert.equal(
    resolveShouldRestore({
      navigationType: "REPLACE",
      isFirstRun: false,
      navigationTimingType: null,
    }),
    false
  );
});

test("Navigation Timing indisponibil (prima randare) - fallback pe navigationType", () => {
  assert.equal(
    resolveShouldRestore({
      navigationType: "POP",
      isFirstRun: true,
      navigationTimingType: null,
    }),
    true
  );
  assert.equal(
    resolveShouldRestore({
      navigationType: "PUSH",
      isFirstRun: true,
      navigationTimingType: null,
    }),
    false
  );
});

/* =========================================================
   waitUntilReady
========================================================= */

function makeManualScheduler() {
  const queue = [];
  return {
    schedule: (fn) => queue.push(fn),
    flushOne: () => {
      const fn = queue.shift();
      if (fn) fn();
    },
    get pendingCount() {
      return queue.length;
    },
  };
}

test("waitUntilReady - predicate deja adevărat la primul tick -> onSettle o singură dată", () => {
  const { schedule, flushOne } = makeManualScheduler();
  let settleCount = 0;

  waitUntilReady({
    predicate: () => true,
    onSettle: () => {
      settleCount += 1;
    },
    schedule,
  });

  flushOne();
  assert.equal(settleCount, 1);
});

test("waitUntilReady - devine adevărat abia la al 3-lea tick", () => {
  const { schedule, flushOne } = makeManualScheduler();
  let tickCount = 0;
  let settleCount = 0;

  waitUntilReady({
    predicate: () => {
      tickCount += 1;
      return tickCount >= 3;
    },
    onSettle: () => {
      settleCount += 1;
    },
    schedule,
  });

  flushOne();
  assert.equal(settleCount, 0);
  flushOne();
  assert.equal(settleCount, 0);
  flushOne();
  assert.equal(settleCount, 1, "onSettle exact o dată, la al 3-lea tick");
});

test("waitUntilReady - predicate niciodată adevărat -> onSettle exact la maxAttempts, fără buclă infinită", () => {
  const { schedule, flushOne } = makeManualScheduler();
  let settleCount = 0;
  let predicateCalls = 0;

  waitUntilReady({
    predicate: () => {
      predicateCalls += 1;
      return false;
    },
    onSettle: () => {
      settleCount += 1;
    },
    schedule,
    maxAttempts: 5,
  });

  for (let i = 0; i < 5; i += 1) flushOne();

  assert.equal(predicateCalls, 5);
  assert.equal(settleCount, 1, "onSettle rulează o singură dată, la epuizare");
});

/* =========================================================
   INTEGRARE - scenariile cerute explicit (fără DOM/React, la nivel
   de logică pură: cheie + storage + decizie)
========================================================= */

test("B. Home scroll -> Product -> Back -> poziția salvată se regăsește", () => {
  const storage = makeFakeStorage();
  const homeKey = buildScrollKey("/", "");

  // userul scrolează pe homepage - listener-ul de scroll salvează continuu
  writeScrollPosition(storage, homeKey, 850);

  // navighează la produs (PUSH) - nu restaurăm, pornim de sus
  assert.equal(
    resolveShouldRestore({ navigationType: "PUSH", isFirstRun: false }),
    false
  );

  // apasă Back (POP) -> revenim pe homeKey
  const shouldRestore = resolveShouldRestore({
    navigationType: "POP",
    isFirstRun: false,
  });
  assert.equal(shouldRestore, true);
  assert.equal(readScrollPosition(storage, homeKey), 850);
});

test("C. Products (cu query) scroll -> Product detail -> Back -> poziția separată pe query se regăsește", () => {
  const storage = makeFakeStorage();
  const productsKey = buildScrollKey("/produse", "?occasionTag=wedding");

  writeScrollPosition(storage, productsKey, 1600);

  assert.equal(
    resolveShouldRestore({ navigationType: "PUSH", isFirstRun: false }),
    false
  );

  assert.equal(
    resolveShouldRestore({ navigationType: "POP", isFirstRun: false }),
    true
  );
  assert.equal(readScrollPosition(storage, productsKey), 1600);

  // un query DIFERIT pe aceeași rută nu vede poziția salvată mai sus
  const otherKey = buildScrollKey("/produse", "?occasionTag=baptism");
  assert.equal(readScrollPosition(storage, otherKey), null);
});
