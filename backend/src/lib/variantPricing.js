// backend/src/lib/variantPricing.js
//
// Prețul unui produs configurat (variante din optionsSchema) - SURSA UNICĂ
// de adevăr pentru coș, checkout (CARD / COD), snapshot-ul ShipmentItem și
// eligibilitatea codurilor de reducere. Frontend-ul îl importă doar pentru
// feedback instant (ProductDetails / editor); serverul recalculează mereu.
//
// Pur, fără dependențe (nici Prisma, nici React).
//
// Valorile unei variante (optionsSchema[].options[]) pot fi:
//   "S"                                              -> diferență 0
//   { value, label, priceDeltaCents?, ...alte câmpuri }
// priceDeltaCents: întreg >= 0 (bani), opțional; lipsă / invalid -> 0.
// Reducerile prin variante (valori negative) NU sunt acceptate.
//
// Regula (etapa 1): unitPrice = product.priceCents + Σ priceDeltaCents
// pentru valorile alese. Câmpurile de variantă incluse într-un grup
// repetat („pentru fiecare membru”) sunt validate, dar NU schimbă prețul.
//
// Etapa 2 - preț special pe COMBINAȚIE (override = preț FINAL pe bucată):
//   optionsSchema[0].combinationPriceOverrides = [
//     { selections: { culoare: "rosu", petale: "3_petale" }, priceCents: 3500 }
//   ]
// Lista stă pe PRIMA variantă din optionsSchema (fără coloană nouă); la
// citire se adună din toate variantele. O combinație = valorile canonice ale
// variantelor (fără cele din grupuri repetate), identificată cu
// combinationKey() - ordinea cheilor nu contează. Prioritate:
//   1. override exact pentru combinația aleasă -> priceCents;
//   2. altfel product.priceCents + Σ priceDeltaCents.

export const MAX_PRICE_DELTA_CENTS = 1_000_000; // 10.000 lei
export const MAX_COMBINATION_PRICE_CENTS = 100_000_000; // 1.000.000 lei
export const COMBINATION_OVERRIDES_KEY = "combinationPriceOverrides";

export const PRICING_SOURCES = Object.freeze({
  BASE: "BASE",
  VARIANT_DELTAS: "VARIANT_DELTAS",
  COMBINATION_OVERRIDE: "COMBINATION_OVERRIDE",
});

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function schemaFields(schema) {
  if (Array.isArray(schema)) return schema;
  if (Array.isArray(schema?.fields)) return schema.fields;
  return [];
}

function clean(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

/** Valoarea reală a unei opțiuni (aceeași regulă ca normalizeOptionChoice din frontend). */
export function optionChoiceValue(option) {
  if (typeof option === "string") return option.trim();
  if (option && typeof option === "object") {
    return clean(option.value ?? option.key ?? option.label);
  }
  return "";
}

function optionChoiceLabel(option) {
  if (typeof option === "string") return option.trim();
  if (option && typeof option === "object") {
    return clean(option.label ?? option.value ?? option.key);
  }
  return "";
}

/** Diferența de preț salvată pe o opțiune (0 dacă lipsește / e invalidă). */
export function optionPriceDeltaCents(option) {
  if (!option || typeof option !== "object") return 0;
  const n = Number(option.priceDeltaCents);
  if (!Number.isInteger(n) || n <= 0 || n > MAX_PRICE_DELTA_CENTS) return 0;
  return n;
}

/**
 * Validare la SALVARE (vendor / admin): diferența trebuie să lipsească sau
 * să fie un întreg între 0 și MAX_PRICE_DELTA_CENTS.
 */
export function checkPriceDeltaCents(raw) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: 0 };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { ok: false, reason: "invalid" };
  if (n < 0) return { ok: false, reason: "negative" };
  if (n > MAX_PRICE_DELTA_CENTS) return { ok: false, reason: "too_large" };
  return { ok: true, value: n };
}

