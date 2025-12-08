// shared/ui/categoriesUi.js
// Wrapper pentru constantele de categorii, ca să fie ușor de folosit în UI.

import {
  CATEGORIES_DETAILED,
  CATEGORY_LABELS,
  CATEGORY_GROUP_LABELS,
} from "../categories.js"; // ↩️ ajustează calea
import { humanizeSlug } from "./slugUtils.js";

export const CATEGORY_LABEL_MAP = {
  ...CATEGORY_LABELS,
};

export const CATEGORY_GROUP_LABEL_MAP = {
  ...CATEGORY_GROUP_LABELS,
};

// Opțiuni gata de folosit în dropdown-uri, filtre etc.
export const CATEGORY_OPTIONS = CATEGORIES_DETAILED;

/**
 * Returnează label-ul frumos pentru o categorie.
 * Fallback: slug humanizat (fără prefix).
 */
export function getCategoryLabel(key) {
  if (!key) return "";
  if (CATEGORY_LABEL_MAP[key]) return CATEGORY_LABEL_MAP[key];
  return humanizeSlug(key, { dropPrefix: true });
}

/**
 * Returnează label-ul pentru grup (decor, papetarie, cadouri etc.).
 */
export function getCategoryGroupLabel(key) {
  if (!key) return "";
  const groupKey = key.split("_")[0] || "alte";
  if (CATEGORY_GROUP_LABEL_MAP[groupKey]) {
    return CATEGORY_GROUP_LABEL_MAP[groupKey];
  }
  return humanizeSlug(groupKey);
}
