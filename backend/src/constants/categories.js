// backend/constants/categories.js
// Listă completă de categorii pentru produse (marketplace artizani evenimente & cadouri).
// Cheile (slug-urile) sunt cele stocate în Product.category.

export const CATEGORIES = [
  // Decor pentru evenimente
  "decor_aranjamente-florale-naturale",
  "decor_aranjamente-florale-artificiale",
  "decor_flori-plusate",
  "decor_aranjamente-flori-plusate",
  "decor_flori-ceara",
  "decor_flori-sapun",
  "decor_aranjamente-ceara",
  "decor_aranjamente-sapun",
  "decor_baloane",
  "decor_lumanari-decor",
  "decor_lumini-decorative",
  "decor_litere-volumetrice",
  "decor_neonuri",
  "decor_panouri-backdrop",
  "decor_arcuri-florale",
  "decor_arbori-decorativi",
  "decor_textile-fete-de-masa",
  "decor_textile-drapaje",
  "decor_textile_servete",
  "decor_centrepieces",
  "decor_stil_boho",
  "decor_stil_rustic",
  "decor_stil_clasic",
  "decor_stil_modern",

  // Papetărie & personalizări
  "papetarie_invitatii-nunta",
  "papetarie_invitatii-botez",
  "papetarie_invitatii-corporate",
  "papetarie_invitatii-petrecere",
  "papetarie_place-cards",
  "papetarie_meniuri",
  "papetarie_numere-mese",
  "papetarie_guest-book",
  "papetarie_guest-book-alternativ",
  "papetarie_etichete-personalizate",
  "papetarie_stickere",
  "papetarie_sigilii-ceara",
  "papetarie_carduri-cadou",
  "papetarie_plicuri-bani",
  "papetarie_afis-welcome",
  "papetarie_afis-program",
  "papetarie_afis-bar-menu",

  // Ceremonie & ritualuri
  "ceremonie_pernuta-verighete",
  "ceremonie_cutie-verighete",
  "ceremonie_pahare-miri",
  "ceremonie_cufar-dar",
  "ceremonie_set-taiere-tort",
  "ceremonie_lumanari-biserica",
  "ceremonie_trusou-botez",
  "ceremonie_cutie-amintiri-botez",
  "ceremonie_cruciulite-botez",
  "ceremonie_tavita-mot",
  "ceremonie_tava-gatit-mireasa",
  "ceremonie_tava-gatit-mire",

  // Home & lifestyle handmade
  "home_lumanari-parfumate",
  "home_difuzoare-parfum-camera",
  "home_ceramica-lut",
  "home_textile-decor",
  "home_lemn-decor",
  "home_imprimare-3d",
  "home_decor-perete",

  // Bijuterii & accesorii
  "bijuterii_bratari",
  "bijuterii_coliere",
  "bijuterii_cercei",
  "bijuterii_seturi",
  "bijuterii_accesorii-mireasa_coronita",
  "bijuterii_accesorii-mireasa_agrafa",
  "bijuterii_papioane",
  "bijuterii_butoni",
  "bijuterii_brose",

  // Mărturii & mini-cadou
  "marturii_nunta",
  "marturii_botez",
  "marturii_corporate",
  "marturii_mini-plante",
  "marturii_miere",
  "marturii_dulceturi",
  "marturii_biscuiti",
  "marturii_magneti",
  "marturii_mini-lumanari",
  "marturii_obiecte-gravate",

  // Cadouri & personalizate
   "cadouri_1-iunie",
  "cadouri_final-an-scolar",
  "cadouri_pentru-miri",
  "cadouri_pentru-nasi",
  "cadouri_pentru-parinti",
  "cadouri_botez",
  "cadouri_cutii-cadou",
  "cadouri_cosuri-cadou",
  "cadouri_portrete-ilustrate",
  "cadouri_portrete-pictate",
  "cadouri_caricaturi",
  "cadouri_albume-foto",
  "cadouri_scrapbook",
  "cadouri_rame-foto",
  "cadouri_tablou-amintire",
  "cadouri_puzzle-personalizat",
  "cadouri_harta-stelara",
  "cadouri_harta-razuibila",
  "cadouri_boxa-muzicala",
  "cadouri_obiecte-cu-nume",
  "cadouri_anime-manga",

  // Artă & artizanat
  "arta_tablouri",
  "arta_ilustratii-digitale",
  "arta_pe-lemn",
  "arta_pe-sticla",
  "arta_macrame",
  "arta_rasina-epoxidica",
  "arta_quilling",
  "arta_flori-de-hartie",

  // Textile & croitorie
  "textile_rochii-ceremonie-copii",
  "textile_body-personalizat-bebe",
  "textile_hainute-tematice",
  "textile_paturi-personalizate",
  "textile_seturi-bebe",
  "textile_halate-personalizate",
  "textile_prosoape-personalizate",
  "textile_personalizare-broderie",
  "textile_personalizare-imprimare",

  // Candy bar & party
  "party_figurine-tort",
  "party_cake-toppers",
  "party_standuri-prajituri",
  "party_toppers-cupcakes",
  "party_borcanase-dulciuri",
  "party_cutiute-dulciuri",
  "party_baloane-party",
  "party_confetti",
  "party_bannere",
  "party_seturi-petreceri",

  // Back-compat (fallback)
  "alte"
];

