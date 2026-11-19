// node --test src/features/creators/creatorsLogic.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CREATOR_ROUTES,
  TOUR_STEPS,
  centsToInput,
  clampStep,
  firstIncompleteStep,
  formatFollowers,
  formatLei,
  friendlyError,
  isValidLeiInput,
  liveOnboardingProgress,
  livePublishProblems,
  onboardingProgress,
  parseIntOrNull,
  profileSectionView,
  problemsForStep,
  shouldAutoStartOnboarding,
  socialRowErrors,
  socialUrlError,
  statusView,
  tourReducer,
} from "./creatorsLogic.js";

const problems = [
  { field: "bio", step: 1, message: "Descriere" },
  { field: "socials", step: 2, message: "Rețele" },
];

test("onboarding: maximum 3 pași, pasul din URL limitat, primul pas incomplet, progres", () => {
  assert.equal(clampStep("2"), 2);
  assert.equal(clampStep("9"), 1);
  assert.equal(clampStep("abc"), 1);
  assert.deepEqual(problemsForStep({ publishProblems: problems }, 2).map((p) => p.field), ["socials"]);
  assert.equal(firstIncompleteStep({ publishProblems: problems }), 1);
  assert.equal(firstIncompleteStep({ publishProblems: [problems[1]] }), 2);
  assert.equal(firstIncompleteStep({ publishProblems: [] }), 3);
  assert.deepEqual(onboardingProgress({ publishProblems: problems }), { done: 1, total: 3, percent: 33 });
  assert.deepEqual(onboardingProgress({ publishProblems: [] }), { done: 3, total: 3, percent: 100 });
});

test("intrarea: influencerul nou fără profil merge în onboarding; cel existent vede invitația", () => {
  assert.equal(shouldAutoStartOnboarding({ entry: "setup", autoOnboarding: true }), true);
  assert.equal(shouldAutoStartOnboarding({ entry: "setup", autoOnboarding: false }), false);
  assert.equal(shouldAutoStartOnboarding({ entry: "draft", autoOnboarding: true }), false);

  const setup = statusView({ entry: "setup" });
  assert.equal(setup.cta.to, CREATOR_ROUTES.onboarding);
  const draft = statusView({ entry: "draft", profile: { publishProblems: [problems[1]] } });
  assert.equal(draft.cta.label, "Continuă configurarea");
  assert.equal(draft.cta.to, `${CREATOR_ROUTES.onboarding}?pas=2`, "continuă de unde a rămas");
});

test("status: pending / modificări / aprobat / respins / suspendat / pauză, cu mesajul echipei", () => {
  assert.equal(statusView({ entry: "pending", profile: {} }).badge, "În verificare");
  assert.match(statusView({ entry: "pending", profile: { hasPublishedVersion: true } }).text, /versiunea aprobată/);
  const changes = statusView({ entry: "changes_requested", profile: { moderationMessage: "Fotografie mai clară." } });
  assert.equal(changes.text, "Fotografie mai clară.");
  assert.ok(changes.cta);
  assert.equal(statusView({ entry: "approved", profile: {} }).cta, null);
  assert.ok(statusView({ entry: "approved", profile: { hasUnpublishedChanges: true } }).cta);
  assert.equal(statusView({ entry: "approved", profile: { paused: true } }).badge, "Pe pauză");
  assert.equal(statusView({ entry: "rejected", profile: { moderationMessage: "Motiv" } }).text, "Motiv");
  assert.equal(statusView({ entry: "approved", profile: { suspended: true } }).badge, "Suspendat");
});

test("tur: 4 pași, Continuă / Înapoi / Omite / reluare", () => {
  assert.equal(TOUR_STEPS.length, 4);
  assert.deepEqual(TOUR_STEPS.map((s) => s.title), ["Profilul meu", "Ofertele mele", "Colaborările mele", "Rezultatele mele"]);
  let s = { index: 0 };
  s = tourReducer(s, "back");
  assert.equal(s.index, 0);
  s = tourReducer(s, "next");
  s = tourReducer(s, "next");
  assert.equal(s.index, 2);
  s = tourReducer(s, "back");
  assert.equal(s.index, 1);
  s = tourReducer(tourReducer(s, "next"), "next");
  assert.deepEqual(s, { index: 3, done: false, outcome: null });
  assert.deepEqual(tourReducer(s, "next"), { index: 3, done: true, outcome: "completed" });
  assert.deepEqual(tourReducer({ index: 1 }, "skip"), { index: 1, done: true, outcome: "skipped" });
  assert.deepEqual(tourReducer({ index: 3, done: true }, "restart"), { index: 0, done: false, outcome: null });
});

