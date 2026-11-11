// src/features/smartListing/smartListingProposal.js
//
// Artfest Smart Listing (PROTOTIP) - propunerea AI pornind de la fotografii,
// într-un format STRUCTURAT și VALIDAT, plus regulile de aplicare în ciornă.
//
// Pur, fără React / rețea. Nu creează și nu modifică produse.
//
// Reguli (cerute explicit):
//   - AI-ul NU propune preț, stoc, timp de realizare, diferențe de preț sau
//     date de siguranță (GPSR). Dacă le trimite, sunt eliminate și raportate.
//   - Materialul, tehnica și îngrijirea NU se presupun din fotografie: rămân
//     sugestii pe care vânzătorul le acceptă explicit (nu se completează).
//   - Variantele / personalizările observate sunt doar ÎNTREBĂRI (hints),
//     niciodată configurație aplicată.
//   - Nimic deja introdus de vânzător nu se suprascrie: diferențele devin
//     conflicte de confirmat.
//
// Integrarea AI existentă (POST /ai/product-analyze, backend/src/routes/
// aiRoutes.js) a fost evaluată și NU e înlocuită: proposalFromLegacyAnalysis()
// îi transformă răspunsul în propunerea structurată de mai jos. Limitările
// ei (încredere doar globală, culoare implicită „multicolor”, categorie
// implicită „alte”, `questions` neafișate) sunt tratate aici ca incertitudini.

import { CATEGORY_SET } from "../../../../backend/src/constants/categories.js";
import { COLOR_SET } from "../../../../backend/src/constants/colors.js";
import { MATERIAL_LABELS, MATERIAL_SET } from "../../../../backend/src/constants/materials.js";

export const PROPOSAL_VERSION = "smart-listing-proposal-v1";

/** Starea unui câmp propus. */
export const FIELD_STATUS = Object.freeze({
  // propus, aplicat în ciornă (dacă era gol), editabil
  SUGGESTED: "SUGGESTED",
  // aplicat, dar incert - vânzătorul trebuie să confirme
  CONFIRM: "CONFIRM",
  // doar sugestie, NU se aplică fără acceptul vânzătorului
  HINT_ONLY: "HINT_ONLY",
});

// pragul global de încredere sub care orice propunere devine „de confirmat”
export const CONFIDENCE_CONFIRM_BELOW = 0.75;

const LIMITS = Object.freeze({
  title: 80,
  description: 4000,
  text: 160,
  care: 500,
  tags: 8,
  additionalCategories: 3,
  hints: 6,
  hintValues: 20,
  questions: 5,
  reason: 300,
});

// câmpuri descriptive pe care AI-ul le poate propune
export const PROPOSABLE_FIELDS = Object.freeze([
  "title",
  "description",
  "category",
  "additionalCategories",
  "color",
  "styleTags",
  "occasionTags",
  "materialMain",
  "technique",
  "careInstructions",
]);

// aplicate direct în ciornă (dacă erau goale)
const APPLIED_FIELDS = new Set([
  "title",
  "description",
  "category",
  "additionalCategories",
  "color",
  "styleTags",
  "occasionTags",
]);

// nu se presupun din fotografie - doar sugestie, aplicată la click
const HINT_ONLY_FIELDS = new Set(["materialMain", "technique", "careInstructions"]);

// ce nu are voie AI-ul să propună (comercial / siguranță)
export const FORBIDDEN_KEYS = Object.freeze([
  "price",
  "priceCents",
  "readyQty",
  "stock",
  "leadTimeDays",
  "availability",
  "priceDeltaCents",
  "combinationPriceOverrides",
  "safetyWarnings",
  "isForChildren",
  "isOwnManufacturer",
  "manufacturerName",
  "manufacturerAddress",
  "manufacturerEmail",
  "shippingWeightGrams",
]);

const FORBIDDEN = new Set(FORBIDDEN_KEYS);

/* ---------------- utilitare ---------------- */

function text(value, max) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

