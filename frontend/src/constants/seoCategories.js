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

function lowerLabel(label = "") {
  return String(label || "").toLowerCase();
}

function defaultSeoText(label) {
  const l = lowerLabel(label);

  return `Pe Artfest găsești ${l} create de artizani români, potrivite pentru evenimente, cadouri și momente speciale. Produsele sunt realizate cu atenție la detalii și pot include opțiuni de personalizare în funcție de stilul dorit, tema evenimentului și preferințele tale. Explorează modele handmade, idei originale și creații locale pentru nunți, botezuri, aniversări sau surprize memorabile.`;
}

function defaultFaq(label) {
  const l = lowerLabel(label);

  return [
    {
      q: `Pot personaliza produsele din categoria ${label}?`,
      a: `Da, multe produse din categoria ${l} pot fi personalizate. Poți discuta direct cu artizanul pentru culori, text, materiale, dimensiuni sau detalii speciale.`,
    },
    {
      q: `Cum aleg produsul potrivit din categoria ${label}?`,
      a: `Alege produsul în funcție de stilul evenimentului, buget, termenul de execuție și posibilitățile de personalizare oferite de creator.`,
    },
    {
      q: `Produsele sunt realizate de artizani români?`,
      a: `Da, Artfest reunește creatori, artizani și mici afaceri din România care realizează produse pentru evenimente, cadouri și momente speciale.`,
    },
  ];
}

function makeDefaultCategory(key, label) {
  return {
    key,
    label,
    slug: slugify(label),
    title: `${label} handmade și personalizate`,
    description: `Descoperă ${lowerLabel(
      label
    )} create de artizani români pe Artfest. Produse handmade, personalizabile și potrivite pentru evenimente, cadouri și ocazii speciale.`,
    h1: label,
    intro: `Explorează ${lowerLabel(
      label
    )} realizate de artizani români, ideale pentru cadouri, evenimente și momente speciale.`,
    seoTitle: `${label} create de artizani români`,
    seoText: defaultSeoText(label),
    faq: defaultFaq(label),
  };
}

