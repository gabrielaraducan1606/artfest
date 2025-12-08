// backend/constants/careInstructions.js
// Instrucțiuni de îngrijire pentru Product.careInstructions (text, dar sugerăm valori)

export const CARE_TAGS = [
  "dust_only",
  "wipe_damp",
  "keep_dry",
  "avoid_sun",
  "avoid_heat",
  "indoor_only",
  "outdoor_safe",
  "fragile_handle_care",
  "handwash_cold",
  "food_safe_handwash",
];

export const CARE_LABELS = {
  dust_only: "Curăță doar prin ștergere ușoară de praf",
  wipe_damp: "Șterge ușor cu o cârpă ușor umedă",
  keep_dry: "Păstrează în loc uscat, departe de umezeală",
  avoid_sun: "Evită expunerea directă la soare",
  avoid_heat: "Evită sursele directe de căldură / flacără",
  indoor_only: "Destinat utilizării la interior",
  outdoor_safe: "Potrivit și pentru exterior (ferit de intemperii extreme)",
  fragile_handle_care: "Fragil – manipulează cu grijă",
  handwash_cold: "Spală manual, în apă rece",
  food_safe_handwash: "Suprafață în contact cu alimentele – spală manual după utilizare",
};

export const CARE_GROUP_LABELS = {
  cleaning: "Curățare",
  environment: "Mediu & depozitare",
  safety: "Siguranță & fragilitate",
  textile: "Textile & spălare",
  food: "În contact cu alimentele",
};

const GROUP_BY_CARE = {
  dust_only: "cleaning",
  wipe_damp: "cleaning",

  keep_dry: "environment",
  avoid_sun: "environment",
  indoor_only: "environment",
  outdoor_safe: "environment",

  avoid_heat: "safety",
  fragile_handle_care: "safety",

  handwash_cold: "textile",

  food_safe_handwash: "food",
};

export const CARE_TAGS_DETAILED = CARE_TAGS.map((key) => {
  const group = GROUP_BY_CARE[key] || "cleaning";
  return {
    key,
    label: CARE_LABELS[key] || key,
    group,
    groupLabel: CARE_GROUP_LABELS[group] || "Îngrijire",
  };
});

export const CARE_TAG_SET = new Set(CARE_TAGS);