// descrierea păstrează paragrafele
function multiline(value, max) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function uniqueTexts(list, maxItems, maxLength = LIMITS.text) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const value = text(item, maxLength);
    const norm = normalizeForCompare(value);
    if (!value || seen.has(norm)) continue;
    seen.add(norm);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

function confidenceOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

export function normalizeForCompare(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Aceeași regulă ca makeKey din editorul existent
 * (ProductOrderModeSection.jsx) - cheile trebuie să fie identice.
 */
export function makeKey(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function hasForbiddenKeysDeep(value, path, dropped, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN.has(key)) dropped.push(path ? `${path}.${key}` : key);
    else hasForbiddenKeysDeep(child, path ? `${path}.${key}` : key, dropped, depth + 1);
  }
}

/* ---------------- validarea propunerii ---------------- */

function fieldEntry(value, status, reason = "") {
  return { value, status, reason: text(reason, LIMITS.reason) };
}

function resolveMaterial(raw) {
  const value = text(raw, LIMITS.text);
  if (!value) return "";
  if (MATERIAL_SET.has(value)) return MATERIAL_LABELS[value] || value;
  const byLabel = Object.values(MATERIAL_LABELS).find(
    (label) => normalizeForCompare(label) === normalizeForCompare(value)
  );
  return byLabel || "";
}

function validateHint(raw, kind) {
  if (!raw || typeof raw !== "object") return null;
  const label = text(raw.label, 60);
  const key = makeKey(raw.key || label);
  if (!label || !key) return null;

  if (kind === "variant") {
    return {
      key,
      label,
      // valorile OBSERVATE (ex. text de pe etichetă) - nu sunt confirmate
      observedValues: uniqueTexts(
        (Array.isArray(raw.observedValues) ? raw.observedValues : raw.options || []).map((option) =>
          option && typeof option === "object" ? option.label ?? option.value : option
        ),
        LIMITS.hintValues,
        60
      ),
      reason: text(raw.reason, LIMITS.reason),
    };
  }

  const type = ["text", "textarea", "date", "file"].includes(raw.type) ? raw.type : "text";
  return { key, label, type, reason: text(raw.reason, LIMITS.reason) };
}

function dedupeHints(list) {
  const seen = new Set();
  return list.filter((hint) => {
    if (!hint || seen.has(hint.key)) return false;
    seen.add(hint.key);
    return true;
  });
}

/**
 * Validează strict o propunere brută (de la orice sursă AI) și întoarce
 * forma canonică. Cheile interzise sunt eliminate și raportate în `dropped`.
 *
 * @returns {{ ok: boolean, proposal: Object|null, errors: string[], dropped: string[] }}
 */
