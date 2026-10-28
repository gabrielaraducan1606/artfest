// src/utils/productPublishCheck.js
//
// Verificarea DETERMINISTĂ de dinainte de publicare (editorul de produs al
// vânzătorului). Pur, fără React - aceleași reguli ca serverul, refolosite:
//   - variante / prețuri / combinații: backend/src/lib/variantPricing.js
//     (aceleași mesaje ca la salvare - 400 invalid_price_delta /
//     invalid_combination_price);
//   - GPSR: backend/src/lib/gpsrCompliance.js (incomplet = eroare pentru
//     produsele noi / nepublicate; pentru un produs deja publicat doar
//     recomandare - nu blocăm salvarea; incoerent = eroare mereu, serverul
//     îl refuză oricum);
//   - personalizare / grupuri / formular de ofertă:
//     utils/productConfigurationValidator.js (anti-abandon, existent).
//
// Rezultat: ERORI (blochează publicarea) și RECOMANDĂRI (nu blochează),
// fiecare cu `target` - unde duce butonul „Rezolvă” / „Vezi”:
//   { step: "images" | "details" | "customization" | "review",
//     section?: "mode" | "price" | "delivery" | "options" | "custom" | "repeated" | "quote",
//     anchors: [id-uri DOM, în ordinea preferinței] }
//
// Verificările subiective (descriere neclară, categorie posibil
// nepotrivită, contradicții) sunt făcute separat, cu AI, pe server
// (services/productPublishAiCheck.js) - doar recomandări.

import {
  checkCombinationOverrides,
  checkPriceDeltaCents,
  describeCombination,
  optionChoiceValue,
  rawCombinationOverrides,
} from "../../../backend/src/lib/variantPricing.js";
import {
  getGpsrMissingFields,
  isGpsrComplete,
  validateGpsrConsistency,
  validateGpsrManufacturerContact,
  GPSR_PRODUCT_FIELDS,
} from "../../../backend/src/lib/gpsrCompliance.js";
import { validateProductConfiguration } from "./productConfigurationValidator.js";

export const PUBLISH_ORDER_MODES = ["READY_TO_BUY", "OPTIONS", "QUOTE_ONLY"];

// sub atâtea caractere descrierea e doar o recomandare (nu blochează)
const SHORT_DESCRIPTION_CHARS = 80;
const MIN_TITLE_CHARS = 3;

export function normalizePublishOrderMode(value) {
  if (value === "DIRECT") return "READY_TO_BUY";
  if (value === "CUSTOMIZABLE") return "OPTIONS";
  return value || "READY_TO_BUY";
}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function isFilled(value) {
  return value !== "" && value !== null && value !== undefined;
}

// aceeași regulă ca editorul de până acum (QUOTE_ONLY: preț orientativ > 0, fără excepție)
function priceCentsOf(form) {
  if (!isFilled(form?.price)) return null;
  const lei = Number(form.price);
  return Number.isFinite(lei) ? Math.round(lei * 100) : null;
}

function fieldsOf(schema) {
  if (Array.isArray(schema)) return schema;
  if (Array.isArray(schema?.fields)) return schema.fields;
  return [];
}

function fieldLabel(field) {
  return trimmed(field?.label) || trimmed(field?.key) || "fără nume";
}

function rawChoices(field) {
  if (Array.isArray(field?.options)) return field.options;
  if (Array.isArray(field?.values)) return field.values;
  return [];
}

function choiceText(option) {
  if (typeof option === "string") return option.trim();
  if (option && typeof option === "object") return trimmed(option.label ?? option.value ?? option.key);
  return "";
}

/* ---------------- ținte („Rezolvă”) ---------------- */

const TARGETS = {
  images: { step: "images", anchors: ["product-step-images"] },
  title: { step: "details", anchors: ["product-title"] },
  description: { step: "details", anchors: ["product-description"] },
  category: { step: "details", anchors: ["category-combobox-input"] },
  material: { step: "details", anchors: ["product-material"] },
  dimensions: { step: "details", anchors: ["product-dimensions"] },
  gpsr: { step: "details", anchors: ["product-gpsr"] },
  mode: { step: "customization", section: "mode", anchors: ["manual-section-mode"] },
  price: { step: "customization", section: "price", anchors: ["product-order-price", "manual-section-price"] },
  stock: { step: "customization", section: "delivery", anchors: ["product-ready-quantity", "manual-section-delivery"] },
  leadTime: { step: "customization", section: "delivery", anchors: ["product-lead-time", "manual-section-delivery"] },
  options: { step: "customization", section: "options", anchors: ["manual-section-options"] },
  custom: { step: "customization", section: "custom", anchors: ["manual-section-custom"] },
  repeated: { step: "customization", section: "repeated", anchors: ["manual-section-repeated"] },
  quote: { step: "customization", section: "quote", anchors: ["manual-section-quote"] },
};

