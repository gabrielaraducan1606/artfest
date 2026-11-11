// src/features/smartListing/smartListingConfig.js
//
// Artfest Smart Listing (PROTOTIP) - din răspunsurile CONFIRMATE ale
// vânzătorului construiește ciorna în forma formularului existent
// (aceleași chei ca EMPTY_PROD_FORM / buildProductPayload) și schemele
// existente din backend: optionsSchema / customSchema / quoteSchema.
//
// Prețurile se calculează DOAR cu motorul existent
// (backend/src/lib/variantPricing.js - importat, nemodificat), exact ca în
// coș și checkout. Verificarea finală folosește checkProductForPublish
// (utils/productPublishCheck.js), aceeași ca editorul actual.
//
// Pur, fără React / rețea. Nu creează și nu modifică produse.

import {
  MAX_PRICE_DELTA_CENTS,
  normalizeOptionsSchemaPricing,
  resolveVariantPricing,
  variantFields,
  variantPriceRange,
} from "../../../../backend/src/lib/variantPricing.js";
import { makeKey, normalizeForCompare } from "./smartListingProposal.js";

/** Cum vinde vânzătorul produsul (limbaj simplu -> orderMode existent). */
export const SALE_TYPES = Object.freeze({
  // produs gata făcut, cu stoc
  IN_STOCK: "IN_STOCK",
  // clientul alege variante / completează personalizare, se face la comandă
  WITH_OPTIONS: "WITH_OPTIONS",
  // prețul depinde de cerințe
  QUOTE: "QUOTE",
});

export const CUSTOM_FIELD_TYPES = Object.freeze(["text", "textarea", "date", "file"]);

// aceeași schemă implicită ca editorul existent (defaultQuoteSchema)
export function defaultQuoteSchema() {
  return [
    { key: "description", label: "Descriere cerere", type: "textarea", required: true },
    { key: "inspirationImages", label: "Poze inspirație", type: "file", required: false },
  ];
}

/* ---------------- sume în lei ---------------- */

/**
 * "10" / "2,5" / "2.50" -> bani. "" -> 0. Invalid / negativ / prea mare -> null.
 */
export function parseLeiToCents(input, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(input ?? "").trim().replace(/^\+/, "").replace(",", ".");
  if (!raw) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const cents = Math.round(Number(raw) * 100);
  return cents <= max ? cents : null;
}

export function formatLei(cents) {
  if (!Number.isFinite(cents)) return "-";
  const value = (cents / 100).toFixed(2).replace(".", ",");
  return `${value.endsWith(",00") ? value.slice(0, -3) : value} lei`;
}

/**
 * Prețul scris de vânzător („35”, „35,50”) -> forma formularului existent
 * („35.5”). O valoare invalidă rămâne neschimbată, ca verificarea de
 * publicare să o refuze (nu o „reparăm” în tăcere).
 */
export function normalizePriceInput(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return "";
  const cents = parseLeiToCents(raw);
  return cents === null ? raw : String(cents / 100);
}

/**
 * Valorile scrise de vânzător -> valori INDIVIDUALE: „lavandă, trandafir”
 * devine ["lavandă", "trandafir"]. Separatori: virgulă, punct și virgulă,
 * rând nou. Fără duplicate (fără diacritice / majuscule), în ordinea scrisă.
 * Aceeași regulă ca editorul actual (OptionTagComboField: Enter / virgulă).
 */
