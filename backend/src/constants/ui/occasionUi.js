// shared/ui/occasionUi.js
// Ocazii – tag-uri pentru Product.occasionTags.

import {
  OCCASION_TAGS_DETAILED,
  OCCASION_LABELS,
  OCCASION_GROUP_LABELS,
} from "../occasinsTags.js"; // ↩️ ajustează calea
import { humanizeSlug } from "./slugUtils.js";

export const OCCASION_LABEL_MAP = {
  ...OCCASION_LABELS,
};

export const OCCASION_GROUP_LABEL_MAP = {
  ...OCCASION_GROUP_LABELS,
};

export const OCCASION_OPTIONS = OCCASION_TAGS_DETAILED;

/**
 * Label pentru un tag de ocazie.
 */
export function getOccasionLabel(key) {
  if (!key) return "";
  if (OCCASION_LABEL_MAP[key]) return OCCASION_LABEL_MAP[key];
  return humanizeSlug(key);
}

/**
 * Label pentru grup de ocazie.
 */
export function getOccasionGroupLabel(groupKey) {
  if (!groupKey) return "";
  if (OCCASION_GROUP_LABEL_MAP[groupKey]) {
    return OCCASION_GROUP_LABEL_MAP[groupKey];
  }
  return humanizeSlug(groupKey);
}
