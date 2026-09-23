// src/components/FloatingHub/assistantPromptScheduler.test.js
//
// Teste pentru createAssistantPromptScheduler (fără React/DOM - ceas
// fals injectat, la fel ca restul modulelor pure din proiect).
//
// Rulare: node --test src/components/FloatingHub/assistantPromptScheduler.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { createAssistantPromptScheduler } from "./assistantPromptScheduler.js";

/* =========================================================
   CEAS FALS - control manual asupra timpului, fără dependințe noi
========================================================= */

function makeFakeClock() {
  let idSeq = 0;
  let now = 0;
  const pending = new Map(); // id -> { fn, dueAt }

  function setTimeoutFn(fn, ms) {
    const id = ++idSeq;
    pending.set(id, { fn, dueAt: now + ms });
    return id;
  }

  function clearTimeoutFn(id) {
    pending.delete(id);
  }

  function advance(ms) {
    now += ms;
    const due = [...pending.entries()]
      .filter(([, t]) => t.dueAt <= now)
      .sort((a, b) => a[1].dueAt - b[1].dueAt);
    for (const [id, t] of due) {
      pending.delete(id);
      t.fn();
    }
  }

  return {
    setTimeoutFn,
    clearTimeoutFn,
    advance,
    pendingCount: () => pending.size,
  };
}

function makeHarness({ delayMs = 4500 } = {}) {
  const clock = makeFakeClock();
  let shown = false;
  const showCalls = [];

  const scheduler = createAssistantPromptScheduler({
    delayMs,
    getAlreadyShown: () => shown,
    markShown: () => {
      shown = true;
    },
    onShow: () => {
      showCalls.push(true);
    },
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });

  return {
    scheduler,
    clock,
    showCalls,
    get shownCount() {
      return showCalls.length;
    },
    get isMarkedShown() {
      return shown;
    },
  };
}

/* =========================================================
   COMPORTAMENT DE BAZĂ
========================================================= */

test("programează și afișează după delay, când homepage și panou închis", () => {
  const h = makeHarness();

  h.scheduler.sync({ isHomepage: true, open: false });
  assert.equal(h.clock.pendingCount(), 1);
  assert.equal(h.shownCount, 0);

  h.clock.advance(4499);
  assert.equal(h.shownCount, 0, "nu apare înainte de expirarea delay-ului");

  h.clock.advance(1);
  assert.equal(h.shownCount, 1);
  assert.equal(h.isMarkedShown, true);
});

test("NU programează dacă open=true", () => {
  const h = makeHarness();

  h.scheduler.sync({ isHomepage: true, open: true });
  assert.equal(h.clock.pendingCount(), 0);

  h.clock.advance(10000);
  assert.equal(h.shownCount, 0);
});

test("NU programează dacă isHomepage=false", () => {
  const h = makeHarness();

  h.scheduler.sync({ isHomepage: false, open: false });
  assert.equal(h.clock.pendingCount(), 0);

  h.clock.advance(10000);
  assert.equal(h.shownCount, 0);
});

test("NU reprogramează dacă mesajul e deja marcat ca afișat", () => {
  const h = makeHarness();

  // simulează o afișare anterioară reală (sessionStorage deja "1")
  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(4500);
  assert.equal(h.shownCount, 1);

  h.scheduler.sync({ isHomepage: true, open: false });
  assert.equal(h.clock.pendingCount(), 0, "niciun timer nou programat");

  h.clock.advance(10000);
  assert.equal(h.shownCount, 1, "onShow nu se apelează a doua oară");
});

test("cancel() oprește un timer pending, fără efect ulterior", () => {
  const h = makeHarness();

  h.scheduler.sync({ isHomepage: true, open: false });
  assert.equal(h.clock.pendingCount(), 1);

  h.scheduler.cancel();
  assert.equal(h.clock.pendingCount(), 0);

  h.clock.advance(10000);
  assert.equal(h.shownCount, 0);
});

/* =========================================================
   SCENARIILE CERUTE EXPLICIT
========================================================= */

