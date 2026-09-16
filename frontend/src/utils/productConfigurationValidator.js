// src/utils/productConfigurationValidator.js
//
// Validator determinist pentru schema de personalizare/variante a unui
// produs (optionsSchema/customSchema/repeatedGroups/quoteSchema) -
// mecanism anti-abandon: prinde configurări incomplete ÎNAINTE ca un
// client să ajungă într-un dead-end în ProductDetails/AiAssistant.
//
// Pur, fără dependințe de React/DOM - folosibil atât în editorul
// vendorului (blochează publicarea), cât și (opțional, mai târziu) pe
// backend.

import {
  humanizeOptionValue,
  normalizeOptionChoice,
} from "./optionLabels.js";

const UNSAFE_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/*
 * Același prag ca butoanele de tip choices din
 * productPersonalizationFlow.js (CHOICE_BUTTON_MAX_VALUES) - peste
 * atât, un câmp cu multe opțiuni devine greu de parcurs fără grupare.
 */
const MANY_OPTIONS_THRESHOLD = 6;

const GENERIC_LABEL_WORDS = new Set([
  "camp",
  "field",
  "optiune",
  "optiuni",
  "option",
  "options",
  "valoare",
  "value",
]);

/*
 * Label-uri de câmp suficient de clare prin ele însele (Culoare,
 * Mărime, Material, Cantitate, Model) - pentru acestea nu cerem o
 * descriere doar pentru că au multe opțiuni; clientul înțelege deja
 * ce înseamnă câmpul din nume. Un câmp mai complex tot poate avea
 * avertismentul dacă vendorul îi dă un nume diferit/mai specific.
 */
const SELF_EXPLANATORY_LABEL_WORDS = new Set([
  "culoare",
  "culori",
  "marime",
  "marimi",
  "material",
  "materiale",
  "cantitate",
  "model",
]);