test("formatări: urmăritori, lei din bani, câmpul de remunerație", () => {
  assert.equal(formatFollowers(950), "950");
  assert.equal(formatFollowers(12500), "13 mii");
  assert.equal(formatFollowers(1_250_000), "1,3 mil.");
  assert.equal(formatFollowers(-1), "-");
  assert.equal(formatLei(20000), "200 lei");
  assert.equal(formatLei(19950), "199,50 lei");
  assert.equal(centsToInput(19950), "199,50");
  assert.equal(centsToInput(20000), "200");
  assert.equal(centsToInput(null), "");
  for (const ok of ["200", "199,50", "199.5"]) assert.equal(isValidLeiInput(ok), true, ok);
  for (const bad of ["", "abc", "1,234", "-5", "12.345"]) assert.equal(isValidLeiInput(bad), false, bad);
  assert.equal(parseIntOrNull("12.500"), 12500);
  assert.equal(parseIntOrNull(""), null);
  assert.ok(Number.isNaN(parseIntOrNull("12a")));
});

test("erori: mesajul serverului în limbaj natural; niciodată JSON / stack trace", () => {
  assert.equal(friendlyError({ data: { message: "Adresa este deja folosită." } }), "Adresa este deja folosită.");
  assert.equal(friendlyError({ status: 500, data: { message: '{"error":"x"}' } }), "Nu am putut salva. Încearcă din nou.");
  assert.equal(friendlyError({ status: 500, data: { message: "TypeError: x at foo (a.js:1)" } }), "Nu am putut salva. Încearcă din nou.");
  assert.match(friendlyError({ status: 428 }), /conformitate/);
  assert.match(friendlyError({ status: 413 }), /10 MB/);
});

/* ---------------- validare locală + progres din datele nesalvate ---------------- */

const IG = { value: "INSTAGRAM", label: "Instagram", host: "instagram.com", hosts: ["instagram.com", "www.instagram.com"] };
const OPTS = { platforms: [IG], limits: { displayNameMin: 2, bioMin: 40 } };

