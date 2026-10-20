// Rulare: node --test src/pages/Admin/AdminDesktop/tabs/adminFairTerms.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fairTermsVersionPath, termsAcceptanceView, TERMS_NOT_ACCEPTED_TEXT } from "./adminFairTerms.js";

test("înscriere cu regulament acceptat: versiune, dată, IP, UA și link corect", () => {
  const view = termsAcceptanceView({
    termsVersion: "1.0.0",
    termsAcceptedAt: "2026-10-19T08:06:09.851Z",
    termsIp: "203.0.113.7",
    termsUa: "Mozilla/5.0 Test",
  });
  assert.deepEqual(view, {
    accepted: true,
    version: "1.0.0",
    href: "/targ-artfest/regulament/v1.0.0",
    acceptedAt: "2026-10-19T08:06:09.851Z",
    ip: "203.0.113.7",
    ua: "Mozilla/5.0 Test",
  });
});

test("înscriere fără versiune acceptată: fallback, fără link și fără valori inventate", () => {
  const view = termsAcceptanceView({ termsVersion: null, termsAcceptedAt: null, termsIp: null, termsUa: null });
  assert.equal(view.accepted, false);
  assert.equal(view.version, null);
  assert.equal(view.href, null);
  assert.equal(view.acceptedAt, null);
  assert.equal(view.ip, null);
  assert.equal(view.ua, null);
  assert.equal(TERMS_NOT_ACCEPTED_TEXT, "Regulamentul nu a fost acceptat / versiune indisponibilă");
});

test("fără versiune, dar cu bifă salvată înainte de publicare: datele salvate rămân, versiunea nu", () => {
  const view = termsAcceptanceView({ termsVersion: null, termsAcceptedAt: "2026-10-12T10:00:00Z", termsIp: "198.51.100.2", termsUa: null });
  assert.equal(view.accepted, false);
  assert.equal(view.href, null);
  assert.equal(view.acceptedAt, "2026-10-12T10:00:00Z");
  assert.equal(view.ip, "198.51.100.2");
  assert.equal(view.ua, null);
});

test("linkul versiunii: doar semver, fără URL-uri străine", () => {
  assert.equal(fairTermsVersionPath("1.0.0"), "/targ-artfest/regulament/v1.0.0");
  assert.equal(fairTermsVersionPath(" 2.1.3 "), "/targ-artfest/regulament/v2.1.3");
  assert.equal(fairTermsVersionPath("../drafts"), null);
  assert.equal(fairTermsVersionPath("https://evil.example"), null);
  assert.equal(fairTermsVersionPath(""), null);
  assert.equal(termsAcceptanceView({ termsVersion: "v1" }).href, null);
});
