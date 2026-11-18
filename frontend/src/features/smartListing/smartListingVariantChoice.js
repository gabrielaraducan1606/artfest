// src/features/smartListing/smartListingVariantChoice.js
//
// Smart Listing - răspunsul „Are variante?” și erorile afișate lângă câmpuri.
// Logică pură (fără React), testată în smartListingVariantChoice.test.js.
//
// Reguli:
//   - „Nu” (la întrebarea generală SAU pe un card de variantă propus de AI) confirmă
//     direct că produsul nu are variante, dacă nu rămâne altă variantă aleasă cu „Da”
//     sau adăugată manual. Nu mai există butonul separat „Nu are variante”.
//   - „Nu” la întrebarea generală doar ascunde variantele scrise: ele rămân în ciornă
//     și revin la „Da”, dar NU se salvează pe produs (regula existentă).
//   - „Nu” pe un card AI elimină varianta acelui card (regula existentă).
//   - În ambele cazuri, dacă se pierd valori completate, apelantul cere confirmare
//     (vezi `lostOnNo`).

/** Valorile completate ale unei variante (fără valori goale). */
export function filledValues(variant) {
  return (Array.isArray(variant?.values) ? variant.values : []).filter((value) => {
    const text = typeof value === "object" && value ? value.label ?? value.value ?? "" : value;
    return String(text ?? "").trim().length > 0;
  });
}

export function variantHasContent(variant) {
  return filledValues(variant).length > 0;
}

/** Răspunsurile „no” pentru cardurile AI încă nerăspunse (cele răspunse rămân). */
export function markUnansweredHintsNo(variantHints = [], answers = {}) {
  return { ...Object.fromEntries(variantHints.map((hint) => [hint.key, "no"])), ...answers };
}

/*
 * Ce s-ar pierde la „Nu”:
 *   - hint dat  -> varianta acelui card (dacă are valori), eliminată din formular;
 *   - fără hint -> variantele active cu valori, care nu se mai salvează pe produs.
 */
export function lostOnNo({ variants = [], hint = null, wantsOptions = null }) {
  if (hint) return variants.filter((variant) => variant.fromHint === hint.key && variantHasContent(variant));
  if (wantsOptions !== true) return [];
  return variants.filter(variantHasContent);
}

export function lostOnNoMessage(lost, { fromHint = false } = {}) {
  const names = lost.map((variant) => `„${String(variant.label || "fără nume").trim() || "fără nume"}”`).join(", ");
  return fromHint
    ? `Varianta ${names} are valori completate. Dacă alegi „Nu”, varianta și valorile ei se șterg. Continui?`
    : `Ai completat variantele ${names}. Dacă alegi „Nu”, ele nu se salvează pe produs (le păstrăm doar în ciornă, dacă revii la „Da”). Continui?`;
}

/*
 * Răspunsul pe un card AI. Întoarce noua stare (variante, răspunsuri, wantsOptions).
 * wantsOptions rezultat:
 *   true  - cel puțin un card „Da” sau există variante adăugate manual cât timp erau active;
 *   false - altfel: „Nu” confirmă direct că produsul nu are variante (cardurile
 *           nerăspunse devin „Nu”).
 */
export function answerHint({ hint, yes, variants = [], variantAnswers = {}, wantsOptions = null, variantHints = [], nextId }) {
  const without = variants.filter((variant) => variant.fromHint !== hint.key);
  const answers = { ...variantAnswers, [hint.key]: yes ? "yes" : "no" };

  if (yes) {
    // valorile observate NU se adaugă automat - vânzătorul le alege
    const added = { id: nextId("variant"), fromHint: hint.key, label: hint.label, required: true, values: [] };
    return { variants: [...without, added], variantAnswers: answers, wantsOptions: true };
  }

  const anyYes = Object.values(answers).includes("yes");
  const manualActive = wantsOptions === true && without.some((variant) => !variant.fromHint);
  if (anyYes || manualActive) return { variants: without, variantAnswers: answers, wantsOptions: true };

  return { variants: without, variantAnswers: markUnansweredHintsNo(variantHints, answers), wantsOptions: false };
}

/* ---------------- erori lângă câmpuri ---------------- */

// codul problemei (productPublishCheck / Smart Listing) -> câmpul lângă care apare
const ANCHOR_BY_CODE = {
  IMAGES_MISSING: "sl-photos",
  PHOTOS_UPLOADING: "sl-photos",
  PHOTOS_FAILED: "sl-photos",
  TITLE_MISSING: "sl-title",
  TITLE_TOO_SHORT: "sl-title",
  DESCRIPTION_MISSING: "sl-description",
  CATEGORY_MISSING: "sl-category",
  CATEGORY_UNKNOWN: "sl-category",
  PRICE_INVALID: "sl-price",
  STOCK_INVALID: "sl-stock",
  LEAD_TIME_INVALID: "sl-lead",
  NEXT_SHIP_DATE_MISSING: "sl-lead",
  OPTIONS_UNANSWERED: "sl-options",
  OPTIONS_EMPTY: "sl-options",
  OPTION_CONFIG: "sl-options",
  PRODUCER_MISSING: "sl-safety",
  PRODUCER_PROFILE: "sl-safety",
  GPSR_DECLARATION: "sl-safety",
};

export function anchorForBlocker(blocker) {
  const code = String(blocker?.code || "");
  if (ANCHOR_BY_CODE[code]) return ANCHOR_BY_CODE[code];
  if (/^(VARIANT_|PRICE_DELTA_|COMBINATION_)/.test(code)) return "sl-options";
  if (code.startsWith("GPSR")) return "sl-safety";
  return null;
}

/** { "sl-title": ["Completează titlul produsului."], ... } - fără mesaje duble. */
export function fieldErrorsByAnchor(blockers = []) {
  const map = {};
  for (const blocker of blockers) {
    const anchor = anchorForBlocker(blocker);
    if (!anchor || !blocker.message) continue;
    const list = (map[anchor] ||= []);
    if (!list.includes(blocker.message)) list.push(blocker.message);
  }
  return map;
}
