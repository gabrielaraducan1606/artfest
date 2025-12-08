// backend/constants/occasionTags.js
// Tag-uri de ocazii pentru Product.occasionTags (comma-separated în UI)

export const OCCASION_TAGS = [
  "birthday",
  "name_day",
  "new_home",
  "wedding",
  "engagement",
  "baby_shower",
  "baptism",
  "anniversary",
  "valentines_day",
  "mothers_day",
  "fathers_day",
  "christmas",
  "easter",
  "winter_holidays",
  "corporate",
  "thank_you",
  "get_well",
  "sympathy",
  "everyday_decor",
  "self_care",
];

export const OCCASION_LABELS = {
  birthday: "Zi de naștere",
  name_day: "Onomastică",
  new_home: "Casă nouă",
  wedding: "Nuntă",
  engagement: "Logodnă",
  baby_shower: "Baby shower",
  baptism: "Botez",
  anniversary: "Aniversare",
  valentines_day: "Valentine's / Dragobete",
  mothers_day: "Ziua mamei",
  fathers_day: "Ziua tatălui",
  christmas: "Crăciun",
  easter: "Paște",
  winter_holidays: "Sărbători de iarnă",
  corporate: "Corporate / business",
  thank_you: "Mulțumesc",
  get_well: "Insănătoșire grabnică",
  sympathy: "Condoleanțe / simpatie",
  everyday_decor: "Decor de zi cu zi",
  self_care: "Răsfăț personal / self-care",
};

export const OCCASION_GROUP_LABELS = {
  personal: "Evenimente personale",
  seasonal: "Sărbători & sezon",
  relationships: "Relații & mesaje",
  decor: "Decor & uz zilnic",
};

const GROUP_BY_OCCASION = {
  birthday: "personal",
  name_day: "personal",
  new_home: "personal",
  wedding: "personal",
  engagement: "personal",
  baby_shower: "personal",
  baptism: "personal",
  anniversary: "personal",

  valentines_day: "seasonal",
  christmas: "seasonal",
  easter: "seasonal",
  winter_holidays: "seasonal",
  mothers_day: "seasonal",
  fathers_day: "seasonal",

  corporate: "relationships",
  thank_you: "relationships",
  get_well: "relationships",
  sympathy: "relationships",

  everyday_decor: "decor",
  self_care: "decor",
};

export const OCCASION_TAGS_DETAILED = OCCASION_TAGS.map((key) => {
  const group = GROUP_BY_OCCASION[key] || "personal";
  return {
    key,
    label: OCCASION_LABELS[key] || key,
    group,
    groupLabel: OCCASION_GROUP_LABELS[group] || "Ocazii",
  };
});

export const OCCASION_TAG_SET = new Set(OCCASION_TAGS);