/**
 * Normalizează diferențele de preț și prețurile pe combinații din
 * optionsSchema înainte de salvare. Nu atinge nimic altceva din schemă.
 * Întoarce { optionsSchema } sau { error, message, errors? } (400) -
 * niciodată nu „repară” / nu șterge în tăcere o regulă de preț invalidă.
 *
 * @param {{ repeatedGroups?: Array }} [opts] - variantele din grupuri
 *   repetate nu pot face parte dintr-o combinație cu preț special
 */
export function normalizeOptionsSchemaPricing(optionsSchema, { repeatedGroups = [] } = {}) {
  const priced = normalizeOptionDeltas(optionsSchema);
  if (priced.error || !Array.isArray(priced.optionsSchema)) return priced;
  return normalizeCombinationOverrides(priced.optionsSchema, { repeatedGroups });
}

function normalizeOptionDeltas(optionsSchema) {
  if (!Array.isArray(optionsSchema)) return { optionsSchema };

  let error = null;

  const next = optionsSchema.map((field) => {
    if (!field || typeof field !== "object" || !Array.isArray(field.options)) return field;

    const options = field.options.map((option) => {
      if (!option || typeof option !== "object" || !("priceDeltaCents" in option)) return option;

      const check = checkPriceDeltaCents(option.priceDeltaCents);
      if (!check.ok) {
        error ||= {
          field: field.label || field.key || "",
          value: optionChoiceLabel(option),
          reason: check.reason,
        };
        return option;
      }

      const { priceDeltaCents, ...rest } = option;
      return check.value > 0 ? { ...rest, priceDeltaCents: check.value } : rest;
    });

    return { ...field, options };
  });

  if (error) {
    const what = `„${error.value}”${error.field ? ` (${error.field})` : ""}`;
    return {
      error: "invalid_price_delta",
      message:
        error.reason === "negative"
          ? `Diferența de preț pentru ${what} nu poate fi negativă.`
          : error.reason === "too_large"
            ? `Diferența de preț pentru ${what} este prea mare.`
            : `Diferența de preț pentru ${what} nu este validă.`,
    };
  }

  return { optionsSchema: next };
}

/* ---------------- prețuri pe combinații (etapa 2) ---------------- */

/**
 * Identificatorul canonic al unei combinații - aceeași normalizare ca
 * normalizeCartData (lib/configurationKey.js, folosită de configurationKey):
 * trim, fără valori goale, chei sortate. {petale, culoare} === {culoare, petale}.
 */
