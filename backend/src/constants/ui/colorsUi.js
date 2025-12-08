// shared/ui/colorsUi.js
// Wrapper pentru culori: map slug -> label frumos, plus opțiuni detaliate.

import {
  COLORS_DETAILED,
  COLOR_LABELS,
  COLOR_GROUP_LABELS,
} from "../colors.js"; // ↩️ ajustează calea
import { humanizeSlug } from "./slugUtils.js";

export const COLOR_LABEL_MAP = {
  ...COLOR_LABELS,
};

export const COLOR_GROUP_LABEL_MAP = {
  ...COLOR_GROUP_LABELS,
};

export const COLOR_OPTIONS = COLORS_DETAILED;

/**
 * Label pentru o culoare (ex: "pink_dusty" -> "Roz pudră").
 */
export function getColorLabel(key) {
  if (!key) return "";
  if (COLOR_LABEL_MAP[key]) return COLOR_LABEL_MAP[key];
  return humanizeSlug(key);
}

/**
 * Label pentru grup de culoare (ex: "reds_pinks" -> "Roșu & roz").
 */
export function getColorGroupLabel(groupKey) {
  if (!groupKey) return "";
  if (COLOR_GROUP_LABEL_MAP[groupKey]) {
    return COLOR_GROUP_LABEL_MAP[groupKey];
  }
  return humanizeSlug(groupKey);
}
