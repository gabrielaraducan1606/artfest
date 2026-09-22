// Rulare: node --test src/pages/CookieBanner/cookiePreferencesState.test.js  (din frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  initialView,
  isBannerHiddenOnPath,
  reduceView,
} from "./cookiePreferencesState.js";

test("fără decizie: se afișează bannerul; cu decizie: nimic", () => {
  assert.equal(initialView({ hasDecision: false }), "banner");
  assert.equal(initialView({ hasDecision: true }), "closed");
});

test("„Preferințe” deschide panoul ORICÂND: fără decizie și după accept/refuz", () => {
  assert.equal(reduceView("banner", "open-preferences", { hasDecision: false }), "preferences");
  // după accept / refuz bannerul nu mai e afișat, dar preferințele se pot deschide
  assert.equal(reduceView("closed", "open-preferences", { hasDecision: true }), "preferences");
  // deschis de două ori rămâne deschis
  assert.equal(reduceView("preferences", "open-preferences", { hasDecision: true }), "preferences");
});

test("închidere: fără decizie revine la banner, cu decizie se închide; salvarea închide", () => {
  assert.equal(reduceView("preferences", "close-preferences", { hasDecision: false }), "banner");
  assert.equal(reduceView("preferences", "close-preferences", { hasDecision: true }), "closed");
  assert.equal(reduceView("preferences", "saved", { hasDecision: true }), "closed");
  assert.equal(reduceView("banner", "decided", { hasDecision: true }), "closed");
  assert.equal(reduceView("banner", "necunoscut", { hasDecision: false }), "banner");
});

test("pe /preferinte-cookie bannerul nu acoperă pagina", () => {
  assert.equal(isBannerHiddenOnPath("/preferinte-cookie"), true);
  assert.equal(isBannerHiddenOnPath("/preferinte-cookie/"), true);
  assert.equal(isBannerHiddenOnPath("/"), false);
  assert.equal(isBannerHiddenOnPath("/cookies"), false);
  assert.equal(isBannerHiddenOnPath(undefined), false);
});
