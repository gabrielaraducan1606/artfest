// src/pages/Influencer/InfluencerCompliancePage/complianceAge.js
//
// Vârsta exactă pentru formularul de conformitate - aceeași regulă ca
// backend-ul (services/influencerComplianceGate.js -> classifyInfluencerAge),
// care revalidează oricum la trimitere:
//   < 16 ani  -> nu poate participa în program;
//   16-17 ani -> acord părinte/tutore (formularul continuă);
//   18+ ani   -> acordul parental nu mai este necesar.
// Ziua curentă e cea din România; contează ziua de naștere, nu doar anul.

export const INFLUENCER_MIN_AGE = 16;
export const INFLUENCER_ADULT_AGE = 18;

export const AGE_MESSAGES = Object.freeze({
  UNDER_MIN: "Programul de influenceri Artfest este disponibil persoanelor care au împlinit 16 ani.",
  ADULT:
    "Ai împlinit 18 ani, deci acordul parental nu mai este necesar. Scrie-ne la support@artfest.ro, iar echipa Artfest poate anula solicitarea.",
});

function todayInBucharest(now) {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bucharest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);
  return { y, m, d };
}

/** -> "INVALID" | "UNDER_MIN" | "MINOR_CONSENT" | "ADULT" */
export function classifyBirthDate(value, now = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "INVALID";
  const [y, m, d] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return "INVALID";
  const t = todayInBucharest(now);
  let age = t.y - y;
  if (t.m < m || (t.m === m && t.d < d)) age -= 1;
  if (age < 0) return "INVALID";
  if (age < INFLUENCER_MIN_AGE) return "UNDER_MIN";
  if (age >= INFLUENCER_ADULT_AGE) return "ADULT";
  return "MINOR_CONSENT";
}
