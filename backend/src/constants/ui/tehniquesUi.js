// shared/ui/techniquesUi.js
// Tehnici – pentru Product.technique.

import {
  TECHNIQUES_DETAILED,
  TECHNIQUE_LABELS,
  TECHNIQUE_GROUP_LABELS,
} from "../techniques.js"; // ↩️ ajustează calea
import { humanizeSlug } from "./slugUtils.js";

export const TECHNIQUE_LABEL_MAP = {
  ...TECHNIQUE_LABELS,
};

export const TECHNIQUE_GROUP_LABEL_MAP = {
  ...TECHNIQUE_GROUP_LABELS,
};

export const TECHNIQUE_OPTIONS = TECHNIQUES_DETAILED;

/**
 * Label pentru o tehnică.
 */
export function getTechniqueLabel(key) {
  if (!key) return "";
  if (TECHNIQUE_LABEL_MAP[key]) return TECHNIQUE_LABEL_MAP[key];
  return humanizeSlug(key);
}

/**
 * Label pentru grup de tehnică.
 */
export function getTechniqueGroupLabel(groupKey) {
  if (!groupKey) return "";
  if (TECHNIQUE_GROUP_LABEL_MAP[groupKey]) {
    return TECHNIQUE_GROUP_LABEL_MAP[groupKey];
  }
  return humanizeSlug(groupKey);
}
