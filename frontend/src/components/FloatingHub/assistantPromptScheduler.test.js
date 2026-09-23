// src/components/FloatingHub/assistantPromptScheduler.test.js
//
// Teste pentru createAssistantPromptScheduler (fără React/DOM - ceas
// fals + random injectat, la fel ca restul modulelor pure din proiect).
//
// Rulare: node --test src/components/FloatingHub/assistantPromptScheduler.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { createAssistantPromptScheduler } from "./assistantPromptScheduler.js";

/* =========================================================
   CEAS FALS - `now()` și `setTimeout` legate de ACELAȘI timp intern
========================================================= */

function makeFakeClock(startAt = 0) {
  let idSeq = 0;
  let currentTime = startAt;
  const pending = new Map(); // id -> { fn, dueAt }

  function setTimeoutFn(fn, ms) {
    const id = ++idSeq;
    pending.set(id, { fn, dueAt: currentTime + ms });
    return id;
  }

  function clearTimeoutFn(id) {
    pending.delete(id);
  }

  function advance(ms) {
    currentTime += ms;
    const due = [...pending.entries()]
      .filter(([, t]) => t.dueAt <= currentTime)
      .sort((a, b) => a[1].dueAt - b[1].dueAt);
    for (const [id, t] of due) {
      pending.delete(id);
      t.fn();
    }
  }

  return {
    now: () => currentTime,
    setTimeoutFn,
    clearTimeoutFn,
    advance,
    pendingCount: () => pending.size,
  };
}

/* =========================================================
   RANDOM CONTROLAT (secvență fixă, altfel 0.5)
========================================================= */

function makeRandom(sequence = []) {
  const queue = [...sequence];
  return () => (queue.length ? queue.shift() : 0.5);
}

/* =========================================================
   HARNESS
========================================================= */

function makeHarness(overrides = {}) {
  const clock = makeFakeClock();
  let shownCount = 0;
  let nextEligibleAt = null;
  let everOpened = false;
  const showCalls = [];

  const scheduler = createAssistantPromptScheduler({
    firstDelayMs: overrides.firstDelayMs ?? 4500,
    minReappearMs: overrides.minReappearMs ?? 60000,
    maxReappearMs: overrides.maxReappearMs ?? 90000,
    dismissCooldownMs: overrides.dismissCooldownMs ?? 240000,
    maxAppearances: overrides.maxAppearances ?? 3,
    getShownCount: () => shownCount,
    incrementShownCount: () => {
      shownCount += 1;
    },
    getNextEligibleAt: () => nextEligibleAt,
    setNextEligibleAt: (t) => {
      nextEligibleAt = t;
    },
    getEverOpened: () => everOpened,
    onShow: () => showCalls.push(clock.now()),
    now: clock.now,
    random: overrides.random ?? makeRandom(),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });

  return {
    scheduler,
    clock,
    showCalls,
    get shownCount() {
      return shownCount;
    },
    get nextEligibleAt() {
      return nextEligibleAt;
    },
    setEverOpened: (v) => {
      everOpened = v;
    },
  };
}

/* =========================================================
   1. PRIMA APARIȚIE (~4,5s)
========================================================= */

test("prima apariție: exact la firstDelayMs, nu mai devreme", () => {
  const h = makeHarness({ firstDelayMs: 4500 });

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(4499);
  assert.equal(h.showCalls.length, 0);

  h.clock.advance(1);
  assert.equal(h.showCalls.length, 1);
  assert.equal(h.shownCount, 1);
});

/* =========================================================
   2. A DOUA APARIȚIE, DUPĂ COOLDOWN (60-90s)
========================================================= */

test("a doua apariție: reprogramată automat, în fereastra 60-90s (auto-perpetuare, fără schimbare de rută)", () => {
  // random=0.5 -> delay reapariție = 60000 + round(0.5*30000) = 75000ms
  const h = makeHarness({ random: makeRandom([0.5]) });

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(4500);
  assert.equal(h.showCalls.length, 1, "prima apariție");

  // nextEligibleAt trebuie să fie în fereastra [60s, 90s] de la prima afișare
  const delta = h.nextEligibleAt - h.showCalls[0];
  assert.ok(delta >= 60000 && delta <= 90000, `delay ${delta}ms în afara ferestrei 60-90s`);
  assert.equal(delta, 75000, "cu random=0.5, exact mijlocul intervalului");

  // înainte de expirare - nicio a doua apariție
  h.clock.advance(74999);
  assert.equal(h.showCalls.length, 1);

  // la expirare - a doua apariție
  h.clock.advance(1);
  assert.equal(h.showCalls.length, 2);
});

/* =========================================================
   3. LIMITĂ MAXIMĂ DE APARIȚII
========================================================= */

test("limită maximă de apariții: exact maxAppearances, apoi NIMIC (fără timer nou)", () => {
  const h = makeHarness({
    maxAppearances: 3,
    random: makeRandom([0.1, 0.5, 0.9]), // irelevant care valori exacte
  });

  h.scheduler.sync({ isHomepage: true, open: false });

  h.clock.advance(4500);
  assert.equal(h.showCalls.length, 1);

  h.clock.advance(90000); // suficient pentru orice reapariție posibilă
  assert.equal(h.showCalls.length, 2);

  h.clock.advance(90000);
  assert.equal(h.showCalls.length, 3);

  // a 4-a NU trebuie să mai apară, indiferent cât timp trece
  assert.equal(h.clock.pendingCount(), 0, "niciun timer nou programat după limită");
  h.clock.advance(10 * 60000);
  assert.equal(h.showCalls.length, 3, "rămâne la maximum");
});