export const SEO_CATEGORY_OVERRIDES = {
  invitatii_nunta: {
    slug: "invitatii-nunta",
    title: "Invitații nuntă personalizate handmade",
    description:
      "Descoperă invitații de nuntă personalizate, elegante și handmade create de artizani români pe Artfest. Modele moderne, florale, rustice sau premium.",
    h1: "Invitații nuntă personalizate",
    intro:
      "Alege invitații de nuntă personalizate, elegante și handmade, create de artizani români pentru un eveniment cu adevărat memorabil.",
    seoTitle: "Invitații nuntă personalizate create de artizani",
    seoText:
      "Pe Artfest găsești invitații de nuntă handmade și personalizate, create de artizani români pentru evenimente speciale. Poți descoperi modele elegante, moderne, rustice, florale sau minimaliste, potrivite pentru stilul nunții tale. Fie că îți dorești invitații tipărite, invitații digitale sau seturi coordonate pentru eveniment, poți discuta direct cu creatorii pentru personalizare completă, texte speciale, culori, grafică și detalii care se potrivesc poveștii voastre.",
    faq: [
      {
        q: "Pot personaliza invitațiile de nuntă?",
        a: "Da, multe invitații de nuntă de pe Artfest pot fi personalizate cu numele mirilor, data evenimentului, textul dorit, paleta de culori și stilul grafic al nunții.",
      },
      {
        q: "Găsesc invitații de nuntă handmade?",
        a: "Da, Artfest include invitații de nuntă realizate de creatori români, cu modele handmade, elegante, moderne, rustice sau florale.",
      },
      {
        q: "Pot discuta direct cu artizanul?",
        a: "Da, poți lua legătura cu creatorul pentru detalii despre personalizare, termen de execuție și opțiuni disponibile.",
      },
    ],
  },

  invitatii_botez: {
    slug: "invitatii-botez",
    title: "Invitații botez personalizate handmade",
    description:
      "Descoperă invitații de botez personalizate, delicate și handmade create de artizani români pe Artfest.",
    h1: "Invitații botez personalizate",
    intro:
      "Găsește invitații de botez personalizate, create cu grijă pentru un moment special din viața familiei.",
    seoTitle: "Invitații botez personalizate pentru evenimente speciale",
    seoText:
      "Pe Artfest găsești invitații de botez personalizate, realizate de artizani români pentru evenimente pline de emoție. Poți alege modele delicate, elegante, vesele sau tematice, potrivite pentru fetițe, băieței sau botezuri cu temă specială. Invitațiile pot fi adaptate cu numele copilului, data evenimentului, locația, textul dorit și elemente grafice care completează atmosfera botezului.",
    faq: defaultFaq("Invitații botez"),
  },

  cadouri_botez: {
    slug: "cadouri-botez",
    title: "Cadouri botez handmade și personalizate",
    description:
      "Cadouri de botez handmade, personalizate sau create de artizani români. Idei speciale pentru nași, părinți, invitați și copii.",
    h1: "Cadouri botez",
    intro:
      "Alege cadouri de botez speciale, realizate manual sau personalizate, potrivite pentru momente unice.",
    seoTitle: "Cadouri botez handmade pentru momente memorabile",
    seoText:
      "Pe Artfest descoperi cadouri de botez handmade și personalizate, potrivite pentru copii, părinți, nași sau invitați. Găsești idei originale create de artizani români, de la obiecte decorative și accesorii personalizate până la seturi speciale pentru ceremonia de botez. Alege produse cu semnificație, lucrate cu grijă, care pot deveni amintiri păstrate cu drag peste ani.",
    faq: defaultFaq("Cadouri botez"),
  },

  "cadouri_pentru-nasi": {
    slug: "cadouri-pentru-nasi",
    title: "Cadouri pentru nași handmade și personalizate",
    description:
      "Cadouri pentru nași, handmade sau personalizate, potrivite pentru nuntă, botez și ocazii speciale.",
    h1: "Cadouri pentru nași",
    intro:
      "Descoperă cadouri speciale pentru nași, create de artizani și potrivite pentru evenimente importante.",
    seoTitle: "Cadouri pentru nași create de artizani români",
    seoText:
      "Pe Artfest găsești cadouri pentru nași create de artizani români, potrivite pentru nuntă, botez sau alte momente importante. Alege produse personalizate, elegante sau simbolice, care transmit recunoștință și emoție.",
    faq: defaultFaq("Cadouri pentru nași"),
  },

  "decor_flori-sapun": {
    slug: "flori-din-sapun",
    title: "Flori din săpun handmade",
    description:
      "Descoperă flori din săpun handmade, potrivite pentru cadouri, aniversări, botezuri, nunți și ocazii speciale.",
    h1: "Flori din săpun handmade",
    intro:
      "Alege flori din săpun realizate manual, ideale pentru cadouri elegante, decoruri speciale și momente memorabile.",
    seoTitle: "Flori din săpun handmade pentru cadouri elegante",
    seoText:
      "Florile din săpun de pe Artfest sunt create manual de artizani români și pot fi o alegere elegantă pentru cadouri, aniversări, nunți, botezuri sau alte ocazii speciale. Aceste aranjamente combină aspectul delicat al florilor cu utilitatea și parfumul săpunului decorativ.",
    faq: defaultFaq("Flori din săpun"),
  },

  "decor_aranjamente-sapun": {
    slug: "aranjamente-din-sapun",
    title: "Aranjamente din săpun handmade",
    description:
      "Aranjamente din săpun handmade, perfecte pentru cadouri elegante, evenimente și ocazii speciale.",
    h1: "Aranjamente din săpun",
    intro:
      "Descoperă aranjamente din săpun create de artizani, potrivite pentru cadouri, decor și evenimente.",
    seoTitle: "Aranjamente din săpun pentru cadouri și evenimente",
    seoText:
      "Aranjamentele din săpun disponibile pe Artfest sunt realizate de artizani români și pot fi oferite drept cadouri elegante sau folosite ca decor pentru evenimente speciale. Poți alege aranjamente florale din săpun în diverse stiluri, culori și forme.",
    faq: defaultFaq("Aranjamente din săpun"),
  },

  "decor_flori-ceara": {
    slug: "flori-din-ceara",
    title: "Flori din ceară handmade",
    description:
      "Flori din ceară handmade pentru cadouri, decoruri și evenimente speciale, disponibile pe Artfest.",
    h1: "Flori din ceară handmade",
    intro:
      "Explorează flori din ceară realizate manual, potrivite pentru cadouri creative și decoruri elegante.",
    seoTitle: "Flori din ceară handmade pentru decor și cadouri",
    seoText:
      "Florile din ceară de pe Artfest sunt creații handmade realizate de artizani români, potrivite pentru decoruri elegante, cadouri speciale și evenimente memorabile. Alege modele delicate, culori armonioase și creații lucrate manual.",
    faq: defaultFaq("Flori din ceară"),
  },

  "decor_aranjamente-ceara": {
    slug: "aranjamente-din-ceara",
    title: "Aranjamente din ceară handmade",
    description:
      "Aranjamente din ceară handmade pentru cadouri, decoruri și ocazii speciale.",
    h1: "Aranjamente din ceară",
    intro:
      "Alege aranjamente din ceară realizate manual, ideale pentru evenimente, cadouri și decoruri speciale.",
    seoTitle: "Aranjamente din ceară create manual",
    seoText:
      "Aranjamentele din ceară disponibile pe Artfest sunt produse handmade create pentru cadouri, decoruri și ocazii speciale. Descoperă aranjamente realizate de artizani români, în stiluri variate, potrivite pentru aniversări, nunți, botezuri sau decoruri de interior.",
    faq: defaultFaq("Aranjamente din ceară"),
  },

  "decor_flori-plusate": {
    slug: "flori-plusate",
    title: "Flori plușate handmade",
    description:
      "Flori plușate handmade, cadouri originale și speciale pentru aniversări, surprize și ocazii memorabile.",
    h1: "Flori plușate",
    intro:
      "Descoperă flori plușate speciale, potrivite pentru cadouri originale și momente cu adevărat memorabile.",
    seoTitle: "Flori plușate pentru cadouri originale",
    seoText:
      "Florile plușate de pe Artfest sunt cadouri originale, potrivite pentru aniversări, surprize romantice, zile speciale sau momente în care vrei să oferi ceva diferit. Alege flori plușate realizate de creatori români pentru un cadou care rămâne în amintire.",
    faq: defaultFaq("Flori plușate"),
  },

  "decor_aranjamente-flori-plusate": {
    slug: "aranjamente-flori-plusate",
    title: "Aranjamente flori plușate",
    description:
      "Aranjamente cu flori plușate, create pentru cadouri speciale, aniversări și surprize deosebite.",
    h1: "Aranjamente flori plușate",
    intro:
      "Găsește aranjamente cu flori plușate, perfecte pentru cadouri originale și surprize cu impact.",
    seoTitle: "Aranjamente cu flori plușate pentru surprize speciale",
    seoText:
      "Aranjamentele cu flori plușate de pe Artfest sunt create pentru cadouri speciale, aniversări, surprize romantice sau momente în care vrei să oferi ceva original. Aceste produse îmbină aspectul decorativ al aranjamentelor florale cu farmecul plușului.",
    faq: defaultFaq("Aranjamente flori plușate"),
  },

  "textile_halate-personalizate": {
    slug: "halate-personalizate",
    title: "Halate personalizate pentru evenimente",
    description:
      "Halate personalizate pentru evenimente, cadouri, mirese, nașe, domnișoare de onoare sau ocazii speciale.",
    h1: "Halate personalizate",
    intro:
      "Alege halate personalizate pentru evenimente, cadouri speciale sau momente de pregătire memorabile.",
    seoTitle: "Halate personalizate pentru mirese, nașe și evenimente",
    seoText:
      "Pe Artfest găsești halate personalizate pentru mirese, nașe, domnișoare de onoare sau cadouri speciale. Aceste produse sunt potrivite pentru pregătirile din ziua nunții, ședințe foto, petreceri tematice sau momente relaxante oferite cadou.",
    faq: defaultFaq("Halate personalizate"),
  },

  "textile_prosoape-personalizate": {
    slug: "prosoape-personalizate",
    title: "Prosoape personalizate handmade",
    description:
      "Prosoape personalizate pentru cadouri, botezuri, nunți sau uz personal, disponibile pe Artfest.",
    h1: "Prosoape personalizate",
    intro:
      "Găsește prosoape personalizate potrivite pentru cadouri, evenimente și ocazii speciale.",
    seoTitle: "Prosoape personalizate pentru cadouri și evenimente",
    seoText:
      "Prosoapele personalizate disponibile pe Artfest sunt potrivite pentru cadouri, botezuri, nunți, aniversări sau uz personal. Poți găsi modele brodate sau decorate, personalizabile cu nume, inițiale, mesaje sau simboluri speciale.",
    faq: defaultFaq("Prosoape personalizate"),
  },

  "ceremonie_tavita-mot": {
    slug: "tavita-mot",
    title: "Tăviță moț personalizată",
    description:
      "Tăvițe pentru moț și accesorii pentru ceremonia de tăiere a moțului, create de artizani pe Artfest.",
    h1: "Tăviță moț",
    intro:
      "Descoperă tăvițe pentru moț și accesorii speciale pentru unul dintre cele mai importante momente din familie.",
    seoTitle: "Tăviță moț și accesorii pentru ceremonia de tăiere a moțului",
    seoText:
      "Pe Artfest găsești tăvițe pentru moț și accesorii speciale pentru ceremonia de tăiere a moțului. Aceste produse pot fi personalizate și adaptate în funcție de tema evenimentului, culori sau preferințele familiei.",
    faq: defaultFaq("Tăviță moț"),
  },
};

export function buildSeoCategory(key, label) {
  const base = makeDefaultCategory(key, label);
  const override = SEO_CATEGORY_OVERRIDES[key];

  if (override) {
    return {
      ...base,
      ...override,
      key,
      label,
      faq: override.faq || base.faq,
      seoText: override.seoText || base.seoText,
      seoTitle: override.seoTitle || base.seoTitle,
    };
  }

  return base;
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