test("linkuri sociale: mesaj specific pentru fiecare tip de greșeală", () => {
  assert.match(socialUrlError("", IG), /^Adaugă linkul profilului tău Instagram/);
  assert.match(socialUrlError("instagram.com/ana", IG), /înceapă cu https:\/\//);
  assert.match(socialUrlError("http://www.instagram.com/ana", IG), /înceapă cu https:\/\//);
  assert.match(socialUrlError("javascript:alert(1)", IG), /înceapă cu https:\/\//);
  assert.match(socialUrlError("https://www.tiktok.com/@ana", IG), /nu este de pe Instagram/);
  assert.match(socialUrlError("https://instagram.com.evil.ro/ana", IG), /nu este de pe Instagram/);
  assert.match(socialUrlError("https://www.instagram.com/", IG), /nu la pagina principală/);
  assert.match(socialUrlError("https://www.instagram.com/ana pop", IG), /spații/);
  assert.equal(socialUrlError("https://www.instagram.com/ana.pop/", IG), null);
  assert.equal(socialUrlError("https://instagram.com/@ana", IG), null);
  // fără lista completă de domenii (opțiuni vechi): host + www.host
  assert.equal(socialUrlError("https://www.instagram.com/ana", { value: "INSTAGRAM", label: "Instagram", host: "instagram.com" }), null);
});

test("rând social: erori pe câmp; rândul nebifat nu are erori", () => {
  assert.deepEqual(socialRowErrors({ enabled: false, url: "" }, IG), {});
  const e = socialRowErrors({ enabled: true, url: "https://www.instagram.com/ana", followers: "", views: "1,5", engagement: "120" }, IG);
  assert.deepEqual(Object.keys(e).sort(), ["engagement", "followers", "views"]);
  assert.match(e.followers, /Completează numărul de urmăritori/);
  assert.deepEqual(socialRowErrors({ enabled: true, url: "https://www.instagram.com/ana", followers: "12.500", views: "", engagement: "3,5" }, IG), {});
  assert.match(socialRowErrors({ enabled: true, url: "x", followers: "abc" }, IG).followers, /număr întreg/);
});

test("progres: reflectă datele completate dar încă nesalvate", () => {
  // profil salvat gol: serverul raportează toate problemele
  const saved = {
    avatarUrl: "https://cdn/x.jpg",
    displayName: "",
    bio: "",
    niches: [],
    socials: [],
    acceptsProducts: false,
    acceptsPaid: false,
    publishProblems: [
      { field: "displayName", step: 1, message: "Completează numele public." },
      { field: "bio", step: 1, message: "Descriere" },
      { field: "niches", step: 1, message: "Nișă" },
      { field: "socials", step: 2, message: "Rețele" },
      { field: "collaboration", step: 3, message: "Colaborare" },
    ],
  };
  assert.equal(liveOnboardingProgress(saved, {}, OPTS).done, 0);

  const about = { displayName: "Ana", bio: "x".repeat(40), niches: ["lifestyle"] };
  const socials = [{ platform: "INSTAGRAM", enabled: true, url: "https://www.instagram.com/ana", followers: "1200", views: "", engagement: "" }];
  const collab = { acceptsProducts: true, acceptsPaid: false };
  assert.equal(liveOnboardingProgress(saved, { about }, OPTS).done, 1);
  assert.equal(liveOnboardingProgress(saved, { about, socials }, OPTS).done, 2);
  assert.deepEqual(liveOnboardingProgress(saved, { about, socials, collab }, OPTS), { done: 3, total: 3, percent: 100 });

  // rețea bifată dar cu link greșit => pasul 2 nu e complet; mesajul vine de pe server
  const bad = [{ ...socials[0], url: "https://www.tiktok.com/@ana" }];
  assert.deepEqual(livePublishProblems(saved, { about, socials: bad, collab }, OPTS), [{ field: "socials", step: 2, message: "Rețele" }]);

  // fotografia nu e în formular (se salvează imediat) => vine din profil
  assert.equal(livePublishProblems({ ...saved, avatarUrl: null }, { about, socials, collab }, OPTS)[0].field, "avatarUrl");
  // golirea unui câmp salvat scade progresul imediat
  const complete = { ...saved, ...about, ...collab, socials: [{ platform: "INSTAGRAM" }], publishProblems: [] };
  assert.equal(liveOnboardingProgress(complete, { about: { ...about, bio: "scurt" } }, OPTS).done, 2);
  assert.equal(liveOnboardingProgress(null, {}, OPTS).done, 3);
});

test("cardul „Profilul meu”: în verificare nu cere din nou trimiterea", () => {
  const base = { canEditContent: false, hasPublishedVersion: false, publishProblems: [] };
  const pending = profileSectionView({ entry: "pending", profile: base });
  assert.match(pending.text, /în verificare/);
  assert.doesNotMatch(pending.text, /trimite-l spre aprobare/i);
  assert.equal(pending.cta, null);
  assert.match(profileSectionView({ entry: "pending", profile: { ...base, hasPublishedVersion: true } }).text, /versiunea aprobată/);

  const draft = profileSectionView({ entry: "draft", profile: { ...base, canEditContent: true, publishProblems: [{ step: 2 }] } });
  assert.match(draft.text, /trimite-l spre aprobare/);
  assert.equal(draft.cta.to, `${CREATOR_ROUTES.onboarding}?pas=2`);

  assert.equal(profileSectionView({ entry: "approved", profile: { ...base, canEditContent: true, hasPublishedVersion: true } }).cta.label, "Editează profilul");
  assert.equal(profileSectionView({ entry: "changes_requested", profile: { ...base, canEditContent: true } }).cta.label, "Actualizează profilul");
  assert.equal(profileSectionView({ entry: "approved", profile: { ...base, suspended: true } }).cta, null);
  assert.equal(profileSectionView({ entry: "setup", profile: null }).cta, null);
});
