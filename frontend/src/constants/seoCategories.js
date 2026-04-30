import { CATEGORY_LABELS } from "./productscategories.js";

function slugify(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ă/g, "a")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/ș/g, "s")
    .replace(/ş/g, "s")
    .replace(/ț/g, "t")
    .replace(/ţ/g, "t")
    .toLowerCase()
    .replace(/&/g, "si")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const SEO_CATEGORY_OVERRIDES = {
  "decor_flori-sapun": {
    slug: "flori-din-sapun",
    title: "Flori din săpun handmade",
    description:
      "Descoperă flori din săpun handmade, potrivite pentru cadouri, aniversări, botezuri, nunți și ocazii speciale.",
    h1: "Flori din săpun handmade",
    intro:
      "Alege flori din săpun realizate manual, ideale pentru cadouri elegante, decoruri speciale și momente memorabile.",
  },

  "decor_aranjamente-sapun": {
    slug: "aranjamente-din-sapun",
    title: "Aranjamente din săpun handmade",
    description:
      "Aranjamente din săpun handmade, perfecte pentru cadouri elegante, evenimente și ocazii speciale.",
    h1: "Aranjamente din săpun",
    intro:
      "Descoperă aranjamente din săpun create de artizani, potrivite pentru cadouri, decor și evenimente.",
  },

  "decor_flori-ceara": {
    slug: "flori-din-ceara",
    title: "Flori din ceară handmade",
    description:
      "Flori din ceară handmade pentru cadouri, decoruri și evenimente speciale, disponibile pe Artfest.",
    h1: "Flori din ceară handmade",
    intro:
      "Explorează flori din ceară realizate manual, potrivite pentru cadouri creative și decoruri elegante.",
  },

  "decor_aranjamente-ceara": {
    slug: "aranjamente-din-ceara",
    title: "Aranjamente din ceară handmade",
    description:
      "Aranjamente din ceară handmade pentru cadouri, decoruri și ocazii speciale.",
    h1: "Aranjamente din ceară",
    intro:
      "Alege aranjamente din ceară realizate manual, ideale pentru evenimente, cadouri și decoruri speciale.",
  },

  "decor_flori-plusate": {
    slug: "flori-plusate",
    title: "Flori plușate handmade",
    description:
      "Flori plușate handmade, cadouri originale și speciale pentru aniversări, surprize și ocazii memorabile.",
    h1: "Flori plușate",
    intro:
      "Descoperă flori plușate speciale, potrivite pentru cadouri originale și momente cu adevărat memorabile.",
  },

  "decor_aranjamente-flori-plusate": {
    slug: "aranjamente-flori-plusate",
    title: "Aranjamente flori plușate",
    description:
      "Aranjamente cu flori plușate, create pentru cadouri speciale, aniversări și surprize deosebite.",
    h1: "Aranjamente flori plușate",
    intro:
      "Găsește aranjamente cu flori plușate, perfecte pentru cadouri originale și surprize cu impact.",
  },

  "cadouri_botez": {
    slug: "cadouri-botez",
    title: "Cadouri botez handmade",
    description:
      "Cadouri de botez handmade, personalizate sau create de artizani, disponibile pe Artfest.",
    h1: "Cadouri botez",
    intro:
      "Alege cadouri de botez speciale, realizate manual sau personalizate, potrivite pentru momente unice.",
  },

  "cadouri_pentru-nasi": {
    slug: "cadouri-pentru-nasi",
    title: "Cadouri pentru nași",
    description:
      "Cadouri pentru nași, handmade sau personalizate, potrivite pentru nuntă, botez și ocazii speciale.",
    h1: "Cadouri pentru nași",
    intro:
      "Descoperă cadouri speciale pentru nași, create de artizani și potrivite pentru evenimente importante.",
  },

  "textile_halate-personalizate": {
    slug: "halate-personalizate",
    title: "Halate personalizate",
    description:
      "Halate personalizate pentru evenimente, cadouri, mirese, nașe sau ocazii speciale.",
    h1: "Halate personalizate",
    intro:
      "Alege halate personalizate pentru evenimente, cadouri speciale sau momente de pregătire memorabile.",
  },

  "textile_prosoape-personalizate": {
    slug: "prosoape-personalizate",
    title: "Prosoape personalizate",
    description:
      "Prosoape personalizate pentru cadouri, botezuri, nunți sau uz personal, disponibile pe Artfest.",
    h1: "Prosoape personalizate",
    intro:
      "Găsește prosoape personalizate potrivite pentru cadouri, evenimente și ocazii speciale.",
  },

  "ceremonie_tavita-mot": {
    slug: "tavita-mot",
    title: "Tăviță moț",
    description:
      "Tăvițe pentru moț și accesorii pentru ceremonia de tăiere a moțului, create de artizani pe Artfest.",
    h1: "Tăviță moț",
    intro:
      "Descoperă tăvițe pentru moț și accesorii speciale pentru unul dintre cele mai importante momente din familie.",
  },
};

export function buildSeoCategory(key, label) {
  const override = SEO_CATEGORY_OVERRIDES[key];

  if (override) {
    return {
      key,
      label,
      ...override,
    };
  }

  return {
    key,
    label,
    slug: slugify(label),
    title: `${label} handmade`,
    description: `Descoperă ${label.toLowerCase()} create de artizani români pe Artfest, potrivite pentru cadouri, evenimente și ocazii speciale.`,
    h1: label,
    intro: `Explorează ${label.toLowerCase()} realizate de artizani, ideale pentru cadouri, evenimente și momente speciale.`,
  };
}

export const SEO_CATEGORIES = Object.fromEntries(
  Object.entries(CATEGORY_LABELS).map(([key, label]) => [
    key,
    buildSeoCategory(key, label),
  ])
);

export const SEO_CATEGORIES_BY_SLUG = Object.fromEntries(
  Object.values(SEO_CATEGORIES).map((item) => [item.slug, item])
);

export function getCategoryBySlug(slug) {
  return SEO_CATEGORIES_BY_SLUG[slug] || null;
}

export function getSlugByCategoryKey(key) {
  return SEO_CATEGORIES[key]?.slug || null;
}

export function getAllSeoCategories() {
  return Object.values(SEO_CATEGORIES);
}