/*
 * Traducere vizuală pentru valorile brute de variantă/opțiune (culoare,
 * material etc.) stocate în schema produsului / selectedOptions - ex.
 * "grey_light", "wax_soy". NU modifică valoarea reală (folosită în
 * selectedOptions, configurationKey, payload) - doar ce vede clientul.
 *
 * Sursă canonică: reutilizăm dicționarele deja existente în
 * backend/src/constants/*.js (același pattern de import cross-folder
 * folosit deja de useProductEditorController.js / ProductEditModal.jsx),
 * ca să nu întreținem o a doua listă de culori/materiale care poate
 * ajunge din nou desincronizată.
 */
import { COLOR_LABELS } from "../../../backend/src/constants/colors.js";
import { MATERIAL_LABELS } from "../../../backend/src/constants/materials.js";

/*
 * Sinonime folosite istoric doar în frontend, fără corespondent exact
 * în convenția backend-ului (ex. backend are "blue_light", nu
 * "light_blue") - le păstrăm ca fallback secundar, sub constantele
 * canonice, ca să nu regresăm produse deja salvate cu aceste chei.
 */
const LEGACY_LOCAL_LABELS = {
  gray: "Gri",
  grey: "Gri",
  pink: "Roz",
  light_blue: "Albastru deschis",
  dark_blue: "Albastru închis",
  light_green: "Verde deschis",
};

const CANONICAL_LABEL_SOURCES = [
  COLOR_LABELS,
  MATERIAL_LABELS,
  LEGACY_LOCAL_LABELS,
];

function lookupCanonicalLabel(key) {
  for (const source of CANONICAL_LABEL_SOURCES) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) {
      return source[key];
    }
  }
  return null;
}

/*
 * Fallback determinist pentru slug-uri necunoscute în dicționarele
 * canonice - doar prima literă mare, restul neschimbat (ex.
 * "champagne_gold" -> "Champagne gold"). Nu se inventează o traducere.
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

/*
 * Rezolvă un label pentru o valoare brută, fără niciun context de
 * schemă - doar constante canonice + fallback determinist (pașii 3-4
 * din ordinea de rezolvare pentru afișare).
 */
export function humanizeOptionValue(raw) {
  if (raw === null || raw === undefined) return "";

  const value = String(raw).trim();
  if (!value) return "";

  const key = value.toLowerCase();
  const canonical = lookupCanonicalLabel(key);
  if (canonical) return canonical;

  return naiveHumanize(value);
}

/*
 * Normalizează O SINGURĂ intrare dintr-un field.options/values (string
 * sau { value, label, ... }) într-un { value, label, hadExplicitLabel }
 * consistent. Sursă unică pentru enumerarea opțiunilor unui câmp -
 * înlocuiește implementările aproape identice din
 * productPersonalizationFlow.js și productConfigurationValidator.js.
 */
export function normalizeOptionChoice(option) {
  if (typeof option === "string") {
    return {
      value: option,
      label: humanizeOptionValue(option),
      hadExplicitLabel: false,
    };
  }

  if (option && typeof option === "object") {
    const value = option.value ?? option.key ?? option.label ?? "";

    return {
      value: String(value),
      label: option.label
        ? String(option.label)
        : humanizeOptionValue(value),
      hadExplicitLabel: Boolean(option.label),
    };
  }

  return { value: "", label: "", hadExplicitLabel: false };
}

export function getFieldOptionValues(field) {
  if (Array.isArray(field?.options)) {
    return field.options;
  }

  if (Array.isArray(field?.values)) {
    return field.values;
  }

  return [];
}

/*
 * Rezolvă label-ul de afișat pentru o valoare deja aleasă (ex. dintr-un
 * selectedOptions vechi, care rămâne un simplu string), respectând
 * ordinea:
 *  1. valoarea e deja un obiect cu label explicit -> îl folosește;
 *  2. altfel, dacă avem schema câmpului (`field`) și găsim opțiunea
 *     după value, cu label explicit -> îl folosește;
 *  3. altfel, dacă valoarea e cunoscută în constantele canonice ->
 *     label-ul canonic;
 *  4. altfel, fallback determinist.
 *
 * Nu modifică și nu presupune nimic despre structura `selectedOptions`
 * - funcționează identic pe un string vechi sau pe un obiect nou.
 */
export function resolveOptionDisplayLabel(rawValue, field) {
  let value = rawValue;

  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (value.label) {
      return String(value.label);
    }

    value = value.value ?? value.key ?? "";
  }

  const stringValue =
    value === null || value === undefined ? "" : String(value);

  if (!stringValue) {
    return "";
  }

  const schemaValues = getFieldOptionValues(field);

  for (const rawOption of schemaValues) {
    if (!rawOption || typeof rawOption !== "object") {
      continue;
    }

    const optionValue = String(rawOption.value ?? rawOption.key ?? "");

    if (optionValue === stringValue && rawOption.label) {
      return String(rawOption.label);
    }
  }

  return humanizeOptionValue(stringValue);
}