export function splitValueList(text, existing = []) {
  const seen = new Set((existing || []).map((value) => normalizeForCompare(value)));
  const out = [];
  for (const part of String(text ?? "").split(/[,;\n]+/)) {
    const value = part.replace(/\s+/g, " ").trim();
    const key = normalizeForCompare(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/* ---------------- variante ---------------- */

/**
 * Variantele confirmate -> optionsSchema (forma editorului existent):
 *   { key, label, type: "select", required, options, preset: null, sellerCanAddValues: true }
 * Valoare fără diferență -> string; cu diferență -> { value, label, priceDeltaCents }
 * (identic cu withPriceDelta din ProductOrderModeSection.jsx).
 *
 * @param {Array<{ label: string, required?: boolean, values: Array<{ label: string, deltaLei?: string }> }>} variants
 * @returns {{ optionsSchema: Array, errors: string[] }}
 */
export function buildOptionsSchema(variants = []) {
  const errors = [];
  const usedKeys = new Set();
  const optionsSchema = [];

  for (const variant of Array.isArray(variants) ? variants : []) {
    const label = String(variant?.label || "").trim();
    const key = makeKey(label);

    if (!label || !key) {
      errors.push("O variantă nu are nume.");
      continue;
    }
    if (usedKeys.has(key)) {
      errors.push(`Varianta „${label}” apare de două ori.`);
      continue;
    }
    usedKeys.add(key);

    const seenValues = new Set();
    const options = [];

    for (const item of Array.isArray(variant.values) ? variant.values : []) {
      const valueLabel = String(item?.label || "").trim();
      if (!valueLabel) {
        errors.push(`O valoare de la „${label}” este goală - complet-o sau șterge-o.`);
        continue;
      }

      const norm = normalizeForCompare(valueLabel);
      if (seenValues.has(norm)) {
        errors.push(`„${valueLabel}” apare de două ori la „${label}”.`);
        continue;
      }
      seenValues.add(norm);

      const cents = parseLeiToCents(item?.deltaLei, { max: MAX_PRICE_DELTA_CENTS });
      if (cents === null) {
        errors.push(`Suma pentru „${valueLabel}” (${label}) nu este validă - scrie ex. 5 sau 2,50.`);
        options.push(valueLabel);
        continue;
      }

      options.push(cents > 0 ? { value: valueLabel, label: valueLabel, priceDeltaCents: cents } : valueLabel);
    }

    if (!options.length) errors.push(`Varianta „${label}” nu are nicio valoare.`);

    optionsSchema.push({
      key,
      label,
      type: "select",
      required: variant.required !== false,
      options,
      preset: null,
      sellerCanAddValues: true,
    });
  }

  // aceeași validare ca la salvare pe server (400 invalid_price_delta)
  const server = normalizeOptionsSchemaPricing(optionsSchema);
  if (server.error) errors.push(server.message);

  return { optionsSchema, errors };
}

/**
 * Câmpurile de personalizare confirmate -> customSchema
 * ({ key, label, type, required } - forma normalizeCustomField).
 */
export function buildCustomSchema(fields = []) {
  const errors = [];
  const usedKeys = new Set();
  const customSchema = [];

  for (const field of Array.isArray(fields) ? fields : []) {
    const label = String(field?.label || "").trim();
    const key = makeKey(field?.key || label);
    if (!label || !key) continue;
    if (usedKeys.has(key)) {
      errors.push(`Câmpul „${label}” apare de două ori.`);
      continue;
    }
    usedKeys.add(key);
    const description = String(field?.description || "").trim();
    customSchema.push({
      key,
      label,
      type: CUSTOM_FIELD_TYPES.includes(field.type) ? field.type : "text",
      required: field.required === true,
      // instrucțiunile pentru client: același atribut afișat de pagina produsului
      ...(description ? { description } : {}),
    });
  }

  return { customSchema, errors };
}

/**
 * La cerere de ofertă, serverul păstrează doar quoteSchema, iar ce completează
 * clientul se configurează acolo: personalizarea se adaugă după câmpurile implicite.
 */
function quoteSchemaWithPersonalization(customSchema = []) {
  const fields = defaultQuoteSchema();
  const used = new Set(fields.map((field) => field.key));
  for (const field of customSchema) {
    let key = field.key;
    for (let n = 2; used.has(key); n += 1) key = `${field.key}_${n}`;
    used.add(key);
    fields.push({ ...field, key });
  }
  return fields;
}

/* ---------------- ciorna completă ---------------- */

// alt producător, stabilit în afara UE -> are nevoie de persoană responsabilă
function externalOutsideEU(safety) {
  return safety?.isOwnManufacturer === false && safety?.manufacturerInEU === false;
}

function tagsToFormString(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value || "");
}

/**
 * Tipul de vânzare efectiv. Cu variante / personalizare, sistemul actual
 * folosește OPTIONS = „făcut la comandă” (fără stoc pe variante în formular).
 */
export function resolveSaleType({ saleType, variants = [], customFields = [] }) {
  if (saleType === SALE_TYPES.QUOTE) return SALE_TYPES.QUOTE;
  if (variants.length || customFields.length) return SALE_TYPES.WITH_OPTIONS;
  return saleType === SALE_TYPES.WITH_OPTIONS ? SALE_TYPES.WITH_OPTIONS : SALE_TYPES.IN_STOCK;
}

/**
 * Construiește ciorna în forma formularului existent (aceeași pe care o
 * primesc ProductModal / buildProductPayload / checkProductForPublish).
 *
 * @returns {{ form: Object, saleType: string, errors: string[], notices: string[] }}
 */
export function buildDraftForm({
  details = {},
  images = [],
  commerce = {},
  variants = [],
  customFields = [],
  safety = {},
  video = null,
} = {}) {
  const errors = [];
  const notices = [];

  const { optionsSchema, errors: variantErrors } = buildOptionsSchema(variants);
  const { customSchema, errors: customErrors } = buildCustomSchema(customFields);
  errors.push(...variantErrors, ...customErrors);

  const saleType = resolveSaleType({ saleType: commerce.saleType, variants, customFields });

  // getQuoteFields (asistentul de ofertă) sare peste câmpurile de tip fișier
  if (saleType === SALE_TYPES.QUOTE && customSchema.some((field) => field.type === "file")) {
    notices.push("La cerere de ofertă, clientul trimite fotografiile direct în conversație, nu printr-un câmp separat.");
  }

  if (saleType === SALE_TYPES.QUOTE && variants.length) {
    notices.push(
      "La cerere de ofertă, clientul nu alege variante: le păstrăm în ciornă, dar nu apar pe produs cât timp prețul depinde de cerințe."
    );
  }

  if (commerce.saleType === SALE_TYPES.IN_STOCK && saleType === SALE_TYPES.WITH_OPTIONS) {
    notices.push(
      "Cu variante sau personalizare, produsul se vinde „la comandă”. Stocul scris rămâne salvat și revine dacă le dezactivezi."
    );
  }

  if (saleType === SALE_TYPES.WITH_OPTIONS && !variants.length && !customFields.length) {
    notices.push(
      "Pentru un produs făcut după comandă, adaugă cel puțin o opțiune sau o informație cerută clientului (regula actuală Artfest)."
    );
  }

  const orderMode =
    saleType === SALE_TYPES.QUOTE ? "QUOTE_ONLY" : saleType === SALE_TYPES.WITH_OPTIONS ? "OPTIONS" : "READY_TO_BUY";

  const form = {
    title: String(details.title || "").trim(),
    description: String(details.description || "").trim(),
    price: normalizePriceInput(commerce.price),
    images: Array.isArray(images) ? images : [],
    // prototip: URL local (blob:); în fluxul real, URL-ul fișierului încărcat
    videoUrl: video?.url || null,
    videoMuted: Boolean(video?.url && video?.muted),
    category: details.category || "",
    additionalCategories: Array.isArray(details.additionalCategories) ? details.additionalCategories : [],
    color: details.color || "",

    orderMode,
    acceptsCustom: orderMode !== "READY_TO_BUY",
    availability: orderMode === "READY_TO_BUY" ? "READY" : "MADE_TO_ORDER",
    readyQty: orderMode === "READY_TO_BUY" ? commerce.stock ?? "" : 0,
    leadTimeDays: orderMode === "READY_TO_BUY" ? "" : commerce.leadTimeDays ?? "",
    nextShipDate: "",

    optionsSchema: orderMode === "OPTIONS" ? optionsSchema : [],
    customSchema: orderMode === "OPTIONS" ? customSchema : [],
    repeatedGroups: [],
    quoteSchema: orderMode === "QUOTE_ONLY" ? quoteSchemaWithPersonalization(customSchema) : [],

    materialMain: details.materialMain || "",
    technique: details.technique || "",
    styleTags: tagsToFormString(details.styleTags),
    occasionTags: tagsToFormString(details.occasionTags),
    dimensions: details.dimensions || "",
    careInstructions: details.careInstructions || "",
    specialNotes: details.specialNotes || "",

    shippingWeightGrams: commerce.shippingWeightGrams ?? "",
    shippingLengthCm: "",
    shippingWidthCm: "",
    shippingHeightCm: "",

    isOwnManufacturer: safety.isOwnManufacturer ?? null,
    manufacturerName: safety.isOwnManufacturer === false ? safety.manufacturerName || "" : "",
    manufacturerAddress: safety.isOwnManufacturer === false ? safety.manufacturerAddress || "" : "",
    manufacturerEmail: safety.isOwnManufacturer === false ? safety.manufacturerEmail || "" : "",
    manufacturerInEU: safety.isOwnManufacturer === false ? safety.manufacturerInEU ?? null : null,
    responsiblePersonName: externalOutsideEU(safety) ? safety.responsiblePersonName || "" : "",
    responsiblePersonAddress: externalOutsideEU(safety) ? safety.responsiblePersonAddress || "" : "",
    responsiblePersonEmail: externalOutsideEU(safety) ? safety.responsiblePersonEmail || "" : "",
    safetyWarnings: safety.safetyWarnings ?? null,
    isForChildren: safety.isForChildren ?? null,

    isHidden: false,
    isActive: true,
  };

  return { form, saleType, errors, notices };
}

/* ---------------- prețurile finale ---------------- */

const MAX_PREVIEW_ROWS = 60;

/**
 * Tabelul „ce plătește clientul”, calculat cu resolveVariantPricing
 * (aceeași regulă ca în coș / checkout). Variantele opționale apar și
 * „nealese”. Peste MAX_PREVIEW_ROWS combinații se arată doar primele.
 *
 * @returns {{ rows: Array<{ label: string, unitPriceCents: number, deltaCents: number }>,
 *             total: number, truncated: boolean, minCents: number, maxCents: number }}
 */
export function previewFinalPrices(form) {
  const priceCents = parseLeiToCents(form?.price);
  const product = {
    priceCents: Number.isFinite(priceCents) ? priceCents : 0,
    optionsSchema: form?.optionsSchema || [],
    repeatedGroups: form?.repeatedGroups || [],
  };

  const fields = variantFields(product).filter((field) => !field.repeated);
  const range = variantPriceRange(product, {});

  if (!fields.length) {
    return {
      rows: [{ label: "Produsul", unitPriceCents: product.priceCents, deltaCents: 0 }],
      total: 1,
      truncated: false,
      minCents: range.minCents,
      maxCents: range.maxCents,
    };
  }

  const domains = fields.map((field) => [...(field.required ? [] : [null]), ...field.choices]);
  const total = domains.reduce((n, domain) => n * domain.length, 1);
  const rows = [];

  const walk = (index, selection, labels) => {
    if (rows.length >= MAX_PREVIEW_ROWS) return;
    if (index === fields.length) {
      const result = resolveVariantPricing(product, selection);
      if (result.ok) {
        rows.push({
          label: labels.length ? labels.join(" + ") : "Fără opțiuni",
          unitPriceCents: result.unitPriceCents,
          deltaCents: result.unitPriceCents - product.priceCents,
        });
      }
      return;
    }
    for (const choice of domains[index]) {
      const field = fields[index];
      if (!choice) walk(index + 1, selection, [...labels, `fără ${field.label.toLowerCase()}`]);
      else walk(index + 1, { ...selection, [field.key]: choice.value }, [...labels, choice.label]);
    }
  };
  walk(0, {}, []);

  return {
    rows,
    total,
    truncated: total > rows.length,
    minCents: range.minCents,
    maxCents: range.maxCents,
  };
}

/* ---------------- poarta de publicare ---------------- */

/**
 * Singura decizie „se poate publica?” din prototip. Blochează dacă:
 *   - verificarea existentă (checkProductForPublish) are erori - preț,
 *     stoc / termen, variante fără valori, diferențe invalide, GPSR, colet;
 *   - construirea variantelor / personalizării a raportat erori (sumă
 *     invalidă, valoare dublată, opțiune fără nume) - altfel o sumă greșită
 *     ar dispărea în tăcere din preț;
 *   - există propuneri AI marcate „de verificat” sau conflicte nerezolvate.
 *
 * @returns {{ ready: boolean, blockers: Array<{ code: string, message: string, issue?: Object, step?: string }> }}
 */
export function evaluatePublishGate({
  check,
  draftErrors = [],
  pendingConfirmations = [],
  conflicts = [],
  extraBlockers = [],
}) {
  const blockers = [...extraBlockers];

  for (const issue of check?.errors || []) {
    blockers.push({ code: issue.code, message: issue.message, issue });
  }

  for (const message of draftErrors) {
    blockers.push({ code: "OPTION_CONFIG", message, step: "sell" });
  }

  for (const field of pendingConfirmations) {
    blockers.push({
      code: "AI_UNCONFIRMED",
      message: `Confirmă sau corectează propunerea AI pentru „${field.label}”.`,
      step: "details",
    });
  }

  for (const conflict of conflicts) {
    blockers.push({
      code: "AI_CONFLICT",
      message: `Alege între textul tău și propunerea AI pentru „${conflict.label}”.`,
      step: "details",
    });
  }

  return { ready: blockers.length === 0, blockers };
}