export function combinationKey(selections) {
  const entries = Object.entries(plainObject(selections))
    .map(([key, value]) => [clean(key), clean(value)])
    .filter(([key, value]) => key && value && !UNSAFE_KEYS.has(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify(Object.fromEntries(entries));
}

/** Lista brută, adunată din toate variantele (ordinea din schemă). */
export function rawCombinationOverrides(optionsSchema) {
  return schemaFields(optionsSchema).flatMap((field) =>
    field && typeof field === "object" && Array.isArray(field[COMBINATION_OVERRIDES_KEY])
      ? field[COMBINATION_OVERRIDES_KEY]
      : []
  );
}

function hasCombinationOverridesProperty(optionsSchema) {
  return schemaFields(optionsSchema).some(
    (field) => field && typeof field === "object" && Array.isArray(field[COMBINATION_OVERRIDES_KEY])
  );
}

/**
 * Pune lista pe PRIMA variantă (o scoate de pe celelalte). Lista goală se
 * scrie explicit ([]) - înseamnă „vendorul a șters toate combinațiile”.
 */
function stripCombinationOverrides(optionsSchema) {
  return optionsSchema.map((field) => {
    if (!field || typeof field !== "object" || !(COMBINATION_OVERRIDES_KEY in field)) return field;
    const rest = { ...field };
    delete rest[COMBINATION_OVERRIDES_KEY];
    return rest;
  });
}

export function setCombinationOverrides(optionsSchema, overrides) {
  if (!Array.isArray(optionsSchema)) return optionsSchema;
  const stripped = stripCombinationOverrides(optionsSchema);
  if (!stripped.length) return stripped;
  return [{ ...stripped[0], [COMBINATION_OVERRIDES_KEY]: Array.isArray(overrides) ? overrides : [] }, ...stripped.slice(1)];
}

/**
 * Păstrează combinațiile când schema nouă NU le conține deloc (ex. un
 * flux care rescrie variantele fără să știe de ele, sau eliminarea primei
 * variante în editor). Dacă proprietatea apare explicit (chiar []), are
 * prioritate. Combinațiile devenite invalide sunt semnalate la salvare.
 */
export function carryCombinationOverrides(nextSchema, prevSchema) {
  if (!Array.isArray(nextSchema) || !nextSchema.length) return nextSchema;
  if (hasCombinationOverridesProperty(nextSchema)) return nextSchema;
  const previous = rawCombinationOverrides(prevSchema);
  return previous.length ? setCombinationOverrides(nextSchema, previous) : nextSchema;
}

function choiceLabel(field, value) {
  return field?.choices.find((c) => c.value === value)?.label || value;
}

// „3 petale + Roșu” - în ordinea variantelor din produs, nu a cheilor
export function describeCombination(product, selections) {
  const fields = variantFields(product);
  const order = new Map(fields.map((f, i) => [f.key, i]));
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const parts = Object.entries(plainObject(selections))
    .map(([key, value]) => [clean(key), clean(value)])
    .filter(([key, value]) => key && value)
    .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
    .map(([key, value]) => choiceLabel(byKey.get(key), value));
  return parts.length ? parts.join(" + ") : "fără variante";
}

/**
 * Validează prețurile pe combinații ale produsului.
 * @returns {{ overrides: Array<{ key, selections, priceCents }>,
 *             errors: Array<{ index, code, message }> }}
 * code: EMPTY | REPEATED_FIELD | UNKNOWN_FIELD | UNKNOWN_VALUE |
 *       MISSING_FIELD | INVALID_PRICE | DUPLICATE
 * Doar intrările valide ajung în `overrides` (folosite la calcul).
 */
export function checkCombinationOverrides(product) {
  const topFields = variantFields(product).filter((field) => !field.repeated);
  const byKey = new Map(topFields.map((field) => [field.key, field]));
  const allFields = new Map(variantFields(product).map((field) => [field.key, field]));
  const seen = new Map();
  const overrides = [];
  const errors = [];

  rawCombinationOverrides(product?.optionsSchema).forEach((raw, index) => {
    const n = index + 1;
    const entries = Object.entries(plainObject(raw?.selections))
      .map(([key, value]) => [clean(key), clean(value)])
      .filter(([key, value]) => key && value);
    const fail = (code, message) => errors.push({ index, code, message });

    if (!entries.length) return fail("EMPTY", `Combinația ${n} nu are nicio variantă aleasă.`);

    let valid = true;
    const selections = {};
    for (const [key, value] of entries) {
      const field = byKey.get(key);
      if (!field) {
        valid = false;
        fail(
          allFields.get(key) ? "REPEATED_FIELD" : "UNKNOWN_FIELD",
          allFields.get(key)
            ? `Combinația ${n}: „${allFields.get(key).label}” se alege pentru fiecare membru și nu poate avea preț special.`
            : `Combinația ${n}: varianta „${key}” nu mai există.`
        );
        continue;
      }
      if (!field.choices.some((c) => c.value === value)) {
        valid = false;
        fail("UNKNOWN_VALUE", `Combinația ${n}: valoarea „${value}” pentru „${field.label}” nu mai există.`);
        continue;
      }
      selections[key] = value;
    }

    for (const field of topFields) {
      if (field.required && !selections[field.key] && !entries.some(([key]) => key === field.key)) {
        valid = false;
        fail("MISSING_FIELD", `Combinația ${n}: alege și „${field.label}”.`);
      }
    }

    const priceCents = Number(raw?.priceCents);
    if (!Number.isInteger(priceCents) || priceCents <= 0 || priceCents > MAX_COMBINATION_PRICE_CENTS) {
      valid = false;
      fail("INVALID_PRICE", `Combinația ${describeCombination(product, selections)}: prețul special trebuie să fie o sumă pozitivă.`);
    }

    if (!valid) return;

    const key = combinationKey(selections);
    if (seen.has(key)) {
      return fail("DUPLICATE", `Combinația ${describeCombination(product, selections)} apare de două ori.`);
    }
    seen.set(key, true);
    overrides.push({ key, selections: JSON.parse(key), priceCents });
  });

  return { overrides, errors };
}

function normalizeCombinationOverrides(optionsSchema, { repeatedGroups = [] } = {}) {
  if (!hasCombinationOverridesProperty(optionsSchema)) return { optionsSchema };

  const { overrides, errors } = checkCombinationOverrides({ optionsSchema, repeatedGroups });
  if (errors.length) {
    return {
      error: "invalid_combination_price",
      message: `Prețuri pe combinații: ${errors[0].message}${errors.length > 1 ? ` (și încă ${errors.length - 1})` : ""}`,
      errors: errors.map((e) => e.message),
    };
  }

  const list = overrides.map(({ selections, priceCents }) => ({ selections, priceCents }));
  // listă goală -> fără proprietate (produsul revine la calculul din etapa 1)
  return {
    optionsSchema: list.length
      ? setCombinationOverrides(optionsSchema, list)
      : stripCombinationOverrides(optionsSchema),
  };
}

/* ---------------- variantele produsului ---------------- */

function repeatedGroupsOf(product) {
  return (Array.isArray(product?.repeatedGroups) ? product.repeatedGroups : []).filter(
    (group) => group && typeof group === "object"
  );
}

function repeatedFieldKeys(product) {
  const keys = new Set();
  for (const group of repeatedGroupsOf(product)) {
    for (const field of Array.isArray(group.fields) ? group.fields : []) {
      if (field?.key) keys.add(String(field.key));
    }
  }
  return keys;
}

/**
 * Variantele produsului, cu valorile disponibile (fără cele dezactivate).
 * Câmpurile fără nicio valoare sunt ignorate (clientul nu le poate alege).
 */
export function variantFields(product) {
  const repeated = repeatedFieldKeys(product);

  return schemaFields(product?.optionsSchema)
    .map((field) => {
      const key = clean(field?.key);
      if (!key || UNSAFE_KEYS.has(key)) return null;

      const raw = Array.isArray(field?.options) ? field.options : Array.isArray(field?.values) ? field.values : [];
      const choices = raw
        .filter((option) => !(option && typeof option === "object" && option.disabled))
        .map((option) => {
          const value = optionChoiceValue(option);
          if (!value) return null;
          return {
            value,
            label: optionChoiceLabel(option) || value,
            priceDeltaCents: optionPriceDeltaCents(option),
          };
        })
        .filter(Boolean);

      if (!choices.length) return null;

      return {
        key,
        label: clean(field?.label) || key,
        required: field?.required !== false,
        repeated: repeated.has(key),
        choices,
      };
    })
    .filter(Boolean);
}

/** Produsul are cel puțin o valoare cu diferență de preț (pentru „De la X”). */
export function hasVariantPriceDeltas(product) {
  return variantFields(product).some(
    (field) => !field.repeated && field.choices.some((choice) => choice.priceDeltaCents > 0)
  );
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// peste atâtea combinații posibile nu le mai calculăm pe toate (vezi mai jos)
export const MAX_PRICE_RANGE_COMBINATIONS = 2000;

/**
 * Intervalul REAL de preț pe bucată pe care clientul îl poate obține,
 * pornind de la variantele deja alese (pentru „De la X”). Fiecare
 * candidat e calculat cu resolveVariantPricing - aceeași regulă ca în coș /
 * checkout (preț special pe combinație > bază + diferențe), deci minimul
 * poate fi și un preț special sub prețul de bază.
 *
 * Variantele nealese (sau cu valori inexistente) se completează cu toate
 * valorile posibile; cele opționale pot rămâne și nealese. Peste
 * MAX_PRICE_RANGE_COMBINATIONS se calculează doar candidații relevanți
 * (cea mai ieftină / cea mai scumpă alegere + fiecare combinație specială
 * compatibilă) - `exhaustive: false`; prețurile rămân prețuri reale.
 *
 * @returns {{ minCents: number, maxCents: number, exhaustive: boolean, complete: boolean }}
 *   complete = nu mai e nicio variantă de ales
 */
export function variantPriceRange(product, rawSelected = {}) {
  const topFields = variantFields(product).filter((field) => !field.repeated);
  const input = plainObject(rawSelected);

  const fixed = {};
  const free = [];
  for (const field of topFields) {
    const value = clean(input[field.key]);
    if (value && field.choices.some((c) => c.value === value)) fixed[field.key] = value;
    else free.push(field);
  }

  const candidates = [];
  const price = (selection) => {
    const result = resolveVariantPricing(product, selection);
    if (result.ok) candidates.push(result.unitPriceCents);
  };

  const domains = free.map((field) => [
    ...(field.required ? [] : [""]),
    ...field.choices.map((c) => c.value),
  ]);
  const total = domains.reduce((n, domain) => n * domain.length, 1);
  const exhaustive = total <= MAX_PRICE_RANGE_COMBINATIONS;

  if (exhaustive) {
    const walk = (index, selection) => {
      if (index === free.length) return price(selection);
      for (const value of domains[index]) {
        walk(index + 1, value ? { ...selection, [free[index].key]: value } : selection);
      }
    };
    walk(0, fixed);
  } else {
    const pick = (cmp) => {
      const selection = { ...fixed };
      for (const field of free) {
        const best = field.choices.reduce((a, b) => (cmp(b.priceDeltaCents, a.priceDeltaCents) ? b : a));
        // opțional: nealeasă = diferență 0 (cea mai ieftină)
        if (field.required || cmp(best.priceDeltaCents, 0)) selection[field.key] = best.value;
      }
      return selection;
    };
    price(pick((a, b) => a < b));
    price(pick((a, b) => a > b));
    for (const override of checkCombinationOverrides(product).overrides) {
      const compatible = Object.entries(fixed).every(([key, value]) => override.selections[key] === value);
      if (compatible) price({ ...fixed, ...override.selections });
    }
  }

  // fără nicio combinație validă (nu ar trebui) -> calculul pentru selecția curentă
  if (!candidates.length) candidates.push(resolveVariantPricing(product, input).unitPriceCents);

  return {
    minCents: Math.min(...candidates),
    maxCents: Math.max(...candidates),
    exhaustive,
    complete: free.length === 0,
  };
}

/**
 * Validează variantele alese și calculează prețul.
 *
 * @param {Object} product - cu priceCents, optionsSchema, repeatedGroups
 * @param {Object} rawSelected - selectedOptions primite (de la client / din coș)
 * @param {{ repeatedGroupAnswers?: Object, qty?: number }} [opts]
 * @returns {{
 *   ok: boolean,
 *   errors: Array<{key:string, message:string}>,
 *   message: string|null,
 *   selectedOptions: Object,          // formă canonică (doar variante valide)
 *   options: Array<{key, label, value, valueLabel, priceDeltaCents}>,
 *   basePriceCents: number,
 *   variantDeltaCents: number,
 *   combinationOverrideCents: number|null, // prețul special al combinației, dacă există
 *   pricingSource: "BASE"|"VARIANT_DELTAS"|"COMBINATION_OVERRIDE",
 *   unitPriceCents: number,
 *   lineTotalCents: number|null,
 * }}
 */
export function resolveVariantPricing(product, rawSelected = {}, { repeatedGroupAnswers = {}, qty = null } = {}) {
  const fields = variantFields(product);
  const topFields = fields.filter((field) => !field.repeated);
  const byKey = new Map(topFields.map((field) => [field.key, field]));
  const input = plainObject(rawSelected);

  const errors = [];
  const selectedOptions = {};
  const options = [];
  let variantDeltaCents = 0;

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = clean(rawKey);
    const value = clean(rawValue);
    if (!key || !value) continue; // gol = nealeasă (verificat mai jos, dacă e obligatorie)
    if (!byKey.has(key)) {
      errors.push({ key, message: `Opțiunea „${key}” nu există pentru acest produs.` });
    }
  }

  for (const field of topFields) {
    const value = clean(input[field.key]);

    if (!value) {
      if (field.required) errors.push({ key: field.key, message: `Alege ${field.label}.` });
      continue;
    }

    const choice = field.choices.find((c) => c.value === value);
    if (!choice) {
      errors.push({ key: field.key, message: `Valoarea aleasă pentru „${field.label}” nu este disponibilă.` });
      continue;
    }

    selectedOptions[field.key] = choice.value;
    options.push({
      key: field.key,
      label: field.label,
      value: choice.value,
      valueLabel: choice.label,
      priceDeltaCents: choice.priceDeltaCents,
    });
    variantDeltaCents += choice.priceDeltaCents;
  }

  // variante alese per membru (grup repetat): doar valori existente, fără preț
  const repeatedFields = new Map(fields.filter((f) => f.repeated).map((f) => [f.key, f]));
  if (repeatedFields.size) {
    const answers = plainObject(repeatedGroupAnswers);
    for (const group of repeatedGroupsOf(product)) {
      const groupKey = clean(group.key || group.id);
      const members = Array.isArray(answers[groupKey]) ? answers[groupKey] : [];
      const groupFieldKeys = (Array.isArray(group.fields) ? group.fields : []).map((f) => clean(f?.key));

      members.forEach((member, index) => {
        const row = plainObject(member);
        for (const fieldKey of groupFieldKeys) {
          const field = repeatedFields.get(fieldKey);
          if (!field) continue; // câmp de personalizare (text etc.), nu variantă
          const value = clean(row[fieldKey]);
          if (!value) {
            if (field.required) errors.push({ key: `${groupKey}.${index}.${fieldKey}`, message: `Alege ${field.label} (persoana ${index + 1}).` });
            continue;
          }
          if (!field.choices.some((c) => c.value === value)) {
            errors.push({
              key: `${groupKey}.${index}.${fieldKey}`,
              message: `Valoarea aleasă pentru „${field.label}” (persoana ${index + 1}) nu este disponibilă.`,
            });
          }
        }
      });
    }
  }

  const basePriceCents = Math.max(0, Math.round(Number(product?.priceCents) || 0));

  // etapa 2: prețul special al combinației EXACTE alese (preț final pe bucată)
  const selectionKey = combinationKey(selectedOptions);
  const override = Object.keys(selectedOptions).length
    ? checkCombinationOverrides(product).overrides.find((o) => o.key === selectionKey) || null
    : null;

  const unitPriceCents = override ? override.priceCents : basePriceCents + variantDeltaCents;
  const pricingSource = override
    ? PRICING_SOURCES.COMBINATION_OVERRIDE
    : variantDeltaCents > 0
      ? PRICING_SOURCES.VARIANT_DELTAS
      : PRICING_SOURCES.BASE;
  const safeQty = Number.isInteger(qty) && qty > 0 ? qty : null;

  return {
    ok: errors.length === 0,
    errors,
    message: errors.length ? errors[0].message : null,
    selectedOptions,
    options,
    basePriceCents,
    variantDeltaCents,
    combinationOverrideCents: override ? override.priceCents : null,
    pricingSource,
    unitPriceCents,
    lineTotalCents: safeQty ? unitPriceCents * safeQty : null,
  };
}
