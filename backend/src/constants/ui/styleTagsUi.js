// shared/ui/styleTagsUi.js
// Style tags – pentru Product.styleTags.

import {
  STYLE_TAGS_DETAILED,
  STYLE_TAG_LABELS,
  STYLE_TAG_GROUP_LABELS,
} from "../stylesTags.js"; // ↩️ ajustează calea
import { humanizeSlug } from "./slugUtils.js";

export const STYLE_LABEL_MAP = {
  ...STYLE_TAG_LABELS,
};

export const STYLE_GROUP_LABEL_MAP = {
  ...STYLE_TAG_GROUP_LABELS,
};

export const STYLE_OPTIONS = STYLE_TAGS_DETAILED;

/**
 * Label pentru un style tag.
 */
export function getStyleLabel(key) {
  if (!key) return "";
  if (STYLE_LABEL_MAP[key]) return STYLE_LABEL_MAP[key];
  return humanizeSlug(key);
}

/**
 * Label pentru grup de stil.
 */
export function getStyleGroupLabel(groupKey) {
  if (!groupKey) return "";
  if (STYLE_GROUP_LABEL_MAP[groupKey]) {
    return STYLE_GROUP_LABEL_MAP[groupKey];
  }
  return humanizeSlug(groupKey);
}