export function publishTarget(name, extraAnchors = []) {
  const base = TARGETS[name] || { step: "details", anchors: [] };
  return { ...base, anchors: [...extraAnchors, ...base.anchors] };
}

const GPSR_ANCHORS = {
  manufacturerName: "gpsr-manufacturer-name",
  manufacturerAddress: "gpsr-manufacturer-address",
  manufacturerEmail: "gpsr-manufacturer-email",
  responsiblePersonName: "gpsr-rp-name",
  responsiblePersonAddress: "gpsr-rp-address",
  responsiblePersonEmail: "gpsr-rp-email",
  safetyWarnings: "gpsr-safety-warnings",
};

// datele publice ale vendorului-producător (sursa centrală) - câmpurile din ProductGpsrSection
const VENDOR_GPSR_ANCHORS = {
  name: "gpsr-vendor-name",
  address: "gpsr-vendor-address",
  email: "gpsr-vendor-email",
};

const GPSR_MESSAGES = {
  isOwnManufacturer: "Siguranța produsului (GPSR): spune cine este producătorul produsului.",
  vendorGpsrManufacturer: "Siguranța produsului (GPSR): completează datele publice ale producătorului (nume, adresă, email).",
  manufacturerName: "Siguranța produsului (GPSR): completează datele producătorului (nume, adresă, email).",
  manufacturerInEU: "Siguranța produsului (GPSR): precizează dacă producătorul este stabilit în UE.",
  responsiblePersonName: "Siguranța produsului (GPSR): completează persoana responsabilă din UE.",
  safetyWarnings: "Siguranța produsului (GPSR): scrie avertismentele de siguranță sau confirmă că nu se aplică.",
  isForChildren: "Siguranța produsului (GPSR): precizează dacă produsul este destinat copiilor.",
};

// aceleași grupări ca describeMissingGpsr (o problemă per întrebare, nu per câmp)
const GPSR_GROUP = {
  manufacturerAddress: "manufacturerName",
  manufacturerEmail: "manufacturerName",
  responsiblePersonAddress: "responsiblePersonName",
  responsiblePersonEmail: "responsiblePersonName",
};

/* ---------------- verificările ---------------- */

function issue(code, message, target) {
  return { code, message, target };
}

function checkBasics(form, { knownCategories }, errors, recommendations) {
  const images = Array.isArray(form.images) ? form.images.filter(Boolean) : [];
  if (!images.length) {
    errors.push(issue("IMAGES_MISSING", "Adaugă cel puțin o fotografie a produsului.", publishTarget("images")));
  } else if (images.length === 1) {
    recommendations.push(
      issue(
        "FEW_IMAGES",
        "Adaugă încă 1-2 fotografii (detalii, produsul în folosință) - clienții cumpără mai ușor când văd mai mult.",
        publishTarget("images")
      )
    );
  }

  const title = trimmed(form.title);
  if (!title) {
    errors.push(issue("TITLE_MISSING", "Completează titlul produsului.", publishTarget("title")));
  } else if (title.length < MIN_TITLE_CHARS) {
    errors.push(issue("TITLE_TOO_SHORT", "Titlul este prea scurt - scrie ce este produsul.", publishTarget("title")));
  }

  const description = trimmed(form.description);
  if (!description) {
    errors.push(issue("DESCRIPTION_MISSING", "Completează descrierea produsului.", publishTarget("description")));
  } else if (description.length < SHORT_DESCRIPTION_CHARS) {
    recommendations.push(
      issue(
        "DESCRIPTION_SHORT",
        "Descrierea este foarte scurtă - spune din ce este făcut produsul, ce dimensiuni are și cum se folosește.",
        publishTarget("description")
      )
    );
  }

  const category = trimmed(form.category);
  if (!category) {
    errors.push(issue("CATEGORY_MISSING", "Alege o categorie pentru produs.", publishTarget("category")));
  } else if (knownCategories && !knownCategories.has(category)) {
    errors.push(
      issue("CATEGORY_UNKNOWN", "Categoria aleasă nu mai există - alege una din listă.", publishTarget("category"))
    );
  }

  if (!trimmed(form.materialMain)) {
    recommendations.push(
      issue("MATERIAL_MISSING", "Completează materialul principal - apare în filtrele de căutare.", publishTarget("material"))
    );
  }
  if (!trimmed(form.dimensions)) {
    recommendations.push(
      issue("DIMENSIONS_MISSING", "Completează dimensiunile produsului.", publishTarget("dimensions"))
    );
  }
}