// Etichete frumoase pentru UI
export const CATEGORY_LABELS = {
  // Decor
  "decor_aranjamente-florale-naturale": "Aranjamente florale naturale",
  "decor_aranjamente-florale-artificiale": "Aranjamente florale artificiale",
  "decor_flori-plusate": "Flori plușate",
  "decor_aranjamente-flori-plusate": "Aranjamente flori plușate",
  "decor_flori-ceara": "Flori din ceară",
  "decor_flori-sapun": "Flori din săpun",
  "decor_aranjamente-ceara": "Aranjamente din ceară",
  "decor_aranjamente-sapun": "Aranjamente din săpun",
  "decor_baloane": "Decor din baloane",
  "decor_lumanari-decor": "Lumânări & suporturi",
  "decor_lumini-decorative": "Lămpi & lumini decorative",
  "decor_litere-volumetrice": "Litere volumetrice",
  "decor_neonuri": "Neonuri",
  "decor_panouri-backdrop": "Panouri & backdrop-uri",
  "decor_arcuri-florale": "Arcuri florale",
  "decor_arbori-decorativi": "Arbori decorativi",
  "decor_textile-fete-de-masa": "Textile: fețe de masă",
  "decor_textile-drapaje": "Textile: drapaje",
  "decor_textile_servete": "Textile: șervete",
  "decor_centrepieces": "Piese centrale (centrepieces)",
  "decor_stil_boho": "Decor stil boho",
  "decor_stil_rustic": "Decor stil rustic",
  "decor_stil_clasic": "Decor stil clasic",
  "decor_stil_modern": "Decor stil modern",

  // Papetărie
  "papetarie_invitatii-nunta": "Invitații nuntă",
  "papetarie_invitatii-botez": "Invitații botez",
  "papetarie_invitatii-corporate": "Invitații corporate",
  "papetarie_invitatii-petrecere": "Invitații petrecere",
  "papetarie_place-cards": "Place cards",
  "papetarie_meniuri": "Meniuri",
  "papetarie_numere-mese": "Numere mese",
  "papetarie_guest-book": "Guest book",
  "papetarie_guest-book-alternativ": "Guest book alternativ",
  "papetarie_etichete-personalizate": "Etichete personalizate",
  "papetarie_stickere": "Stickere",
  "papetarie_sigilii-ceara": "Sigilii din ceară",
  "papetarie_carduri-cadou": "Carduri cadou",
  "papetarie_plicuri-bani": "Plicuri de bani",
  "papetarie_afis-welcome": "Afiș Welcome",
  "papetarie_afis-program": "Afiș Programul Zilei",
  "papetarie_afis-bar-menu": "Afiș Meniu Bar",

  // Ceremonie
  "ceremonie_pernuta-verighete": "Pernuță verighete",
  "ceremonie_cutie-verighete": "Cutie verighete",
  "ceremonie_pahare-miri": "Pahare miri",
  "ceremonie_cufar-dar": "Cufăr dar",
  "ceremonie_set-taiere-tort": "Set tăiere tort",
  "ceremonie_lumanari-biserica": "Lumânări biserică",
  "ceremonie_trusou-botez": "Trusou botez",
  "ceremonie_cutie-amintiri-botez": "Cutie amintiri botez",
  "ceremonie_cruciulite-botez": "Cruciuțe/broșe botez",
  "ceremonie_tavita-mot": "Tăviță moț",
  "ceremonie_tava-gatit-mireasa": "Tavă gătit mireasă",
  "ceremonie_tava-gatit-mire": "Tavă gătit mire",

  // Home
  "home_lumanari-parfumate": "Lumânări parfumate",
  "home_difuzoare-parfum-camera": "Difuzoare & parfumuri cameră",
  "home_ceramica-lut": "Obiecte ceramică / lut",
  "home_textile-decor": "Textile decorative",
  "home_lemn-decor": "Obiecte din lemn",
  "home_imprimare-3d": "Obiecte print 3D",
  "home_decor-perete": "Decor de perete",

  // Bijuterii
  "bijuterii_bratari": "Brățări",
  "bijuterii_coliere": "Coliere",
  "bijuterii_cercei": "Cercei",
  "bijuterii_seturi": "Seturi bijuterii",
  "bijuterii_accesorii-mireasa_coronita": "Accesorii mireasă: coroniță",
  "bijuterii_accesorii-mireasa_agrafa": "Accesorii mireasă: agrafă",
  "bijuterii_papioane": "Papioane",
  "bijuterii_butoni": "Butoni",
  "bijuterii_brose": "Broșe",

  // Mărturii
  "marturii_nunta": "Mărturii nuntă",
  "marturii_botez": "Mărturii botez",
  "marturii_corporate": "Mărturii corporate",
  "marturii_mini-plante": "Mini-plante / suculente",
  "marturii_miere": "Miere artizanală",
  "marturii_dulceturi": "Dulcețuri & gemuri",
  "marturii_biscuiti": "Biscuiți / cookies",
  "marturii_magneti": "Magneți personalizați",
  "marturii_mini-lumanari": "Mini-lumânări",
  "marturii_obiecte-gravate": "Obiecte gravate",

  // Cadouri
  "cadouri": "Cadouri",
  "cadouri_1-iunie": "Cadouri de 1 Iunie",
  "cadouri_final-an-scolar": "Cadouri de final de an școlar",
  "cadouri_pentru-miri": "Cadouri pentru miri",
  "cadouri_pentru-nasi": "Cadouri pentru nași",
  "cadouri_pentru-parinti": "Cadouri pentru părinți",
  "cadouri_botez": "Cadouri botez",
  "cadouri_cutii-cadou": "Cutii cadou",
  "cadouri_cosuri-cadou": "Coșuri cadou",
  "cadouri_portrete-ilustrate": "Portrete ilustrate",
  "cadouri_portrete-pictate": "Portrete pictate",
  "cadouri_caricaturi": "Caricaturi",
  "cadouri_albume-foto": "Albume foto",
  "cadouri_scrapbook": "Scrapbook",
  "cadouri_rame-foto": "Rame foto",
  "cadouri_tablou-amintire": "Tablou amintire",
  "cadouri_puzzle-personalizat": "Puzzle personalizat",
  "cadouri_harta-stelara": "Hartă stelară",
  "cadouri_harta-razuibila": "Hartă răzuibilă",
  "cadouri_boxa-muzicala": "Boxă muzicală personalizată",
  "cadouri_obiecte-cu-nume": "Obiecte cu nume/mesaj",
  "cadouri_anime-manga": "Anime & Manga",

  // Artă
  "arta_tablouri": "Tablouri",
  "arta_ilustratii-digitale": "Ilustrații digitale",
  "arta_pe-lemn": "Artă pe lemn",
  "arta_pe-sticla": "Artă pe sticlă",
  "arta_macrame": "Macramé",
  "arta_rasina-epoxidica": "Rășină epoxidică",
  "arta_quilling": "Quilling",
  "arta_flori-de-hartie": "Flori din hârtie",

  // Textile
  "textile_rochii-ceremonie-copii": "Rochii ceremonie copii",
  "textile_body-personalizat-bebe": "Body personalizat bebe",
  "textile_hainute-tematice": "Hăinuțe tematice",
  "textile_paturi-personalizate": "Pături personalizate",
  "textile_seturi-bebe": "Seturi bebe personalizate",
  "textile_halate-personalizate": "Halate personalizate",
  "textile_prosoape-personalizate": "Prosoape personalizate",
  "textile_personalizare-broderie": "Personalizare textile – broderie",
  "textile_personalizare-imprimare": "Personalizare textile – imprimare",

  // Party
  "party_figurine-tort": "Figurine tort",
  "party_cake-toppers": "Cake toppers",
  "party_standuri-prajituri": "Standuri prăjituri",
  "party_toppers-cupcakes": "Topper-e cupcakes",
  "party_borcanase-dulciuri": "Borcanase dulciuri",
  "party_cutiute-dulciuri": "Căsuțe dulciuri",
  "party_baloane-party": "Baloane (petrecere)",
  "party_confetti": "Confetti",
  "party_bannere": "Bannere",
  "party_seturi-petreceri": "Seturi petreceri",

  // Back-compat
  "alte": "Altele"
};

