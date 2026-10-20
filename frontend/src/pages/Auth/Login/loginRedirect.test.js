// Rulare: node --test src/pages/Auth/Login/loginRedirect.test.js
//
// Regula după login:
//   a) redirect EXPLICIT dintr-un flow real (acțiune / pagină protejată) -> acolo;
//   b) altfel `next` de la backend; c) altfel dashboard-ul rolului.
// Butonul generic „Autentificare” nu trimite redirect, iar "/" simplu nu e un flow.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getSafeLoginRedirect,
  loginPathFor,
  resolvePostAuthDestination,
  withLoginRedirect,
} from "./loginRedirect.js";

const q = (redirect) => `?auth=login&redirect=${encodeURIComponent(redirect)}`;
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), "utf8");

test("flow-uri contextuale: redirect-ul explicit e păstrat exact", () => {
  for (const flow of [
    "/?action=create-customer-request&mode=manual#cereri-clienti", // cerere începută pe Home
    "/checkout", // coș -> checkout
    "/checkout?vcol=septembrie",
    "/cont/mesaje?threadId=abc123", // link din email „mesaj nou”
    "/mesaje?vendorThreadId=xyz",
    "/vendor/targ-artfest?date=2026-12-01#vanzari", // deep-link protejat vendor
    "/produs/abc?vcol=x#recenzii",
    "/produse?q=lumânări roșii", // spațiile din query rămân valide
  ]) {
    assert.equal(getSafeLoginRedirect(q(flow)), flow, flow);
  }
});

test('redirect="/" (prima pagină simplă) nu e un flow -> null => dashboard-ul rolului', () => {
  for (const home of ["/", "/?", "/#", "/?#"]) {
    assert.equal(getSafeLoginRedirect(q(home)), null, home);
  }
  assert.equal(getSafeLoginRedirect("?redirect=/"), null);
  // dar un flow pe prima pagină (cu query / ancoră) rămâne valid
  assert.equal(getSafeLoginRedirect(q("/#cereri-clienti")), "/#cereri-clienti");
});

test("URL-uri externe / open redirect -> refuzate", () => {
  for (const bad of [
    "https://evil.example/x",
    "http://evil.example",
    "//evil.example/x",
    "/\\evil.example/x", // browserul tratează \ ca / -> //evil.example
    "/\\/evil.example",
    "\\\\evil.example",
    "/\t/evil.example", // tab / newline eliminate de browser din URL
    "/\n/evil.example",
    "javascript:alert(1)",
    "evil.example",
    "",
  ]) {
    assert.equal(getSafeLoginRedirect(q(bad)), null, JSON.stringify(bad));
  }
  assert.equal(getSafeLoginRedirect(""), null);
  assert.equal(getSafeLoginRedirect(undefined), null);
});

test("rutele protejate trimit la login cu întoarcere EXACTĂ la deep-link", () => {
  const loc = { pathname: "/cont/mesaje", search: "?threadId=t1", hash: "" };
  const loginUrl = loginPathFor(loc);
  assert.equal(loginUrl, `/autentificare?redirect=${encodeURIComponent("/cont/mesaje?threadId=t1")}`);
  assert.equal(getSafeLoginRedirect(loginUrl.slice(loginUrl.indexOf("?"))), "/cont/mesaje?threadId=t1");
});

test('withLoginRedirect / resolvePostAuthDestination: "/" și externe nu se propagă', () => {
  assert.equal(withLoginRedirect("/verify-email?email=a", "/"), "/verify-email?email=a");
  assert.equal(withLoginRedirect("/verify-email?email=a", "//evil.example"), "/verify-email?email=a");
  assert.equal(
    withLoginRedirect("/verify-email?email=a", "/checkout"),
    `/verify-email?email=a&redirect=${encodeURIComponent("/checkout")}`
  );
  assert.equal(resolvePostAuthDestination({ redirectTo: "/", fallback: "/desktop-user" }), "/desktop-user");
  assert.equal(resolvePostAuthDestination({ redirectTo: "/checkout", fallback: "/desktop-user" }), "/checkout");
  assert.equal(resolvePostAuthDestination({ redirectTo: "/checkout", vendorIntent: true, fallback: "/onboarding" }), "/onboarding");
});

test("Login.jsx: prioritate redirect explicit -> next backend -> dashboard după rol", () => {
  const src = read("./Login.jsx");
  const block = src.slice(src.indexOf("let next ="), src.indexOf("window.location.assign(\n    next\n  );"));
  assert.ok(block.length > 0);
  assert.match(block, /response\?\.next/);
  assert.match(block, /if \(redirectTo\) \{\s*next = redirectTo;/);
  assert.match(block, /role === "ADMIN"\) \{\s*next = "\/admin";/);
  assert.match(block, /role === "VENDOR"[\s\S]*?next = "\/desktop";/);
  assert.match(block, /role === "INFLUENCER"[\s\S]*?next = "\/influencer";/);
  assert.match(block, /next = "\/desktop-user";/);
});

test("Navbar: butoanele generice deschid modalul FĂRĂ redirect; flow-ul din URL îl păstrează", () => {
  const nav = read("../../../components/Navbar/Navbar.jsx");

  // un singur loc marchează modalul ca deschis de flow: ?auth=login|register din URL
  assert.equal((nav.match(/setAuthOpenedByFlow\(true\)/g) || []).length, 1);
  assert.match(nav, /if \(auth === "login" \|\| auth === "register"\) \{[\s\S]*?setAuthOpenedByFlow\(true\);/);

  // butoanele generice: drawer guest, iconița „Autentificare”, bara mobilă
  assert.match(nav, /const openGenericAuth = useCallback\(\(tab = "login"\) => \{[\s\S]*?setAuthOpenedByFlow\(false\);/);
  assert.match(nav, /login: \(\) => openGenericAuth\("login"\)/);
  assert.match(nav, /register: \(\) => openGenericAuth\("register"\)/);
  assert.match(nav, /onClick=\{\(\) => openGenericAuth\("login"\)\}\s*aria-label="Autentificare"/);
  assert.match(nav, /onOpenAuth=\{\(tab = "login"\) => \{\s*openGenericAuth\(tab\);/);

  // nicio altă deschidere a modalului de login în afara celor două căi
  assert.equal((nav.match(/setAuthOpen\(true\)/g) || []).length, 2);

  // redirect-ul se folosește doar pentru flow și nu rămâne în URL după închidere
  assert.match(nav, /const loginRedirect = authOpenedByFlow \? getSafeLoginRedirect\(location\.search\) : null;/);
  assert.match(nav, /const clearAuthParams = useCallback\(\(\) => \{[\s\S]*?sp\.delete\("redirect"\);/);
});