function checkPriceAndAvailability(form, mode, errors, recommendations) {
  const cents = priceCentsOf(form);
  if (cents === null || cents <= 0) {
    errors.push(
      issue(
        "PRICE_INVALID",
        mode === "QUOTE_ONLY"
          ? "Completează prețul orientativ al produsului (o sumă mai mare de 0)."
          : "Completează prețul produsului (o sumă mai mare de 0).",
        publishTarget("price")
      )
    );
  }

  if (mode === "READY_TO_BUY") {
    const qty = Number(form.readyQty);
    if (!isFilled(form.readyQty) || !Number.isInteger(qty) || qty < 0) {
      errors.push(
        issue("STOCK_INVALID", "Completează stocul disponibil (un număr întreg, 0 sau mai mare).", publishTarget("stock"))
      );
    } else if (qty === 0) {
      recommendations.push(
        issue(
          "STOCK_ZERO",
          "Stocul este 0 - produsul va apărea ca epuizat până când îl actualizezi.",
          publishTarget("stock")
        )
      );
    }
    return;
  }

  const days = Number(form.leadTimeDays);
  if (!isFilled(form.leadTimeDays) || !Number.isFinite(days) || days <= 0) {
    errors.push(
      issue("LEAD_TIME_INVALID", "Completează timpul estimat de realizare (în zile).", publishTarget("leadTime"))
    );
  }

  if (form.availability === "PREORDER" && !isFilled(form.nextShipDate)) {
    errors.push(
      issue("NEXT_SHIP_DATE_MISSING", "Alege data la care poți livra produsul precomandat.", publishTarget("leadTime"))
    );
  }
}

function checkVariants(form, errors, recommendations) {
  const fields = fieldsOf(form.optionsSchema);

  fields.forEach((field) => {
    if (!field || typeof field !== "object") return; // semnalat de validatorul de configurare

    const label = fieldLabel(field);
    const key = trimmed(field.key);
    const anchors = key ? [`option-values-${key}`] : [];
    const choices = rawChoices(field);
    const required = field.required !== false;

    if (!choices.length) {
      (required ? errors : recommendations).push(
        issue(
          "VARIANT_NO_VALUES",
          required
            ? `Varianta „${label}” nu are valori.`
            : `Varianta opțională „${label}” nu are valori și nu va fi afișată clientului.`,
          publishTarget("options", anchors)
        )
      );
      return;
    }

    if (choices.some((option) => !optionChoiceValue(option))) {
      errors.push(
        issue("VARIANT_EMPTY_VALUE", `Varianta „${label}” are o valoare goală - șterge-o sau completeaz-o.`, publishTarget("options", anchors))
      );
    }

    // aceleași reguli ca la salvare (variantPricing.checkPriceDeltaCents)
    for (const option of choices) {
      if (!option || typeof option !== "object" || !("priceDeltaCents" in option)) continue;
      const check = checkPriceDeltaCents(option.priceDeltaCents);
      if (check.ok) continue;

      const value = optionChoiceValue(option);
      errors.push(
        issue(
          "PRICE_DELTA_INVALID",
          check.reason === "negative"
            ? `Diferența de preț pentru „${choiceText(option)}” (${label}) nu poate fi negativă.`
            : check.reason === "too_large"
              ? `Diferența de preț pentru „${choiceText(option)}” (${label}) este prea mare.`
              : `Diferența de preț pentru „${choiceText(option)}” (${label}) nu este validă.`,
          publishTarget("options", [`option-delta-${key}-${value}`, ...anchors])
        )
      );
    }

  });
}

const COMBINATION_FIX = {
  UNKNOWN_VALUE: "folosește o valoare care nu mai există",
  UNKNOWN_FIELD: "folosește o variantă care nu mai există",
  REPEATED_FIELD: "folosește o variantă aleasă pentru fiecare membru (nu poate avea preț special)",
  MISSING_FIELD: "nu are aleasă o variantă obligatorie",
  INVALID_PRICE: "nu are un preț special valid (o sumă mai mare de 0)",
  DUPLICATE: "apare de două ori",
  EMPTY: "nu are nicio variantă aleasă",
};