export const CATEGORY_GROUP_LABELS = {
  decor: "Decor pentru evenimente",
  papetarie: "Papetărie & personalizări",
  ceremonie: "Ceremonie & ritualuri",
  home: "Home & lifestyle handmade",
  bijuterii: "Bijuterii & accesorii",
  marturii: "Mărturii & mini-cadou",
  cadouri: "Cadouri & personalizate",
  arta: "Artă & artizanat",
  textile: "Textile & croitorie",
  party: "Candy bar & party",
  alte: "Altele"
};

export const CATEGORIES_DETAILED = Object.entries(CATEGORY_LABELS).map(([key, label]) => {
  const group = key.split("_")[0] || "alte";

  return {
    key,
    label,
    group,
    groupLabel: CATEGORY_GROUP_LABELS[group] || "Altele",
  };
});

export const CATEGORY_SET = new Set(CATEGORIES);
// ---------------------------------------------------------------------------
// Categorii SUPLIMENTARE (ProductAdditionalCategory) - doar discovery intern.
// Categoria PRINCIPALĂ rămâne Product.category (breadcrumb, SEO, canonical,
// Google/Meta feed). Suplimentarele: max 3, fără duplicate, niciodată egale
// cu principala, doar chei din CATEGORIES.
// ---------------------------------------------------------------------------

