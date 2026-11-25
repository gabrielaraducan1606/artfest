// backend/src/config/secretSanta.js
//
// Secret Santa - reguli fără câmpuri noi în baza de date:
//   - ediție de TEST = cheia începe cu „TEST” (ex. TEST_SECRET_SANTA_1731600000).
//     Nu apare niciodată ca ediție publică, se deschide doar cu ?test=<cheie>,
//     iar emailurile ei sunt simulate (nu pleacă nimic real).
//   - deschiderea programată a înscrierilor, pe cheia ediției: până la dată,
//     o ediție OPEN arată „Înscrierile încep pe …” și nu acceptă înscrieri.

export const isTestEditionKey = (key) => String(key || "").toUpperCase().startsWith("TEST");

export const SECRET_SANTA_REGISTRATION_OPENS_AT = Object.freeze({
  SECRET_SANTA_2026: "2026-11-17T00:00:00+02:00",
});

export function registrationOpensAt(key) {
  const value = SECRET_SANTA_REGISTRATION_OPENS_AT[String(key || "")];
  return value ? new Date(value) : null;
}

// Ediția oficială și formularul de probă pentru ADMIN (pe /secret-santa),
// disponibil doar până la deschiderea înscrierilor oficiale.
export const SECRET_SANTA_OFFICIAL_KEY = "SECRET_SANTA_2026";
export const SECRET_SANTA_TEST_FORM_EDITION_KEY = "TEST_SECRET_SANTA_FORM";
export const SECRET_SANTA_TEST_VENDOR_NAME = "Secret Santa TEST (participant de probă Artfest)";
export const SECRET_SANTA_TEST_STORES = Object.freeze([
  { id: "test-store-1", name: "Magazin de test Artfest 1" },
  { id: "test-store-2", name: "Magazin de test Artfest 2" },
]);

// Invitația prin email către vânzători (Admin -> Secret Santa). Textul emailului folosește
// aceste valori; CTA = pagina reală de înscriere (ruta /secret-santa din App.jsx).
export const SECRET_SANTA_VENDOR_INVITE = Object.freeze({
  campaignKey: "SECRET_SANTA_2026_VENDOR_INVITE",
  drawDateLabel: "5 decembrie 2026",
  budgetLabel: "50–80 lei",
  ctaPath: "/secret-santa",
});

export function isTestFormAvailable(now = new Date()) {
  const opensAt = registrationOpensAt(SECRET_SANTA_OFFICIAL_KEY);
  return Boolean(opensAt && now < opensAt);
}