export function validateProposal(raw) {
  const errors = [];
  const dropped = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, proposal: null, errors: ["Răspunsul AI nu este un obiect."], dropped };
  }

  hasForbiddenKeysDeep(raw, "", dropped);

  const confidence = confidenceOf(raw.confidence);
  const lowConfidence = confidence === null || confidence < CONFIDENCE_CONFIRM_BELOW;
  const input = raw.fields && typeof raw.fields === "object" ? raw.fields : {};
  const valueOf = (key) => (input[key] && typeof input[key] === "object" && "value" in input[key] ? input[key].value : input[key]);
  const statusOf = (key, fallback) => {
    const requested = input[key]?.status;
    // AI-ul poate cere confirmare, dar nu poate „scoate” un câmp de sub confirmare
    if (requested === FIELD_STATUS.CONFIRM) return FIELD_STATUS.CONFIRM;
    return fallback;
  };
  const reasonOf = (key) => input[key]?.reason || "";

  const fields = {};
  const baseStatus = lowConfidence ? FIELD_STATUS.CONFIRM : FIELD_STATUS.SUGGESTED;

  const title = text(valueOf("title"), LIMITS.title);
  if (title) fields.title = fieldEntry(title, statusOf("title", baseStatus), reasonOf("title"));

  const description = multiline(valueOf("description"), LIMITS.description);
  if (description) fields.description = fieldEntry(description, statusOf("description", baseStatus), reasonOf("description"));

  const category = text(valueOf("category"), 64);
  if (category) {
    if (!CATEGORY_SET.has(category)) {
      errors.push(`Categoria „${category}” nu există și a fost ignorată.`);
    } else {
      // „alte” = AI-ul nu a știut; cere confirmare
      const status = category === "alte" ? FIELD_STATUS.CONFIRM : statusOf("category", baseStatus);
      fields.category = fieldEntry(category, status, category === "alte" ? "AI-ul nu a putut alege o categorie clară." : reasonOf("category"));
    }
  }

  const additional = uniqueTexts(valueOf("additionalCategories"), LIMITS.additionalCategories, 64).filter(
    (key) => CATEGORY_SET.has(key) && key !== category
  );
  if (additional.length) {
    // categoriile suplimentare rămân sugestii (regula existentă din editor)
    fields.additionalCategories = fieldEntry(additional, FIELD_STATUS.HINT_ONLY, reasonOf("additionalCategories"));
  }

  const color = text(valueOf("color"), 32);
  if (color) {
    if (!COLOR_SET.has(color)) {
      errors.push(`Culoarea „${color}” nu există și a fost ignorată.`);
    } else {
      // „multicolor” e și valoarea implicită a integrării existente
      const status = color === "multicolor" ? FIELD_STATUS.CONFIRM : statusOf("color", baseStatus);
      fields.color = fieldEntry(color, status, reasonOf("color"));
    }
  }

  const styleTags = uniqueTexts(valueOf("styleTags"), LIMITS.tags, 40);
  if (styleTags.length) fields.styleTags = fieldEntry(styleTags, statusOf("styleTags", baseStatus), reasonOf("styleTags"));

  const occasionTags = uniqueTexts(valueOf("occasionTags"), LIMITS.tags, 60);
  if (occasionTags.length) {
    fields.occasionTags = fieldEntry(occasionTags, statusOf("occasionTags", baseStatus), reasonOf("occasionTags"));
  }

  const material = resolveMaterial(valueOf("materialMain"));
  if (material) {
    fields.materialMain = fieldEntry(material, FIELD_STATUS.HINT_ONLY, "Materialul nu se poate confirma doar din fotografie.");
  }

  const technique = text(valueOf("technique"), LIMITS.text);
  if (technique) {
    fields.technique = fieldEntry(technique, FIELD_STATUS.HINT_ONLY, "Tehnica se confirmă de tine.");
  }

  const care = text(valueOf("careInstructions"), LIMITS.care);
  if (care) {
    fields.careInstructions = fieldEntry(care, FIELD_STATUS.HINT_ONLY, "Îngrijirea depinde de materialul real.");
  }

  const variantHints = dedupeHints(
    (Array.isArray(raw.variantHints) ? raw.variantHints : []).map((hint) => validateHint(hint, "variant"))
  ).slice(0, LIMITS.hints);

  const personalizationHints = dedupeHints(
    (Array.isArray(raw.personalizationHints) ? raw.personalizationHints : []).map((hint) =>
      validateHint(hint, "custom")
    )
  ).slice(0, LIMITS.hints);

  const orderModeHint = ["READY_TO_BUY", "OPTIONS", "QUOTE_ONLY"].includes(raw.orderModeHint?.value)
    ? {
        value: raw.orderModeHint.value,
        confidence: confidenceOf(raw.orderModeHint.confidence) ?? 0,
        reason: text(raw.orderModeHint.reason, LIMITS.reason),
      }
    : null;

  const proposal = {
    version: PROPOSAL_VERSION,
    source: text(raw.source, 60) || "unknown",
    confidence,
    productType: text(raw.productType, LIMITS.text),
    fields,
    variantHints,
    personalizationHints,
    orderModeHint,
    questions: uniqueTexts(raw.questions, LIMITS.questions, 200),
  };

  const usable = Object.keys(fields).length > 0;
  if (!usable) errors.push("AI-ul nu a putut propune nicio informație din fotografii.");

  return { ok: usable, proposal: usable ? proposal : null, errors, dropped: [...new Set(dropped)] };
}

/**
 * Adaptor pentru răspunsul integrării EXISTENTE (POST /ai/product-analyze).
 * Nu cheamă nimic - doar transformă JSON-ul primit.
 */
