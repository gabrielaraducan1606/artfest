// backend/constants/stylesTags.js
// Tag-uri de stil pentru Product.styleTags (comma-separated în UI)

export const STYLE_TAGS = [
  "rustic",
  "boho",
  "minimalist",
  "modern",
  "vintage",
  "romantic",
  "industrial",
  "scandi",
  "farmhouse",
  "glam",
  "playful",
  "kids",
  "nature",
  "botanical",
  "abstract",
  "colorful",
  "monochrome",
  "festive",
  "wabi_sabi",
];

export const STYLE_TAG_LABELS = {
  rustic: "Rustic",
  boho: "Boho",
  minimalist: "Minimalist",
  modern: "Modern",
  vintage: "Vintage",
  romantic: "Romantic",
  industrial: "Industrial",
  scandi: "Scandi / nordic",
  farmhouse: "Farmhouse",
  glam: "Glam / elegant",
  playful: "Jucăuș",
  kids: "Pentru copii",
  nature: "Inspirat de natură",
  botanical: "Botanic / floral",
  abstract: "Abstract",
  colorful: "Colorat",
  monochrome: "Monocrom",
  festive: "Festiv",
  wabi_sabi: "Wabi-sabi",
};

export const STYLE_TAG_GROUP_LABELS = {
  core: "Stiluri de bază",
  mood: "Stare & atmosferă",
  audience: "Public țintă",
  theme: "Tematic",
};

const GROUP_BY_STYLE_TAG = {
  rustic: "core",
  boho: "core",
  minimalist: "core",
  modern: "core",
  vintage: "core",
  romantic: "mood",
  glam: "mood",
  festive: "mood",
  wabi_sabi: "mood",
  industrial: "theme",
  scandi: "theme",
  farmhouse: "theme",
  nature: "theme",
  botanical: "theme",
  abstract: "theme",
  colorful: "theme",
  monochrome: "theme",
  playful: "audience",
  kids: "audience",
};

export const STYLE_TAGS_DETAILED = STYLE_TAGS.map((key) => {
  const group = GROUP_BY_STYLE_TAG[key] || "core";
  return {
    key,
    label: STYLE_TAG_LABELS[key] || key,
    group,
    groupLabel: STYLE_TAG_GROUP_LABELS[group] || "Stiluri",
  };
});

export const STYLE_TAG_SET = new Set(STYLE_TAGS);