test("A. intrare pe / -> plecare înainte de delay -> revenire -> mesajul apare", () => {
  const h = makeHarness();

  // efectul React rulează la montare
  h.scheduler.sync({ isHomepage: true, open: false });
  assert.equal(h.clock.pendingCount(), 1);

  // trece puțin timp, dar NU suficient
  h.clock.advance(2000);
  assert.equal(h.shownCount, 0);

  // userul pleacă de pe homepage - efectul React rulează cleanup-ul
  // (cancel), apoi corpul efectului cu isHomepage=false
  h.scheduler.cancel();
  h.scheduler.sync({ isHomepage: false, open: false });
  assert.equal(h.clock.pendingCount(), 0, "timerul a fost anulat la plecare");

  // TENTATIVA NU trebuie considerată "consumată" - sessionStorage
  // rămâne gol, pentru că mesajul nu a fost afișat niciodată
  assert.equal(h.isMarkedShown, false);

  // userul revine pe homepage
  h.scheduler.cancel();
  h.scheduler.sync({ isHomepage: true, open: false });
  assert.equal(
    h.clock.pendingCount(),
    1,
    "un nou timer TREBUIE programat la revenire - aici pica bug-ul vechi"
  );

  h.clock.advance(4500);
  assert.equal(h.shownCount, 1, "mesajul apare la a doua încercare");
});

test("B. intrare pe / cu Assistant deja deschis -> close -> mesajul apare", () => {
  const h = makeHarness();

  // montare cu panoul deja deschis (ex. deep-link ?assistant=quote)
  h.scheduler.sync({ isHomepage: true, open: true });
  assert.equal(h.clock.pendingCount(), 0, "nu se programează cât panoul e deschis");

  // panoul rămâne deschis o vreme
  h.clock.advance(10000);
  assert.equal(h.shownCount, 0);

  // userul închide panoul
  h.scheduler.cancel();
  h.scheduler.sync({ isHomepage: true, open: false });
  assert.equal(
    h.clock.pendingCount(),
    1,
    "la închiderea panoului, mesajul trebuie reprogramat"
  );

  h.clock.advance(4500);
  assert.equal(h.shownCount, 1);
});

test("C. mesaj deja afișat -> navigare away/back -> NU reapare", () => {
  const h = makeHarness();

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(4500);
  assert.equal(h.shownCount, 1);
  assert.equal(h.isMarkedShown, true);

  // pleacă de pe homepage
  h.scheduler.cancel();
  h.scheduler.sync({ isHomepage: false, open: false });
  assert.equal(h.clock.pendingCount(), 0);

  // revine pe homepage
  h.scheduler.cancel();
  h.scheduler.sync({ isHomepage: true, open: false });
  assert.equal(
    h.clock.pendingCount(),
    0,
    "NU se reprogramează - a fost deja afișat în această sesiune"
  );

  h.clock.advance(10000);
  assert.equal(h.shownCount, 1, "tot o singură afișare");
});

test("D. dismiss manual (echivalent: mesaj marcat afișat) -> NU reapare în aceeași sesiune", () => {
  // Dismiss-ul manual (FloatingHub.jsx: dismissPrompt) NU atinge
  // scheduler-ul deloc - doar ascunde vizual (`setShowPrompt(false)`).
  // sessionStorage e deja "1" din momentul AFIȘĂRII (markShown se
  // apelează la show, nu la dismiss) - deci, din perspectiva
  // scheduler-ului, comportamentul e identic cu C: odată marcat ca
  // afișat, niciun sync() ulterior (indiferent de motiv - navigare,
  // deschidere/închidere panou) nu mai reprogramează nimic.
  const h = makeHarness();

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(4500);
  assert.equal(h.shownCount, 1);

  // userul a apăsat × imediat după afișare (echivalent: showPrompt=false
  // în React, sessionStorage rămâne "1" - neatins de dismiss)
  // apoi revine pe homepage / deschide și închide Asistentul de mai
  // multe ori
  for (let i = 0; i < 3; i += 1) {
    h.scheduler.cancel();
    h.scheduler.sync({ isHomepage: false, open: false });
    h.scheduler.cancel();
    h.scheduler.sync({ isHomepage: true, open: true });
    h.scheduler.cancel();
    h.scheduler.sync({ isHomepage: true, open: false });
  }

  assert.equal(h.clock.pendingCount(), 0);
  h.clock.advance(10000);
  assert.equal(h.shownCount, 1, "rămâne o singură afișare, orice ar face userul după");
});

/* =========================================================
   markShown - apelat STRICT la afișarea reală, niciodată mai devreme
========================================================= */

test("markShown NU se apelează pentru o tentativă întreruptă (doar la afișarea reală)", () => {
  const h = makeHarness();

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(1000);

  // întrerupem înainte de expirare
  h.scheduler.cancel();
  assert.equal(h.isMarkedShown, false, "markShown nu a fost apelat");

  h.scheduler.sync({ isHomepage: true, open: false });
  h.clock.advance(4500);
  assert.equal(h.isMarkedShown, true, "markShown se apelează abia la afișarea reală");
  assert.equal(h.shownCount, 1);
});
