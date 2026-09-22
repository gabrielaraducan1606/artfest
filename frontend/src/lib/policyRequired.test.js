// Rulare: node --test src/lib/policyRequired.test.js   (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  POLICY_REQUIRED_EVENT,
  describePolicyRequired,
  hasPendingRequiredDocuments,
  isPolicyRequiredResponse,
  notifyPolicyRequired,
  pickPendingScope,
  scopeOrderForRole,
} from "./policyRequired.js";

test("428 policy_acceptance_required: documente lipsă și scope-uri", () => {
  const detail = describePolicyRequired(428, {
    error: "policy_acceptance_required",
    scope: "ALL",
    missing: [
      { key: "TOS", scope: "USERS" },
      { key: "VENDOR_TERMS", scope: "VENDORS" },
      { key: "X" },
    ],
  });

  assert.equal(detail.kind, "policy");
  assert.deepEqual(detail.scopes, ["USERS", "VENDORS"]);
  assert.equal(detail.missing.length, 3);
});

test("428 influencer_terms_acceptance_required păstrează statusul termenilor", () => {
  const detail = describePolicyRequired(428, {
    error: "influencer_terms_acceptance_required",
    terms: { outdated: true, currentVersion: "2.0.0" },
  });

  assert.equal(detail.kind, "influencer_terms");
  assert.equal(detail.terms.currentVersion, "2.0.0");
  assert.equal(detail.document, "INFLUENCER_TERMS");
});

test("412 policy_not_accepted (Anexa de expediere) => scope VENDORS", () => {
  const detail = describePolicyRequired(412, {
    error: "policy_not_accepted",
    document: "SHIPPING_ADDENDUM",
    policy: { version: "2.0.0", url: "/anexa-expediere" },
  });

  assert.equal(detail.kind, "policy");
  assert.deepEqual(detail.scopes, ["VENDORS"]);
  assert.equal(detail.document, "SHIPPING_ADDENDUM");
  assert.equal(detail.missing[0].version, "2.0.0");
});

test("alte răspunsuri nu sunt de tip policy required", () => {
  assert.equal(describePolicyRequired(428, { error: "altceva" }), null);
  assert.equal(describePolicyRequired(412, { error: "altceva" }), null);
  assert.equal(describePolicyRequired(401, { error: "policy_acceptance_required" }), null);
  assert.equal(describePolicyRequired(428, null), null);
  assert.equal(describePolicyRequired(428, "text"), null);
  assert.equal(isPolicyRequiredResponse(428, { error: "policy_acceptance_required" }), true);
  assert.equal(isPolicyRequiredResponse(500, {}), false);
});

test("notifyPolicyRequired: emite evenimentul cu detaliul; nu aruncă", () => {
  const target = new EventTarget();
  const received = [];
  target.addEventListener(POLICY_REQUIRED_EVENT, (e) => received.push(e.detail));

  const detail = describePolicyRequired(428, { error: "policy_acceptance_required", scope: "USERS" });

  assert.equal(notifyPolicyRequired(detail, target), true);
  assert.equal(received.length, 1);
  assert.equal(received[0].kind, "policy");

  assert.equal(notifyPolicyRequired(null, target), false);
  assert.equal(notifyPolicyRequired(detail, undefined), false);
  assert.equal(
    notifyPolicyRequired(detail, {
      dispatchEvent() {
        throw new Error("x");
      },
    }),
    false
  );
});

test("gate: documente obligatorii în așteptare", () => {
  const pending = { requiresAction: true, documents: [{ required: true, alreadyAccepted: false }] };

  assert.equal(hasPendingRequiredDocuments(pending), true);
  assert.equal(hasPendingRequiredDocuments({ ...pending, requiresAction: false }), false);
  assert.equal(
    hasPendingRequiredDocuments({ requiresAction: true, documents: [{ required: true, alreadyAccepted: true }] }),
    false
  );
  assert.equal(hasPendingRequiredDocuments(null), false);
});

test("ordinea scope-urilor pe rol și alegerea primului scope cu pending", () => {
  assert.deepEqual(scopeOrderForRole("VENDOR"), ["USERS", "VENDORS"]);
  assert.deepEqual(scopeOrderForRole("USER"), ["USERS"]);
  assert.deepEqual(scopeOrderForRole("INFLUENCER"), ["USERS"]);
  assert.deepEqual(scopeOrderForRole("ADMIN"), []);
  assert.deepEqual(scopeOrderForRole(undefined), []);

  const pending = { requiresAction: true, documents: [{ required: true, alreadyAccepted: false }] };
  const none = { requiresAction: false, documents: [] };

  const order = ["USERS", "VENDORS"];

  assert.equal(pickPendingScope(order, { USERS: pending, VENDORS: pending }), "USERS");
  assert.equal(pickPendingScope(order, { USERS: none, VENDORS: pending }), "VENDORS");
  assert.equal(pickPendingScope(order, { USERS: none, VENDORS: none }), null);
  // indiciul din 412/428 are prioritate doar dacă acel scope are documente în așteptare
  assert.equal(pickPendingScope(order, { USERS: pending, VENDORS: pending }, ["VENDORS"]), "VENDORS");
  assert.equal(pickPendingScope(order, { USERS: pending, VENDORS: none }, ["VENDORS"]), "USERS");
  // scope-urile din afara ordinii rolului sunt ignorate
  assert.equal(pickPendingScope(["USERS"], { USERS: none, VENDORS: pending }, ["VENDORS"]), null);
});

test("reportPolicyRequired: emite doar pentru 428/412 de politici", async () => {
  const { reportPolicyRequired } = await import("./policyRequired.js");
  const target = new EventTarget();
  const received = [];
  target.addEventListener(POLICY_REQUIRED_EVENT, (e) => received.push(e.detail));

  assert.equal(reportPolicyRequired(428, { error: "policy_acceptance_required", scope: "VENDORS" }, target), true);
  assert.equal(reportPolicyRequired(412, { error: "policy_not_accepted", document: "SHIPPING_ADDENDUM" }, target), true);
  assert.equal(reportPolicyRequired(428, { error: "influencer_terms_acceptance_required", terms: {} }, target), true);
  assert.equal(reportPolicyRequired(401, { error: "unauthorized" }, target), false);
  assert.equal(reportPolicyRequired(500, null, target), false);

  assert.deepEqual(received.map((d) => d.kind), ["policy", "policy", "influencer_terms"]);
});

test("api.js apelează reportPolicyRequired pe răspunsurile non-2xx (legătura există)", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./api.js", import.meta.url), "utf8");

  assert.match(source, /import \{ reportPolicyRequired \} from "\.\/policyRequired\.js"/);

  const failureBranch = source.slice(source.indexOf("if (!res.ok)"));

  assert.match(failureBranch, /reportPolicyRequired\(res\.status, data\)/);
  // evenimentul se emite ÎNAINTE de throw, altfel nu ar rula niciodată
  assert.ok(failureBranch.indexOf("reportPolicyRequired") < failureBranch.indexOf("throw err"));
});