function checkCombinations(form, product, errors) {
  const rows = rawCombinationOverrides(form.optionsSchema);
  if (!rows.length) return;

  const { errors: problems } = checkCombinationOverrides(product);
  const seen = new Set();

  for (const problem of problems) {
    const row = rows[problem.index];
    const name = describeCombination(product, row?.selections);
    const fix = COMBINATION_FIX[problem.code];
    const dedupe = `${problem.index}:${problem.code}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    errors.push(
      issue(
        `COMBINATION_${problem.code || "INVALID"}`,
        fix ? `Combinația „${name}” ${fix}.` : problem.message,
        publishTarget("options", [`combination-price-${problem.index}`, "combination-prices"])
      )
    );
  }
}

/*
 * vendorGpsr = sursa centrală pentru „Eu sunt producătorul” (chei
 * gpsrManufacturer*, ciorna din editor sau datele salvate); null = încă
 * necunoscută (se încarcă) -> tratată ca incompletă, ca pe server.
 */
function vendorGpsrIssue(vendorGpsr) {
  if (!vendorGpsr) {
    return issue(
      "GPSR_vendorGpsrManufacturer",
      "Siguranța produsului (GPSR): se încarcă datele publice ale producătorului…",
      publishTarget("gpsr")
    );
  }

  const contact = validateGpsrManufacturerContact({
    name: vendorGpsr.gpsrManufacturerName,
    address: vendorGpsr.gpsrManufacturerAddress,
    email: vendorGpsr.gpsrManufacturerEmail,
  });

  return contact.ok
    ? null
    : issue(
        "GPSR_vendorGpsrManufacturer",
        `Siguranța produsului (GPSR): ${contact.message}`,
        publishTarget("gpsr", [VENDOR_GPSR_ANCHORS[contact.field]].filter(Boolean))
      );
}

function checkGpsr(form, errors, recommendations, { existingPublished, vendorGpsr = null }) {
  if (isGpsrComplete(form, vendorGpsr)) {
    // completat, dar incoerent (ex. alt producător fără date) - același mesaj ca serverul
    const body = Object.fromEntries(GPSR_PRODUCT_FIELDS.map((field) => [field, form[field] ?? null]));
    const consistency = validateGpsrConsistency(body, null);
    if (!consistency.ok) {
      // format invalid al unei valori vechi: pe un produs publicat serverul o
      // acceptă dacă rămâne neschimbată -> doar recomandare
      const formatOnly = /_invalid$/.test(consistency.error || "");
      (existingPublished && formatOnly ? recommendations : errors).push(
        issue("GPSR_INVALID", `Siguranța produsului (GPSR): ${consistency.message}`, publishTarget("gpsr"))
      );
    }
    return;
  }

  const missingFields = getGpsrMissingFields(form, vendorGpsr);
  const groups = new Set(missingFields.map((field) => GPSR_GROUP[field] || field));
  if (existingPublished && groups.size) {
    recommendations.push(
      issue(
        "GPSR_INCOMPLETE_PUBLISHED",
        "Produsul este deja publicat, deci îl poți salva, dar informațiile de siguranță (GPSR) sunt incomplete și trebuie completate. Fără ele, o modificare de conținut poate trimite produsul la verificare, iar produsele noi nu se pot publica.",
        publishTarget("gpsr")
      )
    );
  }
  const target = existingPublished ? recommendations : errors;
  for (const field of groups) {
    if (field === "vendorGpsrManufacturer") {
      const vendorIssue = vendorGpsrIssue(vendorGpsr);
      if (vendorIssue) target.push(vendorIssue);
      continue;
    }
    target.push(
      issue(
        `GPSR_${field}`,
        GPSR_MESSAGES[field] || "Completează informațiile de siguranță ale produsului (GPSR).",
        publishTarget("gpsr", GPSR_ANCHORS[field] ? [GPSR_ANCHORS[field]] : [])
      )
    );
  }
}

// validatorul de configurare existent: path -> secțiune + câmp
function configurationTarget(item) {
  const path = String(item?.path || "");
  const key = trimmed(item?.fieldKey);
  if (path.startsWith("optionsSchema")) return publishTarget("options", key ? [`option-values-${key}`, `option-label-${key}`] : []);
  if (path.startsWith("customSchema")) return publishTarget("custom", key ? [`custom-label-${key}`] : []);
  if (path.startsWith("repeatedGroups")) return publishTarget("repeated");
  if (path.startsWith("quoteSchema")) return publishTarget("quote");
  return publishTarget("options");
}

function checkConfiguration(form, mode, errors, recommendations) {
  if (mode === "OPTIONS") {
    const hasFields =
      fieldsOf(form.optionsSchema).length > 0 ||
      fieldsOf(form.customSchema).length > 0 ||
      fieldsOf(form.repeatedGroups).length > 0;

    if (!hasFields) {
      errors.push(
        issue(
          "OPTIONS_EMPTY",
          "Adaugă cel puțin o variantă sau un câmp de personalizare.",
          publishTarget("options")
        )
      );
    }
  }

  if (mode === "QUOTE_ONLY" && !fieldsOf(form.quoteSchema).length) {
    errors.push(
      issue(
        "QUOTE_FIELDS_EMPTY",
        "Adaugă cel puțin o întrebare pentru formularul de ofertă.",
        publishTarget("quote")
      )
    );
  }

  const validation = validateProductConfiguration({
    orderMode: mode,
    optionsSchema: form.optionsSchema,
    customSchema: form.customSchema,
    repeatedGroups: form.repeatedGroups,
    quoteSchema: form.quoteSchema,
  });

  for (const item of validation.blockingIssues) {
    // variantă fără valori: semnalat deja, cu mesajul scurt (checkVariants)
    if (item.code === "EMPTY_REQUIRED_CHOICE" && String(item.path).startsWith("optionsSchema")) continue;
    errors.push(issue(item.code, item.message, configurationTarget(item)));
  }

  for (const item of validation.warnings) {
    // fără întrebări = deja eroare mai sus
    if (item.code === "VAGUE_QUOTE_SCHEMA") continue;
    recommendations.push(issue(item.code, item.message, configurationTarget(item)));
  }
}

function dedupeIssues(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = `${item.code}|${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {Object} form - formularul editorului (price în lei, orderMode etc.)
 * @param {{ knownCategories?: Set<string>|string[], existingPublished?: boolean, vendorGpsr?: Object|null }} [options]
 *   existingPublished - produs deja publicat (APPROVED la deschidere): GPSR
 *   incomplet devine recomandare, nu eroare.
 *   vendorGpsr - datele publice ale vendorului-producător (gpsrManufacturer*),
 *   pentru isOwnManufacturer = true; null = necunoscute încă.
 * @returns {{ ready: boolean, errors: Array, recommendations: Array, errorsByStep: Object }}
 */
export function checkProductForPublish(
  form = {},
  { knownCategories = null, existingPublished = false, vendorGpsr = null } = {}
) {
  const draft = form && typeof form === "object" ? form : {};
  const categories =
    knownCategories instanceof Set
      ? knownCategories
      : Array.isArray(knownCategories) && knownCategories.length
        ? new Set(knownCategories)
        : null;

  const rawMode = normalizePublishOrderMode(draft.orderMode);
  const errors = [];
  const recommendations = [];

  checkBasics(draft, { knownCategories: categories }, errors, recommendations);

  if (!PUBLISH_ORDER_MODES.includes(rawMode)) {
    errors.push(issue("ORDER_MODE_INVALID", "Alege cum se comandă produsul.", publishTarget("mode")));
  } else {
    checkPriceAndAvailability(draft, rawMode, errors, recommendations);

    if (rawMode === "OPTIONS") {
      const product = {
        priceCents: priceCentsOf(draft) || 0,
        optionsSchema: draft.optionsSchema,
        repeatedGroups: draft.repeatedGroups,
      };
      checkVariants(draft, errors, recommendations);
      checkCombinations(draft, product, errors);
    }

    checkConfiguration(draft, rawMode, errors, recommendations);
  }

  checkGpsr(draft, errors, recommendations, { existingPublished: !!existingPublished, vendorGpsr });

  const finalErrors = dedupeIssues(errors);
  const errorsByStep = {};
  for (const item of finalErrors) {
    (errorsByStep[item.target.step] ||= []).push(item);
  }

  return {
    ready: finalErrors.length === 0,
    errors: finalErrors,
    recommendations: dedupeIssues(recommendations),
    errorsByStep,
  };
}