export function proposalFromLegacyAnalysis(result) {
  if (!result || typeof result !== "object") return validateProposal(null);

  const optionHints = (Array.isArray(result.likelyOptions) ? result.likelyOptions : []).map((option) => ({
    key: option?.key,
    label: option?.label,
    observedValues: Array.isArray(option?.options) ? option.options : [],
    reason: "Observat în fotografii - confirmă dacă clientul trebuie să aleagă.",
  }));

  const customHints = (Array.isArray(result.likelyCustomFields) ? result.likelyCustomFields : []).map((field) => ({
    key: field?.key,
    label: field?.label,
    type: field?.type,
    reason: "Produsul pare personalizabil.",
  }));

  return validateProposal({
    source: "product-analyze",
    confidence: result.confidence,
    productType: result.visualProductType,
    fields: {
      title: result.title,
      description: result.description,
      category: result.category,
      additionalCategories: result.suggestedAdditionalCategories,
      color: result.color,
      styleTags: result.styleTags,
      occasionTags: result.occasionTags,
      // cheia canonică, dacă a fost recunoscută (eticheta altfel)
      materialMain: result.materialMainKey || result.materialMain,
      technique: result.technique,
      careInstructions: result.careInstructions,
    },
    variantHints: optionHints,
    personalizationHints: customHints,
    orderModeHint: {
      value: result.likelyOrderMode,
      confidence: result.orderModeConfidence,
      reason: result.orderModeReason,
    },
    questions: result.questions,
  });
}

/* ---------------- aplicarea în ciornă ---------------- */

function isEmptyValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  return value === null || value === undefined || String(value).trim() === "";
}

function sameValue(a, b) {
  const norm = (value) =>
    Array.isArray(value) ? value.map(normalizeForCompare).sort().join("|") : normalizeForCompare(value);
  return norm(a) === norm(b);
}

/**
 * Aplică propunerea pe ciorna vânzătorului fără să suprascrie nimic.
 *
 * - câmp gol și neatins -> primește propunerea (doar APPLIED_FIELDS);
 * - câmp completat / atins de vânzător și diferit -> conflict (neaplicat);
 * - materialul / tehnica / îngrijirea -> mereu doar sugestie (hint).
 *
 * @param {Object} draft - ciorna (forma formularului existent)
 * @param {Object} proposal - rezultatul validateProposal().proposal
 * @param {{ touched?: Set<string>|string[] }} [options]
 * @returns {{ draft: Object, fieldStatus: Object, conflicts: Array, hints: Array }}
 */
export function applyProposalToDraft(draft = {}, proposal, { touched = [] } = {}) {
  const touchedSet = touched instanceof Set ? touched : new Set(touched);
  const next = { ...draft };
  const fieldStatus = {};
  const conflicts = [];
  const hints = [];

  for (const field of PROPOSABLE_FIELDS) {
    const entry = proposal?.fields?.[field];
    if (!entry) continue;

    const proposed = entry.value;
    const current = draft[field];

    if (HINT_ONLY_FIELDS.has(field) || entry.status === FIELD_STATUS.HINT_ONLY || !APPLIED_FIELDS.has(field)) {
      if (!sameValue(current, proposed)) hints.push({ field, value: proposed, reason: entry.reason });
      continue;
    }

    if (isEmptyValue(current) && !touchedSet.has(field)) {
      next[field] = Array.isArray(proposed) ? [...proposed] : proposed;
      fieldStatus[field] = entry.status;
      continue;
    }

    if (!sameValue(current, proposed)) {
      conflicts.push({ field, current, proposed, reason: entry.reason });
    }
  }

  return { draft: next, fieldStatus, conflicts, hints };
}

/** Acceptă sau respinge un conflict / o sugestie. Nu atinge alte câmpuri. */
export function resolveSuggestion(draft, { field, proposed, value }, accept) {
  if (!accept) return draft;
  const chosen = proposed !== undefined ? proposed : value;
  return { ...draft, [field]: Array.isArray(chosen) ? [...chosen] : chosen };
}
