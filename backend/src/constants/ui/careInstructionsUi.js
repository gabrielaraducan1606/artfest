// shared/ui/careInstructionsUi.js
// Instrucțiuni de îngrijire – map pentru UI.

import {
  CARE_TAGS_DETAILED,
  CARE_LABELS,
  CARE_GROUP_LABELS,
} from "../careInstructions.js"; // ↩️ ajustează calea
import { humanizeSlug } from "./slugUtils.js";

export const CARE_LABEL_MAP = {
  ...CARE_LABELS,
};

export const CARE_GROUP_LABEL_MAP = {
  ...CARE_GROUP_LABELS,
};

export const CARE_OPTIONS = CARE_TAGS_DETAILED;

/**
 * Label pentru un tag de îngrijire.
 */
export function getCareLabel(key) {
  if (!key) return "";
  if (CARE_LABEL_MAP[key]) return CARE_LABEL_MAP[key];
  return humanizeSlug(key);
}

/**
 * Label pentru grup (curățare, mediu, etc.).
 */
export function getCareGroupLabel(groupKey) {
  if (!groupKey) return "";
  if (CARE_GROUP_LABEL_MAP[groupKey]) {
    return CARE_GROUP_LABEL_MAP[groupKey];
  }
  return humanizeSlug(groupKey);
}
