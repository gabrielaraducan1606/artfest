// shared/ui/materialsUi.js
// Materiale – mapuri + opțiuni pentru UI.

import {
  MATERIALS_DETAILED,
  MATERIAL_LABELS,
  MATERIAL_GROUP_LABELS,
} from "../materials.js"; // ↩️ ajustează calea
import { humanizeSlug } from "./slugUtils.js";

export const MATERIAL_LABEL_MAP = {
  ...MATERIAL_LABELS,
};

export const MATERIAL_GROUP_LABEL_MAP = {
  ...MATERIAL_GROUP_LABELS,
};

export const MATERIAL_OPTIONS = MATERIALS_DETAILED;

/**
 * Label pentru material principal.
 */
export function getMaterialLabel(key) {
  if (!key) return "";
  if (MATERIAL_LABEL_MAP[key]) return MATERIAL_LABEL_MAP[key];
  return humanizeSlug(key);
}

/**
 * Label pentru grup de material.
 */
export function getMaterialGroupLabel(groupKey) {
  if (!groupKey) return "";
  if (MATERIAL_GROUP_LABEL_MAP[groupKey]) {
    return MATERIAL_GROUP_LABEL_MAP[groupKey];
  }
  return humanizeSlug(groupKey);
}
