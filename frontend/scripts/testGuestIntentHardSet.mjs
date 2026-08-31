#!/usr/bin/env node
// frontend/scripts/testGuestIntentHardSet.mjs

/*
 * Runner pentru setul de test "greu" (guestIntentHardTestSet.js) -
 * cerința #5/#11 din audit. Format de ieșire cerut explicit:
 * intent | confidence/source | PASS/FAIL.
 *
 * "confidence/source" = 0.9/RULE_ID pentru o regulă determinstă care
 * s-a potrivit, sau "-/DEFER_TO_LLM(Pasul 2)" dacă Pasul 1 s-a
 * abținut - NU inventăm un răspuns LLM aici (fără cheie API în acest
 * mediu de rulare) - "DEFER" ca `expected` e chiar rezultatul CORECT
 * pentru fragmentele dependente de context.
 *
 * Rulare: node frontend/scripts/testGuestIntentHardSet.mjs
 */

import { classifyGuestIntentDeterministic } from "../src/components/AIAssistant/guestIntentTaxonomy.js";
import { GUEST_INTENT_HARD_CASES } from "../src/components/AIAssistant/guestIntentHardTestSet.js";

console.log(
  `\n=== Guest Intent Router - set GREU (${GUEST_INTENT_HARD_CASES.length} cazuri) ===\n`
);

console.log(
  "intent".padEnd(22) +
    "confidence/source".padEnd(28) +
    "rezultat".padEnd(8) +
    "text"
);
console.log("-".repeat(100));

let pass = 0;
let fail = 0;
const failing = [];

for (const testCase of GUEST_INTENT_HARD_CASES) {
  const result = classifyGuestIntentDeterministic(testCase.text);
  const got = result.intent; // poate fi null

  const isDeferExpected = testCase.expected === "DEFER";
  const ok = isDeferExpected ? got === null : got === testCase.expected;

  if (ok) pass++;
  else fail++;

  const intentLabel = got || "DEFER_TO_LLM";

  const sourceLabel = got
    ? `${result.confidence}/${result.ruleId}`
    : "-/DEFER_TO_LLM(Pasul 2)";

  const status = ok ? "PASS" : "FAIL";

  console.log(
    intentLabel.padEnd(22) +
      sourceLabel.padEnd(28) +
      status.padEnd(8) +
      JSON.stringify(testCase.text)
  );

  if (!ok) {
    failing.push({ ...testCase, got: intentLabel });
  }
}

console.log("-".repeat(100));

if (failing.length) {
  console.log(`\n--- FAIL (${failing.length}) - detaliu ---`);

  for (const f of failing) {
    console.log(
      `  "${f.text}" [${f.note}] - așteptat=${f.expected} primit=${f.got}`
    );
  }
}

const total = GUEST_INTENT_HARD_CASES.length;
const passRate = ((pass / total) * 100).toFixed(1);

console.log(`\n=== Sumar set greu ===`);
console.log(`  PASS: ${pass} / ${total} (${passRate}%)`);
console.log(`  FAIL: ${fail} / ${total}`);

process.exit(fail > 0 ? 1 : 0);