export const MAX_ADDITIONAL_CATEGORIES = 3;

/**
 * Normalizează lista de categorii suplimentare trimisă de client.
 * - ignoră valorile goale și duplicatele;
 * - scoate AUTOMAT categoria principală (dacă principala devine una dintre
 *   suplimentare, nu mai rămâne și suplimentară);
 * - cheie necunoscută / prea multe -> { error } (nu tăiem silențios).
 *
 * @returns {{ ok: true, value: string[] } | { ok: false, error: string, detail?: any }}
 */
export function normalizeAdditionalCategories(input, primaryCategory) {
  if (input == null) return { ok: true, value: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: "invalid_additional_categories" };
  }

  const primary = String(primaryCategory || "").trim();
  const seen = new Set();
  const value = [];

  for (const raw of input) {
    const key = String(raw ?? "").trim();
    if (!key || key === primary || seen.has(key)) continue;
    if (!CATEGORY_SET.has(key)) {
      return { ok: false, error: "invalid_additional_category", detail: key };
    }
    seen.add(key);
    value.push(key);
  }

  if (value.length > MAX_ADDITIONAL_CATEGORIES) {
    return {
      ok: false,
      error: "too_many_additional_categories",
      detail: MAX_ADDITIONAL_CATEGORIES,
    };
  }

  return { ok: true, value };
}

