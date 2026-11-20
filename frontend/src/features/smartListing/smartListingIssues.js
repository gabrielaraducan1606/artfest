// src/features/smartListing/smartListingIssues.js
//
// Smart Listing - lista UNICĂ de probleme care blochează publicarea, în ordinea
// formularului, fiecare cu:
//   - `summary`: textul scurt din sumarul „Mai ai de completat” („Adaugă prețul”);
//   - `message`: explicația afișată imediat sub câmp;
//   - `step` + `anchor`: pasul și elementul DOM la care duce apăsarea (câmpul,
//     varianta sau valoarea exactă).
// Fără dubluri: aceeași problemă (același element + același text scurt) apare o
// singură dată în sumar și o singură dată sub câmp.
//
// Regulile de validare NU se schimbă aici: problemele vin din verificarea
// existentă (evaluatePublishGate / checkProductForPublish / buildDraftForm);
// acest modul doar le ordonează, le dă o țintă precisă și un text scurt.
//
// Pur, fără React / DOM.

import { anchorForBlocker } from "./smartListingVariantChoice.js";

export const STEP_ORDER = Object.freeze(["photos", "details", "sell", "review"]);

// pasul fiecărei ancore fixe din formular
const ANCHOR_STEP = {
  "sl-photos": "photos",
  "sl-conflicts": "details",
  "sl-title": "details",
  "sl-description": "details",
  "sl-category": "details",
  "sl-color": "details",
  "sl-style": "details",
  "sl-occasions": "details",
  "sl-material": "details",
  "sl-technique": "details",
  "sl-care": "details",
  "sl-dimensions": "details",
  "sl-options": "sell",
  "sl-personalization": "sell",
  "sl-price": "sell",
  "sl-stock": "sell",
  "sl-lead": "sell",
  "sl-producer": "review",
  "sl-warnings-field": "review",
  "sl-children-field": "review",
  "sl-safety": "review",
  "sl-gpsr-confirm": "review",
};

// ordinea elementelor pe pagină (în cadrul aceluiași pas); variantele stau la „sl-options”
const ANCHOR_ORDER = [
  "sl-photos",
  "sl-conflicts",
  "sl-title",
  "sl-description",
  "sl-category",
  "sl-color",
  "sl-style",
  "sl-occasions",
  "sl-material",
  "sl-technique",
  "sl-care",
  "sl-dimensions",
  "sl-options",
  "sl-personalization",
  "sl-price",
  "sl-stock",
  "sl-lead",
  "sl-producer",
  "sl-warnings-field",
  "sl-children-field",
  "sl-safety",
  "sl-gpsr-confirm",
];

export function stepForAnchor(anchor) {
  return ANCHOR_STEP[anchor] || null;
}

// codul problemei -> elementul precis (completează anchorForBlocker)
const ANCHOR_OVERRIDES = {
  AI_CONFLICT: "sl-conflicts",
  PRODUCER_MISSING: "sl-producer",
  PRODUCER_PROFILE: "sl-producer",
  GPSR_isOwnManufacturer: "sl-producer",
  GPSR_vendorGpsrManufacturer: "sl-producer",
  GPSR_manufacturerName: "sl-producer",
  GPSR_manufacturerInEU: "sl-producer",
  GPSR_responsiblePersonName: "sl-producer",
  GPSR_INVALID: "sl-producer",
  GPSR_safetyWarnings: "sl-warnings-field",
  GPSR_isForChildren: "sl-children-field",
  GPSR_DECLARATION: "sl-gpsr-confirm",
};

// textul scurt din sumar; lipsă => mesajul complet
const SUMMARY_BY_CODE = {
  IMAGES_MISSING: "Adaugă cel puțin o fotografie",
  PHOTOS_UPLOADING: "Așteaptă să se încarce fotografiile",
  PHOTOS_FAILED: "Reîncarcă fotografiile care nu au mers",
  PHOTOS_INVALID: "Încarcă din nou fotografiile marcate",
  AI_CONFLICT: "Alege între textul tău și propunerea AI",
  TITLE_MISSING: "Adaugă titlul",
  TITLE_TOO_SHORT: "Scrie un titlu mai clar",
  DESCRIPTION_MISSING: "Adaugă descrierea",
  CATEGORY_MISSING: "Alege categoria",
  CATEGORY_UNKNOWN: "Alege din nou categoria",
  OPTIONS_UNANSWERED: "Spune dacă clientul alege o variantă",
  PRICE_INVALID: "Completează prețul",
  STOCK_INVALID: "Scrie câte bucăți ai",
  LEAD_TIME_INVALID: "Scrie în câte zile realizezi produsul",
  NEXT_SHIP_DATE_MISSING: "Alege data de livrare",
  PRODUCER_MISSING: "Alege cine a realizat produsul",
  GPSR_isOwnManufacturer: "Alege cine a realizat produsul",
  PRODUCER_PROFILE: "Completează datele producătorului",
  GPSR_vendorGpsrManufacturer: "Completează datele producătorului",
  GPSR_manufacturerName: "Completează datele producătorului",
  GPSR_manufacturerInEU: "Completează datele producătorului",
  GPSR_responsiblePersonName: "Completează datele producătorului",
  GPSR_safetyWarnings: "Răspunde dacă produsul are avertismente de siguranță",
  GPSR_isForChildren: "Spune dacă produsul este pentru copii",
  GPSR_DECLARATION: "Bifează confirmarea de siguranță (GPSR)",
};

