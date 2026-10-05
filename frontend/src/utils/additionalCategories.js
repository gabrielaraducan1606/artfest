// Categorii SUPLIMENTARE ale unui produs (discovery intern).
// Aceleași reguli ca backend-ul (backend/src/constants/categories.js ->
// normalizeAdditionalCategories): max 3, fără duplicate, niciodată egale cu
// categoria principală. Backend-ul rămâne sursa de adevăr; aici doar
// pregătim formularul / payload-ul.

export const MAX_ADDITIONAL_CATEGORIES = 3;

/**
 * Listă curată de chei: acceptă string-uri sau rânduri { category }.
 * Scoate valorile goale, duplicatele și categoria principală; păstrează
 * ordinea; taie la MAX_ADDITIONAL_CATEGORIES.
 */
export function normalizeAdditionalCategoryKeys(list, primaryCategory = "") {
  const primary = String(primaryCategory || "").trim();
  const seen = new Set();
  const out = [];

  for (const item of Array.isArray(list) ? list : []) {
    const key = String(
      typeof item === "string" ? item : item?.category || ""
    ).trim();

    if (!key || key === primary || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out.slice(0, MAX_ADDITIONAL_CATEGORIES);
}

/**
 * Fragment de payload pentru salvare. Trimitem `additionalCategories`
 * DOAR dacă formularul are lista (încărcată din produs sau editată) -
 * un draft vechi fără câmp nu trebuie să șteargă suplimentarele salvate
 * (backend: câmp lipsă = neschimbat).
 */
export function additionalCategoriesPayload(form, primaryCategory) {
  if (!Array.isArray(form?.additionalCategories)) return {};

  return {
    additionalCategories: normalizeAdditionalCategoryKeys(
      form.additionalCategories,
      primaryCategory
    ),
  };
}
