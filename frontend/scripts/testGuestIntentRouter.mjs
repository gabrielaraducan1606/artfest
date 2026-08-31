#!/usr/bin/env node
// frontend/scripts/testGuestIntentRouter.mjs

/*
 * Regression test runner pentru clasificarea determinstă a
 * intențiilor GUEST (guestIntentTaxonomy.js). Rulează STRICT PASUL 1
 * (regulile determinste) - NU cheamă niciun LLM, deci rulează
 * instant, offline, fără cheie API, și poate fi re-rulat după orice
 * modificare viitoare a regulilor.
 *
 * Rulare:
 *   node frontend/scripts/testGuestIntentRouter.mjs
 *   (sau: npm run test:guest-intents / test:guest-intents:hard /
 *   test:guest-intents:all, din frontend/package.json)
 *
 * Exit code (gândit ca test de regresie PERMANENT, rulabil în CI):
 *   0 dacă TOATE cazurile "exact" (formulare curată - bază/formal/
 *     colocvial/fără diacritice) trec fără nicio clasificare greșită.
 *   1 dacă apare o clasificare GREȘITĂ (sau ratată) pe o formulare
 *     "exact" - o regresie REALĂ pe ceva ce funcționa.
 *
 *   Cazurile "defer-ok" (typo greu / cuvinte complet inversate -
 *   mangling mecanic sintetic, nu formulări realiste) NU blochează
 *   exit code-ul chiar dacă apar ca WRONG - sunt limitări cunoscute,
 *   documentate (vezi raportul de audit), nu regresii noi. Rămân
 *   afișate explicit mai jos, niciodată ascunse tăcut - doar nu opresc
 *   CI-ul pentru o degradare sintetică extremă, deja acceptată.
 */

import { classifyGuestIntentDeterministic } from "../src/components/AIAssistant/guestIntentTaxonomy.js";
import { generateGuestIntentTestSet } from "../src/components/AIAssistant/guestIntentTestSet.js";

const cases = generateGuestIntentTestSet();

const results = cases.map((testCase) => {
  const result = classifyGuestIntentDeterministic(testCase.text);
  const got = result.intent; // poate fi null (DEFER_TO_LLM)

  let status;

  if (got === testCase.expectedIntent) {
    status = "PASS";
  } else if (testCase.tolerance === "defer-ok" && got === null) {
    /*
     * Regula s-a abținut (a deferat la LLM) în loc să ghicească -
     * comportament corect pentru formulări degradate (typo greu,
     * cuvinte inversate), NU un eșec.
     */
    status = "DEFERRED_OK";
  } else if (got === null) {
    status = "MISSED";
  } else {
    /*
     * Cel mai grav caz: o intenție GREȘITĂ, cu încredere - exact ce
     * regulile trebuie să evite (mai bine "nu știu" decât greșit).
     */
    status = "WRONG";
  }

  return { ...testCase, got, ruleId: result.ruleId, status };
});

/* =========================================================================
   RAPORT
========================================================================= */

const byStatus = { PASS: 0, DEFERRED_OK: 0, MISSED: 0, WRONG: 0 };

for (const r of results) byStatus[r.status]++;

const total = results.length;

console.log(`\n=== Guest Intent Router - regression test (${total} cazuri) ===\n`);

const failing = results.filter(
  (r) => r.status === "WRONG" || r.status === "MISSED"
);

/*
 * Regresie REALĂ (blochează CI) = eșec pe formulare "exact" (curată).
 * Limitare CUNOSCUTĂ (afișată, dar nu blochează) = eșec pe "defer-ok"
 * (mangling sintetic extrem - typo greu / cuvinte total inversate).
 */
const realRegressions = failing.filter((r) => r.tolerance !== "defer-ok");
const knownEdgeCases = failing.filter((r) => r.tolerance === "defer-ok");

if (realRegressions.length) {
  console.log(
    `--- REGRESIE REALĂ pe formulare curată (${realRegressions.length}) ---`
  );

  for (const r of realRegressions) {
    console.log(
      `[${r.status}] tema=${r.theme} stil=${r.style} tolerance=${r.tolerance}`
    );
    console.log(`  text: ${JSON.stringify(r.text)}`);
    console.log(
      `  asteptat=${r.expectedIntent}  primit=${r.got || "DEFER_TO_LLM"}  regula=${r.ruleId || "-"}`
    );
  }

  console.log("");
}

if (knownEdgeCases.length) {
  console.log(
    `--- Limitări cunoscute, NU blochează CI (${knownEdgeCases.length}) - mangling sintetic extrem ---`
  );

  for (const r of knownEdgeCases) {
    console.log(
      `[${r.status}] tema=${r.theme} stil=${r.style}: ${JSON.stringify(r.text)} -> asteptat=${r.expectedIntent} primit=${r.got || "DEFER_TO_LLM"}`
    );
  }

  console.log("");
}

/* Distribuție pe intenție (metrici, cerința #12) */
const byIntent = {};

for (const r of results) {
  const key = r.got || "DEFER_TO_LLM";
  byIntent[key] = (byIntent[key] || 0) + 1;
}

console.log("--- Distribuție pe intenție (Pasul 1, determinist) ---");

for (const [intent, count] of Object.entries(byIntent).sort(
  (a, b) => b[1] - a[1]
)) {
  const pct = ((count / total) * 100).toFixed(1);
  console.log(`  ${intent.padEnd(22)} ${String(count).padStart(4)}  (${pct}%)`);
}

console.log("\n--- Sumar ---");
console.log(`  PASS:        ${byStatus.PASS} / ${total}`);
console.log(`  DEFERRED_OK: ${byStatus.DEFERRED_OK} / ${total}`);
console.log(`  MISSED:      ${byStatus.MISSED} / ${total}`);
console.log(`  WRONG:       ${byStatus.WRONG} / ${total}`);

const deferRate = (
  (byIntent.DEFER_TO_LLM || 0) / total * 100
).toFixed(1);

console.log(
  `\n  Rată de deferare la LLM (Pasul 1 nu a decis): ${deferRate}%`
);

const wrongRate = ((byStatus.WRONG / total) * 100).toFixed(1);
console.log(`  Rată de clasificare GREȘITĂ (cea mai gravă): ${wrongRate}%`);

if (knownEdgeCases.length) {
  console.log(
    `  (din care ${knownEdgeCases.length} sunt limitări cunoscute, pe mangling sintetic - nu blochează CI)`
  );
}

const exitCode = realRegressions.length > 0 ? 1 : 0;

console.log(
  `\n${
    exitCode === 0
      ? "✅ Nicio regresie pe formulare curată."
      : "❌ Regresie reală găsită pe formulare curată - de reparat."
  }\n`
);

process.exit(exitCode);
