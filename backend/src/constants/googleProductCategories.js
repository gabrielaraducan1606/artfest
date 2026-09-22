// backend/src/constants/googleProductCategories.js
//
// Mapping DETERMINIST: cheia categoriei Artfest (Product.category, vezi
// categories.js) -> Google Product Category (g:google_product_category).
//
// Sursă ID-uri: Google_Product_Taxonomy_Version 2021-09-21
// (https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt).
// ID-urile sunt numerice, deci independente de limba feed-ului.
//
// REGULI:
//  - AI-ul NU alege și NU inventează categoria Google - doar acest map.
//  - Dacă o categorie nu e aici, feed-ul NU trimite google_product_category
//    (mai bine lipsă decât greșită - Google o deduce singur din titlu/imagine).
//  - Categoriile ambigue/mixte (ex. "Lumânări & suporturi", "Aranjamente
//    florale", "Figurine tort") sunt lăsate DELIBERAT fără mapping.
//  - Orice intrare nouă trebuie verificată în fișierul taxonomiei de mai sus;
//    testul din googleShoppingFeed.test.js verifică doar că cheia există în
//    CATEGORIES și că ID-ul e numeric, nu corectitudinea semantică.
//
// `path` e păstrat doar ca documentație/audit (nu se trimite în feed).

export const GOOGLE_PRODUCT_CATEGORY_BY_CATEGORY = {
  // ---- Bijuterii & accesorii ----
  "bijuterii_bratari": {
    id: 191,
    path: "Apparel & Accessories > Jewelry > Bracelets",
  },
  "bijuterii_coliere": {
    id: 196,
    path: "Apparel & Accessories > Jewelry > Necklaces",
  },
  "bijuterii_cercei": {
    id: 194,
    path: "Apparel & Accessories > Jewelry > Earrings",
  },
  "bijuterii_seturi": {
    id: 6463,
    path: "Apparel & Accessories > Jewelry > Jewelry Sets",
  },
  "bijuterii_brose": {
    id: 197,
    path: "Apparel & Accessories > Jewelry > Brooches & Lapel Pins",
  },
  "bijuterii_butoni": {
    id: 193,
    path: "Apparel & Accessories > Clothing Accessories > Cufflinks",
  },
  "bijuterii_papioane": {
    // Taxonomia Google nu are "Bow Ties"; papionul intră la Neckties.
    id: 176,
    path: "Apparel & Accessories > Clothing Accessories > Neckties",
  },

  // ---- Lumânări ----
  "home_lumanari-parfumate": {
    id: 588,
    path: "Home & Garden > Decor > Home Fragrances > Candles",
  },
  "marturii_mini-lumanari": {
    id: 588,
    path: "Home & Garden > Decor > Home Fragrances > Candles",
  },

  // ---- Papetărie ----
  "papetarie_invitatii-nunta": {
    id: 1371,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Invitations",
  },
  "papetarie_invitatii-botez": {
    id: 1371,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Invitations",
  },
  "papetarie_invitatii-corporate": {
    id: 1371,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Invitations",
  },
  "papetarie_invitatii-petrecere": {
    id: 1371,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Invitations",
  },
  "papetarie_place-cards": {
    id: 2104,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Place Cards",
  },

  // ---- Party ----
  "decor_baloane": {
    id: 2587,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Balloons",
  },
  "party_baloane-party": {
    id: 2587,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Balloons",
  },
  "party_confetti": {
    id: 2781,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Confetti",
  },
  "party_standuri-prajituri": {
    id: 4372,
    path: "Home & Garden > Kitchen & Dining > Tableware > Serveware > Cake Stands",
  },

  // ---- Mărturii ----
  "marturii_nunta": {
    id: 5453,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Party Favors > Wedding Favors",
  },
  "marturii_botez": {
    id: 5452,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Party Favors",
  },
  "marturii_corporate": {
    id: 5452,
    path: "Arts & Entertainment > Party & Celebration > Party Supplies > Party Favors",
  },
  "marturii_miere": {
    id: 4947,
    path: "Food, Beverages & Tobacco > Food Items > Condiments & Sauces > Honey",
  },
  "marturii_dulceturi": {
    id: 2188,
    path: "Food, Beverages & Tobacco > Food Items > Dips & Spreads > Jams & Jellies",
  },
  "marturii_biscuiti": {
    id: 2229,
    path: "Food, Beverages & Tobacco > Food Items > Bakery > Cookies",
  },
  "marturii_magneti": {
    id: 5876,
    path: "Home & Garden > Decor > Refrigerator Magnets",
  },

  // ---- Ceremonie ----
  "ceremonie_pernuta-verighete": {
    id: 5457,
    path: "Religious & Ceremonial > Wedding Ceremony Supplies > Ring Pillows & Holders",
  },
  "ceremonie_cutie-verighete": {
    id: 5457,
    path: "Religious & Ceremonial > Wedding Ceremony Supplies > Ring Pillows & Holders",
  },

  // ---- Decor / home / cadouri / artă ----
  "decor_neonuri": {
    id: 4070,
    path: "Business & Industrial > Signage > Electric Signs > Neon Signs",
  },
  "decor_textile-fete-de-masa": {
    id: 4143,
    path: "Home & Garden > Linens & Bedding > Table Linens > Tablecloths",
  },
  "decor_textile_servete": {
    id: 4203,
    path: "Home & Garden > Linens & Bedding > Table Linens > Cloth Napkins",
  },
  "cadouri_rame-foto": {
    id: 597,
    path: "Home & Garden > Decor > Picture Frames",
  },
  "cadouri_albume-foto": {
    id: 40,
    path: "Home & Garden > Household Supplies > Storage & Organization > Photo Storage > Photo Albums",
  },
  "cadouri_cutii-cadou": {
    id: 5091,
    path: "Arts & Entertainment > Party & Celebration > Gift Giving > Gift Wrapping > Gift Boxes & Tins",
  },
  "cadouri_puzzle-personalizat": {
    id: 2618,
    path: "Toys & Games > Puzzles > Jigsaw Puzzles",
  },
  "arta_tablouri": {
    id: 500044,
    path: "Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork",
  },

  // ---- Textile ----
  "textile_prosoape-personalizate": {
    id: 4077,
    path: "Home & Garden > Linens & Bedding > Towels",
  },
  "textile_halate-personalizate": {
    id: 2302,
    path: "Apparel & Accessories > Clothing > Sleepwear & Loungewear > Robes",
  },
};

/**
 * ID-ul Google Product Category pentru o categorie Artfest, sau null dacă
 * nu avem un mapping sigur (caz în care feed-ul omite atributul).
 */
export function getGoogleProductCategoryId(category) {
  const key = String(category || "").trim();
  if (!key) return null;

  const entry = Object.prototype.hasOwnProperty.call(
    GOOGLE_PRODUCT_CATEGORY_BY_CATEGORY,
    key
  )
    ? GOOGLE_PRODUCT_CATEGORY_BY_CATEGORY[key]
    : null;

  return entry ? entry.id : null;
}