/**
 * Condiția Prisma "produsul aparține categoriei": principală SAU
 * suplimentară. Interogarea e pe Product, deci fiecare produs apare o
 * singură dată în rezultate.
 */
export function productCategoryWhere(category, { insensitive = false } = {}) {
  const key = String(category || "").trim();
  if (!key) return null;

  const match = insensitive ? { equals: key, mode: "insensitive" } : key;

  return {
    OR: [
      { category: match },
      { additionalCategories: { some: { category: match } } },
    ],
  };
}

/** Același lucru pentru o listă de categorii (reguli de colecție). */
export function productCategoriesInWhere(categories) {
  const keys = (Array.isArray(categories) ? categories : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (!keys.length) return null;

  return {
    OR: [
      { category: { in: keys } },
      { additionalCategories: { some: { category: { in: keys } } } },
    ],
  };
}

/** Lista suplimentarelor dintr-un produs încărcat cu relația (ordonată). */
export function additionalCategoryKeys(product) {
  const rows = Array.isArray(product?.additionalCategories)
    ? product.additionalCategories
    : [];
  return rows
    .slice()
    .sort((a, b) => (a?.position ?? 0) - (b?.position ?? 0))
    .map((r) => (typeof r === "string" ? r : r?.category))
    .filter(Boolean);
}

/**
 * Sugestii AI de categorii suplimentare: doar chei din catalog, fără
 * duplicate, fără principala, max MAX_ADDITIONAL_CATEGORIES. Spre deosebire
 * de normalizeAdditionalCategories (input vendor -> eroare), aici doar
 * filtrăm: sunt PROPUNERI, afișate vendorului și nesalvate automat.
 */
export function pickSuggestedAdditionalCategories(raw, primaryCategory) {
  const primary = String(primaryCategory || "").trim();
  const out = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    const key = String(
      typeof item === "string" ? item : item?.key || item?.category || ""
    ).trim();

    if (!key || key === primary || out.includes(key)) continue;
    if (!CATEGORY_SET.has(key)) continue;
    out.push(key);
    if (out.length >= MAX_ADDITIONAL_CATEGORIES) break;
  }

  return out;
}

/**
 * Decide scrierea relației ProductAdditionalCategory la EDITARE
 * (vendor + admin, aceeași logică):
 *  - câmp ABSENT (input === undefined) -> nu atingem lista, cu o singură
 *    excepție: noua principală era suplimentară -> scoatem doar pe ea;
 *  - [] explicit -> golim lista;
 *  - listă identică (după normalizare, aceeași ordine) -> NICIO scriere;
 *  - listă diferită -> înlocuim lista.
 *
 * @returns {{ ok: true, write?: object } | { ok: false, error: string, detail?: any }}
 *   `write` = obiectul nested Prisma pentru `additionalCategories`, sau
 *   undefined când nu trebuie scris nimic.
 */
export function planAdditionalCategoriesWrite({
  input,
  primaryCategory,
  newPrimaryCategory,
  existingKeys = [],
}) {
  const current = Array.isArray(existingKeys) ? existingKeys : [];

  if (input === undefined) {
    if (newPrimaryCategory && current.includes(newPrimaryCategory)) {
      return {
        ok: true,
        write: { deleteMany: { category: newPrimaryCategory } },
      };
    }
    return { ok: true };
  }

  const norm = normalizeAdditionalCategories(input, primaryCategory);
  if (!norm.ok) return norm;

  if (JSON.stringify(current) === JSON.stringify(norm.value)) {
    return { ok: true };
  }

  return {
    ok: true,
    write: {
      deleteMany: {},
      create: norm.value.map((category, position) => ({ category, position })),
    },
  };
}