function isSelfExplanatoryLabel(label) {
  const normalized = normalizeText(label);

  if (!normalized) {
    return false;
  }

  return SELF_EXPLANATORY_LABEL_WORDS.has(
    normalized
  );
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function isImageField(field) {
  const type = String(
    field?.type || ""
  ).toLowerCase();

  return [
    "image",
    "photo",
    "file",
  ].includes(type);
}

function getFieldValues(field) {
  if (Array.isArray(field?.options)) {
    return field.options;
  }

  if (Array.isArray(field?.values)) {
    return field.values;
  }

  return [];
}

function declaresOptions(field) {
  return (
    Array.isArray(field?.options) ||
    Array.isArray(field?.values)
  );
}

function isRequired(field) {
  return field?.required !== false;
}

/*
 * Normalizarea unei opțiuni (string sau { value, label }) e
 * centralizată în utils/optionLabels.js (normalizeOptionChoice),
 * refolosită și de ProductDetails.jsx și de
 * productPersonalizationFlow.js - un singur loc care decide ce
 * înseamnă "opțiune fără label explicit".
 */
const normalizeChoiceValue = normalizeOptionChoice;

/*
 * "Naiv" = aceeași transformare de fallback pe care o face
 * humanizeOptionValue când slug-ul nu e în dicționar (underscore ->
 * spațiu, prima literă mare) - dacă rezultatul REAL coincide cu
 * transformarea naivă, înseamnă că dicționarul n-a avut o traducere
 * reală pentru acest slug.
 */
function naiveHumanize(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return "";
  }

  return raw
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function looksLikeTechnicalSlug(rawValue) {
  const value = String(rawValue || "");

  return (
    /_/.test(value) ||
    /[a-z][A-Z]/.test(value)
  );
}

function isGenericLabel(label) {
  const normalized = normalizeText(label);

  if (!normalized) {
    return false;
  }

  if (normalized.length < 2) {
    return true;
  }

  return GENERIC_LABEL_WORDS.has(
    normalized
  );
}

function makeIssue(
  code,
  message,
  { path, fieldKey = null, groupKey = null }
) {
  return {
    code,
    message,
    path,
    fieldKey,
    groupKey,
  };
}

/*
 * Validează UN singur câmp (optionsSchema/customSchema/quoteSchema/
 * câmp dintr-un repeatedGroup) - întoarce blocking + warnings pentru
 * acest câmp, fără să știe nimic despre unde e folosit.
 */
function validateField(
  field,
  path,
  { groupKey = null } = {}
) {
  const blockingIssues = [];
  const warnings = [];

  if (!field || typeof field !== "object") {
    blockingIssues.push(
      makeIssue(
        "INVALID_FIELD",
        "Acest câmp are o structură invalidă și trebuie recreat.",
        { path, groupKey }
      )
    );

    return { blockingIssues, warnings };
  }

  const key = field.key;
  const label =
    typeof field.label === "string"
      ? field.label.trim()
      : "";
  const required = isRequired(field);

  if (required && !key) {
    blockingIssues.push(
      makeIssue(
        "MISSING_FIELD_KEY",
        `Acest câmp${
          label ? ` ("${label}")` : ""
        } este obligatoriu, dar nu are un identificator intern valid. Șterge-l și adaugă-l din nou.`,
        { path, fieldKey: key || null, groupKey }
      )
    );
  }

  if (key && UNSAFE_KEYS.has(String(key))) {
    blockingIssues.push(
      makeIssue(
        "UNSAFE_FIELD_KEY",
        `Identificatorul „${key}” nu este permis pentru un câmp. Redenumește-l.`,
        { path, fieldKey: key, groupKey }
      )
    );
  }

  if (required && !label) {
    blockingIssues.push(
      makeIssue(
        "MISSING_FIELD_LABEL",
        `Acest câmp${
          key ? ` (${key})` : ""
        } este obligatoriu, dar nu are un nume vizibil pentru client. Adaugă un nume clar pentru acest câmp.`,
        { path, fieldKey: key || null, groupKey }
      )
    );
  } else if (label && isGenericLabel(label)) {
    warnings.push(
      makeIssue(
        "GENERIC_LABEL",
        `Numele „${label}” este prea general - adaugă un nume mai clar pentru acest câmp.`,
        { path, fieldKey: key || null, groupKey }
      )
    );
  }

  const hasOptionsKey = declaresOptions(field);
  const values = getFieldValues(field);

  if (
    required &&
    hasOptionsKey &&
    !isImageField(field) &&
    values.length === 0
  ) {
    blockingIssues.push(
      makeIssue(
        "EMPTY_REQUIRED_CHOICE",
        `Câmpul „${
          label || key || "necunoscut"
        }” este obligatoriu, dar nu are nicio opțiune. Adaugă cel puțin 2 opțiuni.`,
        { path, fieldKey: key || null, groupKey }
      )
    );
  }

  if (values.length > 0) {
    const normalized = values.map(
      normalizeChoiceValue
    );

    const seen = new Map();
    const duplicateValues = new Set();

    for (const item of normalized) {
      const compareKey = normalizeText(
        item.value
      );

      if (!compareKey) {
        continue;
      }

      if (seen.has(compareKey)) {
        duplicateValues.add(item.value);
      } else {
        seen.set(compareKey, true);
      }
    }

    if (duplicateValues.size > 0) {
      blockingIssues.push(
        makeIssue(
          "DUPLICATE_OPTION_VALUES",
          `Câmpul „${
            label || key || "necunoscut"
          }” are opțiuni cu aceeași valoare (${[
            ...duplicateValues,
          ].join(", ")}). Elimină duplicatele.`,
          { path, fieldKey: key || null, groupKey }
        )
      );
    }

    for (const item of normalized) {
      if (item.hadExplicitLabel) {
        continue;
      }

      if (
        !looksLikeTechnicalSlug(
          item.value
        )
      ) {
        continue;
      }

      const humanized = humanizeOptionValue(
        item.value
      );

      const naive = naiveHumanize(
        item.value
      );

      if (humanized === naive) {
        warnings.push(
          makeIssue(
            "TECHNICAL_VALUE_NO_LABEL",
            `Valoarea „${item.value}” nu are un label pentru client - adaugă un nume citibil (ex. în loc de „${item.value}”, scrie „${humanized}”).`,
            { path, fieldKey: key || null, groupKey }
          )
        );
      }
    }

    if (values.length > MANY_OPTIONS_THRESHOLD) {
      warnings.push(
        makeIssue(
          "TOO_MANY_UNGROUPED_OPTIONS",
          `Câmpul „${
            label || key || "necunoscut"
          }” are ${values.length} opțiuni - clienții vor avea greu de ales. Ia în calcul gruparea sau reducerea lor.`,
          { path, fieldKey: key || null, groupKey }
        )
      );
    }
  }

  /*
   * Un câmp cu label evident (Culoare/Mărime/Material/Cantitate/
   * Model) nu are nevoie de descriere doar pentru că are câteva
   * opțiuni - clientul înțelege deja ce alege. Dacă opțiunile devin
   * neobișnuit de multe (peste MANY_OPTIONS_THRESHOLD, ca la
   * TOO_MANY_UNGROUPED_OPTIONS), tot considerăm câmpul complex.
   */
  const isSelfExplanatory =
    isSelfExplanatoryLabel(label);

  const isComplexField =
    (isImageField(field) && required) ||
    (values.length > 3 &&
      !(
        isSelfExplanatory &&
        values.length <=
          MANY_OPTIONS_THRESHOLD
      ));

  if (
    isComplexField &&
    !field.description
  ) {
    warnings.push(
      makeIssue(
        "MISSING_DESCRIPTION",
        `Adaugă o descriere pentru „${
          label || key || "acest câmp"
        }” - clientul are nevoie de context suplimentar.`,
        { path, fieldKey: key || null, groupKey }
      )
    );
  }

  if (
    required &&
    !hasOptionsKey &&
    !isImageField(field) &&
    !field.description
  ) {
    warnings.push(
      makeIssue(
        "REQUIRED_FREE_TEXT_NO_HELP",
        `Câmpul „${
          label || key || "necunoscut"
        }” este text liber obligatoriu, fără nicio explicație - adaugă o descriere care spune clientului ce să scrie.`,
        { path, fieldKey: key || null, groupKey }
      )
    );
  }

  return { blockingIssues, warnings };
}

function validateRepeatedGroup(group, index) {
  const blockingIssues = [];
  const warnings = [];

  const path = `repeatedGroups[${index}]`;

  if (!group || typeof group !== "object") {
    blockingIssues.push(
      makeIssue(
        "INVALID_GROUP",
        "Acest grup de personalizare are o structură invalidă și trebuie recreat.",
        { path }
      )
    );

    return { blockingIssues, warnings };
  }

  const groupKey = group.key || group.id || null;

  const label =
    typeof group.label === "string" && group.label.trim()
      ? group.label.trim()
      : typeof group.title === "string" && group.title.trim()
        ? group.title.trim()
        : "";

  if (!groupKey) {
    blockingIssues.push(
      makeIssue(
        "MISSING_GROUP_KEY",
        `Acest grup de personalizare${
          label ? ` ("${label}")` : ""
        } este incomplet - nu are un identificator valid. Șterge-l și recreează-l.`,
        { path, groupKey: null }
      )
    );
  }

  if (groupKey && UNSAFE_KEYS.has(String(groupKey))) {
    blockingIssues.push(
      makeIssue(
        "UNSAFE_GROUP_KEY",
        `Identificatorul „${groupKey}” nu este permis pentru un grup. Redenumește-l.`,
        { path, groupKey }
      )
    );
  }

  const fields = Array.isArray(group.fields)
    ? group.fields
    : [];

  if (fields.length === 0) {
    blockingIssues.push(
      makeIssue(
        "EMPTY_GROUP_FIELDS",
        `Acest grup de personalizare${
          label ? ` ("${label}")` : ""
        } nu are niciun câmp de completat. Adaugă cel puțin un câmp sau șterge grupul.`,
        { path, groupKey }
      )
    );
  }

  if (!label) {
    warnings.push(
      makeIssue(
        "GENERIC_GROUP_LABEL",
        "Adaugă un nume clar pentru acest grup de personalizare.",
        { path, groupKey }
      )
    );
  } else if (isGenericLabel(label)) {
    warnings.push(
      makeIssue(
        "GENERIC_GROUP_LABEL",
        `Numele „${label}” este prea general pentru acest grup - adaugă un nume mai clar.`,
        { path, groupKey }
      )
    );
  }

  if (fields.length > 5) {
    warnings.push(
      makeIssue(
        "COMPLEX_REPEATED_GROUP",
        `Grupul${
          label ? ` "${label}"` : ""
        } are ${fields.length} câmpuri - clienții cu mai mulți membri vor răspunde la multe întrebări. Ia în calcul simplificarea.`,
        { path, groupKey }
      )
    );
  }

  for (const [fieldIndex, field] of fields.entries()) {
    const result = validateField(
      field,
      `${path}.fields[${fieldIndex}]`,
      { groupKey }
    );

    blockingIssues.push(...result.blockingIssues);
    warnings.push(...result.warnings);
  }

  return { blockingIssues, warnings };
}

/*
 * Validează configurația de personalizare/variante a unui produs sau
 * draft de produs - acceptă fie un `product` complet, fie un `form`
 * din editor (citește defensiv, orice lipsă/non-array devine []).
 */
export function validateProductConfiguration(
  productOrDraft
) {
  const orderMode =
    productOrDraft?.orderMode || null;

  const optionsSchema = Array.isArray(
    productOrDraft?.optionsSchema
  )
    ? productOrDraft.optionsSchema
    : [];

  const customSchema = Array.isArray(
    productOrDraft?.customSchema
  )
    ? productOrDraft.customSchema
    : [];

  const repeatedGroups = Array.isArray(
    productOrDraft?.repeatedGroups
  )
    ? productOrDraft.repeatedGroups
    : [];

  const quoteSchema = Array.isArray(
    productOrDraft?.quoteSchema
  )
    ? productOrDraft.quoteSchema
    : [];

  const blockingIssues = [];
  const warnings = [];

  optionsSchema.forEach((field, index) => {
    const result = validateField(
      field,
      `optionsSchema[${index}]`
    );

    blockingIssues.push(...result.blockingIssues);
    warnings.push(...result.warnings);
  });

  customSchema.forEach((field, index) => {
    const result = validateField(
      field,
      `customSchema[${index}]`
    );

    blockingIssues.push(...result.blockingIssues);
    warnings.push(...result.warnings);
  });

  repeatedGroups.forEach((group, index) => {
    const result = validateRepeatedGroup(
      group,
      index
    );

    blockingIssues.push(...result.blockingIssues);
    warnings.push(...result.warnings);
  });

  /*
   * quoteSchema: doar warnings, nu blocking - flow-ul de cerere de
   * ofertă (assistantQuotes.js, quote-from-product) e deja tolerant
   * la câmpuri lipsă/goale (acceptă text liber sau merge direct la
   * creare cu doar cantitatea) - vezi auditul din raportul anterior.
   */
  if (orderMode === "QUOTE_ONLY") {
    if (quoteSchema.length === 0) {
      warnings.push(
        makeIssue(
          "VAGUE_QUOTE_SCHEMA",
          "Nu ai adăugat niciun câmp pentru cererea de ofertă - clienții vor putea trimite doar cantitatea, fără detalii specifice.",
          { path: "quoteSchema" }
        )
      );
    } else {
      quoteSchema.forEach((field, index) => {
        const result = validateField(
          field,
          `quoteSchema[${index}]`
        );

        warnings.push(...result.warnings);
      });
    }
  }

  return {
    valid: blockingIssues.length === 0,
    blockingIssues,
    warnings,
  };
}