// mesajul din sumar fără punct final și fără prefixe tehnice
function shortText(text) {
  return String(text || "")
    .replace(/^Siguranța produsului \(GPSR\):\s*/i, "")
    .replace(/\.\s*$/, "")
    .trim();
}

function summaryFor(blocker) {
  if (blocker.summary) return blocker.summary;
  const code = String(blocker.code || "");
  if (SUMMARY_BY_CODE[code]) return SUMMARY_BY_CODE[code];
  if (code === "AI_UNCONFIRMED" && blocker.label) return `Verifică propunerea AI pentru „${blocker.label}”`;
  const text = shortText(blocker.message);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/*
 * Ținta unei probleme de variante din verificarea comună (productPublishCheck):
 * ancora ei e `option-values-<cheie>`; o legăm de varianta din formular.
 */
function variantAnchorFromCheck(blocker, variantIdByKey = {}) {
  const anchors = blocker?.issue?.target?.anchors || [];
  for (const anchor of anchors) {
    const match = /^option-values-(.+)$/.exec(String(anchor || ""));
    if (match && variantIdByKey[match[1]]) return `${variantIdByKey[match[1]]}-new-value`;
  }
  return null;
}

function anchorFor(blocker, ctx) {
  if (blocker.anchor) return blocker.anchor;
  const code = String(blocker.code || "");
  if (code === "AI_UNCONFIRMED" && blocker.field && ctx.fieldAnchors?.[blocker.field]) return ctx.fieldAnchors[blocker.field];
  if (ANCHOR_OVERRIDES[code]) return ANCHOR_OVERRIDES[code];
  if (/^(VARIANT_|PRICE_DELTA_)/.test(code)) return variantAnchorFromCheck(blocker, ctx.variantIdByKey) || "sl-options";
  if (code.startsWith("GPSR")) return "sl-producer";
  return anchorForBlocker(blocker);
}

function stepFor(blocker, anchor) {
  return stepForAnchor(anchor) || blocker.step || (anchor ? "sell" : "review");
}

function orderOf(issue) {
  const stepIndex = STEP_ORDER.indexOf(issue.step);
  const anchorIndex = ANCHOR_ORDER.indexOf(issue.anchor);
  // ancorele dinamice (variante, valori) stau în blocul „sl-options”
  const within = anchorIndex >= 0 ? anchorIndex : ANCHOR_ORDER.indexOf("sl-options");
  return [stepIndex < 0 ? STEP_ORDER.length : stepIndex, within];
}

/**
 * @param {Array} blockers - gate.blockers (evaluatePublishGate), în orice ordine
 * @param {{ fieldAnchors?: Record<string,string>, variantIdByKey?: Record<string,string> }} ctx
 * @returns {Array<{ id, code, summary, message, step, anchor, action }>} în ordinea formularului
 */
export function buildPublishIssues(blockers = [], ctx = {}) {
  const out = [];
  const seen = new Set();
  // problemele de variante semnalate de formular au prioritate față de verificarea comună (același element)
  const localAnchors = new Set(blockers.filter((b) => b?.anchor).map((b) => b.anchor));

  for (const blocker of blockers) {
    if (!blocker) continue;
    const anchor = anchorFor(blocker, ctx);
    const code = String(blocker.code || "");
    if (/^(VARIANT_|PRICE_DELTA_)/.test(code) && anchor && localAnchors.has(anchor)) continue;
    const summary = summaryFor(blocker);
    const key = `${anchor || "-"}|${summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: key,
      code,
      summary,
      message: blocker.message || summary,
      step: stepFor(blocker, anchor),
      anchor: anchor || null,
      // datele producătorului se completează într-o fereastră separată
      action: code === "PRODUCER_PROFILE" || code === "GPSR_vendorGpsrManufacturer" ? "producer" : null,
    });
  }

  return out
    .map((issue, index) => ({ issue, index, order: orderOf(issue) }))
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.index - b.index)
    .map((item) => item.issue);
}

/**
 * Erorile serverului (ancoră -> mesaje, din readServerValidation) ca probleme
 * în același format, ca să apară în sumar și să ducă la câmp.
 */
export function serverIssues(fieldErrors = {}) {
  const out = [];
  for (const [anchor, messages] of Object.entries(fieldErrors || {})) {
    for (const message of messages || []) {
      if (!message) continue;
      out.push({
        id: `server|${anchor}|${message}`,
        code: "SERVER",
        summary: shortText(message),
        message,
        step: stepForAnchor(anchor) || "review",
        anchor,
        action: null,
      });
    }
  }
  return out;
}

/** Problemele vizibile -> { ancoră: [mesaje] } (lângă câmp), fără dubluri. */
export function messagesByAnchor(issues = []) {
  const map = {};
  for (const issue of issues) {
    if (!issue?.anchor || !issue.message) continue;
    const list = (map[issue.anchor] ||= []);
    if (!list.includes(issue.message)) list.push(issue.message);
  }
  return map;
}

/** Problemele unui pas („Continuă” verifică doar pasul curent). */
export function issuesForStep(issues = [], step) {
  return issues.filter((issue) => issue.step === step);
}