/* =========================================================
   4. DUPĂ DESCHIDEREA ASISTENTULUI, NU MAI APARE
========================================================= */

test("dacă Asistentul e deschis ÎNAINTE de prima apariție -> nu programează nimic", () => {
  const h = makeHarness();
  h.setEverOpened(true);

  h.scheduler.sync({ isHomepage: true, open: false });
  assert.equal(h.clock.pendingCount(), 0);

  h.clock.advance(10 * 60000);
  assert.equal(h.showCalls.length, 0);
});

test("dacă Asistentul e deschis DUPĂ o apariție, apoi închis -> nu mai reapare restul sesiunii", () => {
  const h = makeHarness({ random: makeRandom([0.5]) });

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(4500);
  assert.equal(h.showCalls.length, 1);

  // userul deschide Asistentul (FloatingHub.jsx marchează everOpened=true
  // și apelează sync cu open:true - care oricum anulează orice timer activ)
  h.setEverOpened(true);
  h.scheduler.sync({ isHomepage: true, open: true });
  assert.equal(h.clock.pendingCount(), 0);

  // apoi închide panoul - revenim la open:false, dar everOpened rămâne true
  h.scheduler.sync({ isHomepage: true, open: false });
  assert.equal(h.clock.pendingCount(), 0, "nu se reprogramează - everOpened blochează definitiv");

  h.clock.advance(10 * 60000);
  assert.equal(h.showCalls.length, 1, "o singură apariție, niciodată a doua");
});

/* =========================================================
   5. DISMISS MANUAL -> COOLDOWN MAI LUNG
========================================================= */

test("dismiss manual: suprascrie fereastra scurtă cu un cooldown mai lung, respectat", () => {
  const h = makeHarness({
    random: makeRandom([0.5]), // reapariție normală ar fi la +75000ms
    dismissCooldownMs: 240000,
    maxAppearances: 3,
  });

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(4500);
  assert.equal(h.showCalls.length, 1);

  const normalReappearAt = h.nextEligibleAt; // 4500 + 75000 = 79500

  // userul dă dismiss imediat
  h.scheduler.registerDismiss();
  assert.notEqual(
    h.nextEligibleAt,
    normalReappearAt,
    "cooldown-ul de dismiss suprascrie fereastra normală"
  );
  assert.equal(h.nextEligibleAt, h.clock.now() + 240000);

  // la momentul la care AR fi reapărut normal (75000ms) - NU reapare
  h.clock.advance(75000 - 1);
  assert.equal(h.showCalls.length, 1, "cooldown-ul scurt e ignorat după dismiss");

  // la expirarea cooldown-ului de dismiss - reapare
  h.clock.advance(240000 - 75000 + 1);
  assert.equal(h.showCalls.length, 2, "reapare abia după cooldown-ul mai lung");
});

test("dismiss manual după ULTIMA apariție permisă - nu forțează o reapariție peste limită", () => {
  const h = makeHarness({ maxAppearances: 1, random: makeRandom([0.5]) });

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(4500);
  assert.equal(h.showCalls.length, 1);

  h.scheduler.registerDismiss();
  h.clock.advance(10 * 60000);
  assert.equal(h.showCalls.length, 1, "maxAppearances=1 rămâne respectat");
});

/* =========================================================
   6. NAVIGARE AWAY/BACK NU DUBLEAZĂ TIMERE
========================================================= */

test("navigare away/back repetată înainte de prima apariție - nu dublează timer-ul, nu dublează afișarea", () => {
  const h = makeHarness({ firstDelayMs: 4500 });

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(1000);

  // pleacă și revine de mai multe ori, înainte de expirarea delay-ului
  for (let i = 0; i < 5; i += 1) {
    h.scheduler.sync({ isHomepage: false, open: false });
    assert.ok(h.clock.pendingCount() <= 1, "niciodată mai mult de un timer pending");
    h.scheduler.sync({ isHomepage: true, open: false });
    assert.ok(h.clock.pendingCount() <= 1, "niciodată mai mult de un timer pending");
  }

  h.clock.advance(4500);
  assert.equal(h.showCalls.length, 1, "exact o singură apariție, nu una per revenire");
});

test("navigare away/back repetată ÎNTRE apariții - nu accelerează/dublează reapariția", () => {
  const h = makeHarness({ random: makeRandom([0.5]) });

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(4500);
  assert.equal(h.showCalls.length, 1);

  for (let i = 0; i < 5; i += 1) {
    h.scheduler.sync({ isHomepage: false, open: false });
    h.scheduler.sync({ isHomepage: true, open: false });
    assert.ok(h.clock.pendingCount() <= 1);
  }

  h.clock.advance(75000);
  assert.equal(h.showCalls.length, 2, "reapariția normală, nicio duplicare din cauza navigării");
});

test("deschidere/închidere repetată a panoului nu creează timere multiple", () => {
  const h = makeHarness();

  for (let i = 0; i < 4; i += 1) {
    h.scheduler.sync({ isHomepage: true, open: true });
    assert.equal(h.clock.pendingCount(), 0);
    h.scheduler.sync({ isHomepage: true, open: false });
    assert.equal(h.clock.pendingCount(), 1);
  }

  h.clock.advance(4500);
  assert.equal(h.showCalls.length, 1);
});
