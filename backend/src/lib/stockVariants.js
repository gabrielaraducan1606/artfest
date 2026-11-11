// backend/src/lib/stockVariants.js
//
// Variantele de STOC ale unui produs (ProductVariant): combinația valorilor
// alese pentru opțiunile marcate `stockAxis: true` în optionsSchema.
//
// Doar opțiunile de stoc intră în cheie. Celelalte opțiuni (ex. ambalaj
// cadou) și personalizările clientului (customAnswers, repeatedGroups -
// nume, mesaj, fotografie, instrucțiuni) NU creează variante și nu au stoc.
// Câmpurile din grupuri repetate nu pot fi axe de stoc.
//
// Cheia = combinationKey() din variantPricing.js (aceeași normalizare ca
// prețurile pe combinații): trim, fără valori goale, chei sortate.
//
// Pur, fără dependențe (nici Prisma, nici React).

import { combinationKey, optionChoiceValue } from "./variantPricing.js";

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function schemaFields(schema) {
  if (Array.isArray(schema)) return schema;
  if (Array.isArray(schema?.fields)) return schema.fields;
  return [];
}

function repeatedFieldKeys(product) {
  const keys = new Set();
  for (const group of Array.isArray(product?.repeatedGroups) ? product.repeatedGroups : []) {
    for (const field of Array.isArray(group?.fields) ? group.fields : []) {
      if (field?.key) keys.add(String(field.key).trim());
    }
  }
  return keys;
}

/** Cheile opțiunilor de stoc, în ordinea din optionsSchema. */
export function stockAxisKeys(product) {
  const repeated = repeatedFieldKeys(product);
  const keys = [];
  for (const field of schemaFields(product?.optionsSchema)) {
    const key = String(field?.key ?? "").trim();
    if (!key || UNSAFE_KEYS.has(key) || repeated.has(key)) continue;
    if (field?.stockAxis === true && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * Varianta de stoc aleasă de client.
 * @returns {{ combinationKey: string, selections: Record<string,string> } | null}
 *   null = produsul nu are opțiuni de stoc sau lipsește o valoare de stoc
 */
export function stockVariantSelection(product, selectedOptions = {}) {
  const axes = stockAxisKeys(product);
  if (!axes.length) return null;

  const source = selectedOptions && typeof selectedOptions === "object" && !Array.isArray(selectedOptions) ? selectedOptions : {};
  const selections = {};
  for (const key of axes) {
    // valoare simplă sau obiect { value, label } - aceeași regulă ca prețurile
    const value = optionChoiceValue(source[key]);
    if (!value) return null;
    selections[key] = value;
  }

  return { combinationKey: combinationKey(selections), selections };
}
