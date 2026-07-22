// src/routes/assistant/assistantProducts.service.js

import { openai } from "../../../lib/openai.js";
import { prisma } from "../../../db.js";

import {
  cleanDisplayText,
  normalizeArray,
  normalizeBudget,
  normalizeNullableInteger,
  normalizeProductForResponse,
  normalizeText,
  readSearch,
  safeJsonParse,
  saveSearch,
  updateSearch,
} from "./assistantRoutes.utils.js";

/* ======================================================
   Configurare
====================================================== */

const AI_MODEL =
  process.env.OPENAI_ASSISTANT_PRODUCTS_MODEL ||
  "gpt-4.1";

const MAX_CATALOG_PRODUCTS = 500;
const MAX_RETURNED_PRODUCTS = 60;
const GIFT_RECIPIENT_PROFILES = {
  "pentru ea": {
    recipientTags: [
      "femeie",
      "cadou pentru ea",
    ],

    styles: [
      "elegant",
      "minimalist",
      "romantic",
      "delicat",
    ],

    keywords: [
      "bijuterie",
      "accesoriu",
      "decor",
      "personalizat",
      "handmade",
      "cadou special",
    ],
  },

  "pentru el": {
    recipientTags: [
      "bărbat",
      "cadou pentru el",
    ],

    styles: [
      "modern",
      "minimalist",
      "rustic",
      "practic",
    ],

    keywords: [
      "accesoriu",
      "birou",
      "decor",
      "lemn",
      "personalizat",
      "handmade",
    ],
  },

  "pentru un copil": {
    recipientTags: [
      "copil",
      "cadou pentru copil",
    ],

    styles: [
      "jucăuș",
      "vesel",
      "colorat",
    ],

    keywords: [
      "jucărie",
      "educativ",
      "camera copilului",
      "decor pentru copii",
      "personalizat",
      "sigur",
    ],
  },

  "pentru un cuplu": {
    recipientTags: [
      "cuplu",
      "cadou pentru cuplu",
    ],

    styles: [
      "romantic",
      "elegant",
      "minimalist",
    ],

    keywords: [
      "set",
      "casă",
      "decor",
      "personalizat",
      "miri",
      "amintire",
    ],
  },

  "alta persoana": {
    recipientTags: [
      "cadou",
    ],

    styles: [],

    keywords: [
      "handmade",
      "unicat",
      "special",
      "personalizat",
    ],
  },
};

const GIFT_OCCASION_PROFILES = {
  "zi de nastere": {
    occasions: [
      "zi de naștere",
      "aniversare",
    ],

    styles: [
      "festiv",
    ],

    keywords: [
      "cadou aniversar",
      "cadou special",
      "personalizat",
      "surpriză",
    ],
  },

  "nunta": {
    occasions: [
      "nuntă",
      "cununie",
    ],

    styles: [
      "elegant",
      "romantic",
    ],

    keywords: [
      "miri",
      "cuplu",
      "cadou de nuntă",
      "decor",
      "personalizat",
      "amintire",
    ],
  },

  "aniversare": {
    occasions: [
      "aniversare",
    ],

    styles: [
      "romantic",
      "elegant",
    ],

    keywords: [
      "cuplu",
      "amintire",
      "cadou aniversar",
      "personalizat",
    ],
  },

  "casa noua": {
    occasions: [
      "casă nouă",
      "housewarming",
    ],

    styles: [
      "decorativ",
      "minimalist",
      "elegant",
    ],

    keywords: [
      "decor",
      "locuință",
      "interior",
      "cadou pentru casă",
      "set",
    ],
  },

  "craciun": {
    occasions: [
      "crăciun",
      "sărbători",
    ],

    styles: [
      "festiv",
      "rustic",
      "tradițional",
    ],

    keywords: [
      "crăciun",
      "iarna",
      "sărbători",
      "decorațiune",
      "cadou de crăciun",
    ],
  },

  "multumire": {
    occasions: [
      "mulțumire",
    ],

    styles: [
      "elegant",
      "delicat",
    ],

    keywords: [
      "apreciere",
      "cadou simbolic",
      "mulțumesc",
      "special",
    ],
  },

  "alta ocazie": {
    occasions: [],

    styles: [],

    keywords: [
      "cadou",
      "ocazie specială",
      "handmade",
    ],
  },
};
/* ======================================================
   Erori HTTP
====================================================== */

function createServiceError(
  message,
  {
    code = "assistant_products_error",
    status = 500,
  } = {}
) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

/* ======================================================
   Prisma — produse publice
====================================================== */

function buildPriceWhere({
  minPriceCents,
  maxPriceCents,
}) {
  const priceCents = {};

  if (minPriceCents !== null) {
    priceCents.gte = minPriceCents;
  }

  if (maxPriceCents !== null) {
    priceCents.lte = maxPriceCents;
  }

  return Object.keys(priceCents).length
    ? { priceCents }
    : {};
}

function getPublicProductWhere({
  minPriceCents = null,
  maxPriceCents = null,
  customizableOnly = false,
} = {}) {
  return {
    isActive: true,
    isHidden: false,
    moderationStatus: "APPROVED",

    availability: {
      not: "SOLD_OUT",
    },

    ...buildPriceWhere({
      minPriceCents,
      maxPriceCents,
    }),

    ...(customizableOnly
      ? {
          OR: [
  {
    acceptsCustom: true,
  },
  {
    orderMode: "OPTIONS",
  },
  {
    orderMode: "QUOTE_ONLY",
  },
],
        }
      : {}),

    service: {
      is: {
        isActive: true,
        status: "ACTIVE",

        vendor: {
          is: {
            isActive: true,
          },
        },
      },
    },
  };
}

async function getCatalogProducts({
  minPriceCents = null,
  maxPriceCents = null,
  customizableOnly = false,
} = {}) {
  return prisma.product.findMany({
    where: getPublicProductWhere({
      minPriceCents,
      maxPriceCents,
      customizableOnly,
    }),

    select: {
      id: true,
      title: true,
      description: true,

      priceCents: true,
      currency: true,

      images: true,

      category: true,
      color: true,
      materialMain: true,
      technique: true,

      styleTags: true,
      occasionTags: true,

      dimensions: true,
specialNotes: true,
careInstructions: true,

      availability: true,
      acceptsCustom: true,
      orderMode: true,

      popularityScore: true,
      createdAt: true,

      service: {
        select: {
          id: true,

          profile: {
            select: {
              displayName: true,
              slug: true,
            },
          },

          vendor: {
            select: {
              id: true,
              displayName: true,
            },
          },
        },
      },
    },

    orderBy: [
      {
        popularityScore: "desc",
      },
      {
        createdAt: "desc",
      },
    ],

    take: MAX_CATALOG_PRODUCTS,
  });
}

/* ======================================================
   OpenAI — analiză fotografie
====================================================== */

async function analyzeImageIntent(file) {
  if (!file?.buffer) {
    throw createServiceError(
      "Fotografia nu este validă.",
      {
        code: "invalid_image",
        status: 400,
      }
    );
  }

  const dataUrl =
    `data:${file.mimetype};base64,${file.buffer.toString(
      "base64"
    )}`;

  const response =
    await openai.responses.create({
      model: AI_MODEL,

      text: {
        format: {
          type: "json_object",
        },
      },

      input: [
        {
          role: "user",

          content: [
            {
              type: "input_text",

              text: `
Analizează fotografia pentru căutarea unor produse similare
într-un marketplace românesc de produse handmade.

Returnează exclusiv JSON valid, fără markdown.

Nu inventa informații comerciale.
Descrie numai caracteristicile vizuale utile pentru căutare.

Schema exactă:

{
  "productType": "",
  "category": "",
  "colors": [],
  "materials": [],
  "styles": [],
  "occasions": [],
  "keywords": [],
  "description": ""
}

Reguli:

- Răspunde în limba română.
- productType trebuie să fie scurt și concret.
- category trebuie să fie o categorie generală.
- colors trebuie să conțină culorile dominante.
- materials trebuie să conțină materialele probabile.
- styles trebuie să descrie stilul vizual.
- occasions trebuie să conțină ocazii doar dacă sunt evidente.
- keywords trebuie să conțină expresii utile pentru căutare.
- Dacă o caracteristică nu este clară, lasă câmpul gol.
`,
            },

            {
              type: "input_image",
              image_url: dataUrl,
              detail: "auto",
            },
          ],
        },
      ],
    });

  const parsed = safeJsonParse(
    response.output_text
  );

  if (!parsed) {
    throw createServiceError(
      "Modelul AI nu a returnat o analiză validă.",
      {
        code: "invalid_ai_analysis",
        status: 502,
      }
    );
  }

  return {
    productType: normalizeText(
      parsed.productType
    ),

    category: normalizeText(
      parsed.category
    ),

    colors: normalizeArray(
      parsed.colors,
      6
    ),

    materials: normalizeArray(
      parsed.materials,
      6
    ),

    styles: normalizeArray(
      parsed.styles,
      8
    ),

    occasions: normalizeArray(
      parsed.occasions,
      8
    ),

    recipientTags: [],

    keywords: normalizeArray(
      parsed.keywords,
      14
    ),

    customizableOnly: false,

    description: cleanDisplayText(
      parsed.description,
      1000
    ),
  };
}

/* ======================================================
   OpenAI — analiză text
====================================================== */

async function analyzeTextIntent({
  query,
  context = "product-search",
}) {
  const response =
    await openai.responses.create({
      model: AI_MODEL,

      text: {
        format: {
          type: "json_object",
        },
      },

      input: [
        {
          role: "user",

          content: [
            {
              type: "input_text",

              text: `
Transformă cererea utilizatorului într-un set de criterii
pentru căutarea produselor handmade din Artfest.

Tipul fluxului:
${context}

Cererea utilizatorului:
${query}

Returnează exclusiv JSON valid, fără markdown.

Schema exactă:

{
  "productType": "",
  "category": "",
  "colors": [],
  "materials": [],
  "styles": [],
  "occasions": [],
  "recipientTags": [],
  "keywords": [],
  "customizableOnly": false
}

Reguli:

- Scrie termenii în limba română.
- Nu inventa prețuri sau produse.
- Extrage doar criterii susținute de cererea utilizatorului.
- productType trebuie să conțină tipul concret al produsului:
  de exemplu vază, lumânare, tablou, cercei, cană, geantă.
- Nu elimina din productType numele explicit al produsului.
- category trebuie să fie o categorie generală și scurtă.
- colors trebuie să conțină culorile menționate explicit.
- materials trebuie să conțină materialele concrete menționate.
- styles trebuie să conțină stilurile menționate:
  minimalist, rustic, modern, boho, tradițional etc.
- occasions trebuie să conțină ocaziile menționate:
  nuntă, aniversare, Crăciun, casă nouă etc.
- keywords trebuie să păstreze cuvintele importante din cererea originală.
- Include în keywords și termenul principal al produsului.
- Dacă utilizatorul cere un produs personalizat sau personalizabil,
  setează customizableOnly la true.
- Pentru recomandările de cadouri poți deduce stiluri și ocazii rezonabile.
- Nu deduce și nu include date sensibile despre persoană.
`,
            },
          ],
        },
      ],
    });

  const parsed = safeJsonParse(
    response.output_text
  );

  if (!parsed) {
    return {
      productType: "",
      category: "",
      colors: [],
      materials: [],
      styles: [],
      occasions: [],
      recipientTags: [],

      keywords: normalizeArray(
        String(query).split(/\s+/),
        12
      ),

      customizableOnly: false,
    };
  }

  return {
    productType: normalizeText(
      parsed.productType
    ),

    category: normalizeText(
      parsed.category
    ),

    colors: normalizeArray(
      parsed.colors,
      6
    ),

    materials: normalizeArray(
      parsed.materials,
      6
    ),

    styles: normalizeArray(
      parsed.styles,
      8
    ),

    occasions: normalizeArray(
      parsed.occasions,
      8
    ),

    recipientTags: normalizeArray(
      parsed.recipientTags,
      8
    ),

    keywords: normalizeArray(
      parsed.keywords,
      14
    ),

    customizableOnly:
      parsed.customizableOnly === true,
  };
}

/* ======================================================
   OpenAI — rafinare căutare
====================================================== */

async function analyzeRefinement({
  instruction,
  currentAnalysis,
  currentFilters,
}) {
  const response =
    await openai.responses.create({
      model: AI_MODEL,

      text: {
        format: {
          type: "json_object",
        },
      },

      input: [
        {
          role: "user",

          content: [
            {
              type: "input_text",

              text: `
Actualizează criteriile unei căutări de produse handmade
pe baza instrucțiunii utilizatorului.

Instrucțiunea:
${instruction}

Analiza curentă:
${JSON.stringify(
  currentAnalysis,
  null,
  2
)}

Filtrele curente:
${JSON.stringify(
  currentFilters,
  null,
  2
)}

Returnează exclusiv JSON valid, fără markdown.

Schema exactă:

{
  "message": "",
  "analysis": {
    "productType": "",
    "category": "",
    "colors": [],
    "materials": [],
    "styles": [],
    "occasions": [],
    "recipientTags": [],
    "keywords": [],
    "customizableOnly": false
  },
  "filters": {
    "minPriceCents": null,
    "maxPriceCents": null,
    "customizableOnly": false,
    "sort": "relevance"
  },
  "nextSuggestions": []
}

Reguli:

- Păstrează criteriile existente dacă instrucțiunea nu le modifică.
- „mai ieftine” și „arată-mi variante mai ieftine”
  trebuie să folosească sort = "price_asc".
- „mai premium” și „arată-mi produse mai premium”
  trebuie să folosească sort = "price_desc".
- „doar produse personalizabile”,
  „arată-mi produse personalizabile” și
  „arată-mi produse personalizate”
  setează customizableOnly = true atât în analysis,
  cât și în filters.
- „păstrează doar culorile” păstrează colors și golește
  category, materials, styles și keywords.
- „păstrează doar stilul” păstrează styles și golește
  category, colors, materials și keywords.
- „păstrează categoria” păstrează category și productType.
- „fără X” elimină X din criterii.
- Nu inventa produse sau prețuri.
- Răspunde în limba română.
`,
            },
          ],
        },
      ],
    });

  const parsed = safeJsonParse(
    response.output_text
  );

  if (!parsed) {
    throw createServiceError(
      "Instrucțiunea de rafinare nu a putut fi interpretată.",
      {
        code: "invalid_refinement",
        status: 422,
      }
    );
  }

  const parsedAnalysis =
    parsed.analysis || {};

  const parsedFilters =
    parsed.filters || {};

const analysis = {
  /*
   * Păstrăm contextul căutării.
   * Este important pentru recomandările de cadouri,
   * deoarece calculateSimilarity() aplică bonusuri
   * atunci când searchContext este "gift".
   */
  searchContext:
    currentAnalysis?.searchContext ||
    null,

  productType: normalizeText(
    parsedAnalysis.productType ??
      currentAnalysis?.productType
  ),

  category: normalizeText(
    parsedAnalysis.category ??
      currentAnalysis?.category
  ),

  colors: normalizeArray(
    parsedAnalysis.colors ??
      currentAnalysis?.colors,
    8
  ),

  materials: normalizeArray(
    parsedAnalysis.materials ??
      currentAnalysis?.materials,
    8
  ),

  styles: normalizeArray(
    parsedAnalysis.styles ??
      currentAnalysis?.styles,
    8
  ),

  occasions: normalizeArray(
    parsedAnalysis.occasions ??
      currentAnalysis?.occasions,
    8
  ),

  recipientTags: normalizeArray(
    parsedAnalysis.recipientTags ??
      currentAnalysis?.recipientTags,
    8
  ),

  keywords: normalizeArray(
    parsedAnalysis.keywords ??
      currentAnalysis?.keywords,
    14
  ),

  customizableOnly:
    parsedAnalysis.customizableOnly ===
      true ||
    currentAnalysis?.customizableOnly ===
      true,
};
  const allowedSorts = new Set([
    "relevance",
    "price_asc",
    "price_desc",
    "popular",
    "newest",
  ]);

  const requestedSort =
    normalizeText(parsedFilters.sort)
      .replaceAll(" ", "_");

  const filters = {
    minPriceCents:
      normalizeNullableInteger(
        parsedFilters.minPriceCents ??
          currentFilters?.minPriceCents
      ),

    maxPriceCents:
      normalizeNullableInteger(
        parsedFilters.maxPriceCents ??
          currentFilters?.maxPriceCents
      ),

    customizableOnly:
      parsedFilters.customizableOnly ===
        true ||
      analysis.customizableOnly === true,

    sort: allowedSorts.has(
      requestedSort
    )
      ? requestedSort
      : currentFilters?.sort ||
        "relevance",
  };

  return {
    message:
      cleanDisplayText(
        parsed.message,
        1000
      ) ||
      "Am rafinat rezultatele.",

    analysis,
    filters,

    nextSuggestions:
      normalizeArray(
        parsed.nextSuggestions,
        6
      ),
  };
}

/* ======================================================
   Scor de similaritate
====================================================== */

function buildProductText(product) {
  return normalizeText(
    [
      product.title,
      product.description,
      product.category,
      product.color,
      product.materialMain,
      product.technique,
      product.dimensions,
      product.specialNotes,
      product.careInstructions,
      ...(product.styleTags || []),
      ...(product.occasionTags || []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

const SEARCH_STOP_WORDS = new Set([
  "vreau",
  "caut",
  "cauta",
  "doresc",
  "as",
  "vrea",
  "un",
  "o",
  "unei",
  "unui",
  "pentru",
  "cu",
  "din",
  "de",
  "la",
  "si",
  "sau",
  "care",
  "sa",
  "fie",
  "ceva",
  "produs",
  "produse",
  "artfest",
]);

function tokenizeSearchText(value) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length >= 2 &&
        !SEARCH_STOP_WORDS.has(token)
    );
}
function mergeNormalizedTerms(
  ...collections
) {
  return Array.from(
    new Set(
      collections
        .flat()
        .map((value) =>
          normalizeText(value)
        )
        .filter(Boolean)
    )
  );
}

function getGiftProfile(
  profiles,
  value
) {
  const normalizedValue =
    normalizeText(value);

  const profile =
    profiles[normalizedValue];

  if (profile) {
    return profile;
  }

  return {
    recipientTags: [],
    occasions: [],
    styles: [],
    keywords: [],
  };
}

function enrichGiftAnalysis({
  analysis,
  recipient,
  occasion,
  notes = "",
}) {
  const normalizedRecipient =
    normalizeText(recipient);

  const normalizedOccasion =
    normalizeText(occasion);

  const recipientProfile =
    getGiftProfile(
      GIFT_RECIPIENT_PROFILES,
      normalizedRecipient
    );

  const occasionProfile =
    getGiftProfile(
      GIFT_OCCASION_PROFILES,
      normalizedOccasion
    );

  const noteKeywords =
    tokenizeSearchText(notes);

  return {
    ...analysis,

    searchContext: "gift",

    recipientTags:
      mergeNormalizedTerms(
        analysis?.recipientTags || [],
        [normalizedRecipient],
        recipientProfile.recipientTags ||
          []
      ),

    occasions:
      mergeNormalizedTerms(
        analysis?.occasions || [],
        [normalizedOccasion],
        occasionProfile.occasions ||
          []
      ),

    styles:
      mergeNormalizedTerms(
        analysis?.styles || [],
        recipientProfile.styles ||
          [],
        occasionProfile.styles ||
          []
      ),

    keywords:
      mergeNormalizedTerms(
        analysis?.keywords || [],
        recipientProfile.keywords ||
          [],
        occasionProfile.keywords ||
          [],
        noteKeywords
      ),
  };
}
function uniqueTerms(values = []) {
  return Array.from(
    new Set(
      values
        .flatMap((value) =>
          tokenizeSearchText(value)
        )
        .filter(Boolean)
    )
  );
}

function scoreTokenMatches(
  productText,
  terms,
  weight
) {
  const normalizedTerms =
    uniqueTerms(terms);

  if (!normalizedTerms.length) {
    return 0;
  }

  const matchedTerms =
    normalizedTerms.filter(
      (term) =>
        productText.includes(term)
    );

  return (
    matchedTerms.length /
    normalizedTerms.length
  ) * weight;
}

function scoreFieldMatch(
  fieldValue,
  terms,
  exactWeight,
  partialWeight
) {
  const field =
    normalizeText(fieldValue);

  const normalizedTerms =
    uniqueTerms(terms);

  if (
    !field ||
    !normalizedTerms.length
  ) {
    return 0;
  }

  if (
    normalizedTerms.some(
      (term) => field === term
    )
  ) {
    return exactWeight;
  }

  if (
    normalizedTerms.some(
      (term) =>
        field.includes(term) ||
        term.includes(field)
    )
  ) {
    return partialWeight;
  }

  return 0;
}

function calculateSimilarity(
  product,
  analysis,
  rawQuery = ""
) {
  const productText =
    buildProductText(product);

  const title =
    normalizeText(product.title);

  const normalizedQuery =
    normalizeText(rawQuery);

  const queryTokens =
    tokenizeSearchText(rawQuery);

  let score = 0;

  /*
   * Potrivire directă după numele produsului.
   */
  if (
    normalizedQuery &&
    title === normalizedQuery
  ) {
    score += 0.55;
  } else if (
    normalizedQuery &&
    title.includes(normalizedQuery)
  ) {
    score += 0.42;
  } else if (
    queryTokens.length
  ) {
    const titleMatches =
      queryTokens.filter(
        (token) =>
          title.includes(token)
      );

    score +=
      (titleMatches.length /
        queryTokens.length) *
      0.32;
  }

  /*
   * Tipul produsului.
   */
  if (analysis.productType) {
    const productType =
      normalizeText(
        analysis.productType
      );

    if (
      title.includes(productType)
    ) {
      score += 0.28;
    } else if (
      productText.includes(
        productType
      )
    ) {
      score += 0.16;
    }
  }

  /*
   * Categorie.
   */
  score += scoreFieldMatch(
    product.category,
    [analysis.category],
    0.22,
    0.12
  );

  /*
   * Culoare.
   */
  score += scoreFieldMatch(
    product.color,
    analysis.colors,
    0.14,
    0.09
  );

  /*
   * Material.
   */
  score += scoreFieldMatch(
    product.materialMain,
    analysis.materials,
    0.14,
    0.09
  );

  /*
   * Stil.
   */
  score += scoreTokenMatches(
    productText,
    analysis.styles || [],
    0.12
  );

  /*
   * Ocazie.
   */
  score += scoreTokenMatches(
    productText,
    analysis.occasions || [],
    0.08
  );

  /*
   * Destinatar.
   */
 score += scoreTokenMatches(
  productText,
  analysis.recipientTags || [],
  analysis.searchContext === "gift"
    ? 0.1
    : 0.04
);

  /*
   * Cuvinte-cheie extrase de AI.
   */
  score += scoreTokenMatches(
    productText,
    analysis.keywords || [],
    0.18
  );
if (
  analysis.searchContext === "gift"
) {
  const giftSuitabilityTerms = [
    "cadou",
    "personalizat",
    "personalizabil",
    "set",
    "ambalaj",
    "elegant",
    "decorativ",
    "handmade",
    "unicat",
    "special",
    "amintire",
  ];

  score += scoreTokenMatches(
    productText,
    giftSuitabilityTerms,
    0.08
  );

  const isCustomizable =
    product.acceptsCustom ===
      true ||
    product.orderMode ===
      "OPTIONS" ||
    product.orderMode ===
      "QUOTE_ONLY";

  if (isCustomizable) {
    score += 0.04;
  }
}
  /*
   * Fallback pe cererea originală.
   * Ajută când AI-ul nu extrage perfect criteriile.
   */
  score += scoreTokenMatches(
    productText,
    queryTokens,
    0.18
  );

  /*
   * Produse personalizabile.
   */
  if (
    analysis.customizableOnly
  ) {
    const isCustomizable =
      product.acceptsCustom ===
        true ||
      product.orderMode ===
        "OPTIONS" ||
      product.orderMode ===
        "QUOTE_ONLY";

    if (isCustomizable) {
      score += 0.1;
    } else {
      score -= 0.2;
    }
  }

  /*
   * Popularitatea nu intră în relevanță.
   * Este folosită doar la departajarea produselor.
   */
  return Math.max(
    0,
    Math.min(1, score)
  );
}

/* ======================================================
   Sortare și ranking
====================================================== */

function sortRankedProducts(
  rankedProducts,
  sort = "relevance"
) {
  const products =
    [...rankedProducts];

  switch (sort) {
    case "price_asc":
      return products.sort(
        (a, b) =>
          a.product.priceCents -
          b.product.priceCents
      );

    case "price_desc":
      return products.sort(
        (a, b) =>
          b.product.priceCents -
          a.product.priceCents
      );

    case "popular":
      return products.sort(
        (a, b) =>
          Number(
            b.product.popularityScore || 0
          ) -
          Number(
            a.product.popularityScore || 0
          )
      );

    case "newest":
      return products.sort(
        (a, b) =>
          new Date(
            b.product.createdAt
          ).getTime() -
          new Date(
            a.product.createdAt
          ).getTime()
      );

    case "relevance":
    default:
      return products.sort(
        (a, b) => {
          if (
            b.similarity !==
            a.similarity
          ) {
            return (
              b.similarity -
              a.similarity
            );
          }

          return (
            Number(
              b.product.popularityScore || 0
            ) -
            Number(
              a.product.popularityScore || 0
            )
          );
        }
      );
  }
}

function rankProducts(
  products,
  analysis,
  {
    minimumSimilarity = 0.12,
    sort = "relevance",
    rawQuery = "",
  } = {}
) {
  const ranked =
    products
      .map((product) => ({
        product,

        similarity:
          calculateSimilarity(
            product,
            analysis,
            rawQuery
          ),
      }))
      .filter(
        ({ similarity }) =>
          similarity >=
          minimumSimilarity
      );

  return sortRankedProducts(
    ranked,
    sort
  );
}

/* ======================================================
   Sugestii conversaționale
====================================================== */

function buildDefaultSuggestions(type) {
  if (type === "image") {
    return [
      "Păstrează doar culorile",
      "Păstrează doar stilul",
      "Doar produse personalizabile",
      "Mai ieftine",
    ];
  }

  if (type === "gift") {
    return [
      "Mai ieftine",
      "Mai premium",
      "Doar produse personalizabile",
      "Alt stil",
    ];
  }

  if (type === "budget") {
    return [
      "Doar produse personalizabile",
      "Cele mai populare",
      "Cele mai noi",
      "Altă categorie",
    ];
  }

  return [
    "Mai ieftine",
    "Mai premium",
    "Doar produse personalizabile",
    "Altă culoare",
  ];
}

/* ======================================================
   Construirea răspunsului
====================================================== */

function createSearchResponse({
  type,
  query = "",
  analysis,
  rankedProducts,
  filters = {},
  message = "",
  nextSuggestions = null,
  userId = null,
}) {
  const normalizedProducts =
    rankedProducts
      .slice(
        0,
        MAX_RETURNED_PRODUCTS
      )
      .map(
        ({
          product,
          similarity,
        }) =>
          normalizeProductForResponse(
            product,
            similarity
          )
      );

  const suggestions =
    Array.isArray(
      nextSuggestions
    ) &&
    nextSuggestions.length > 0
      ? nextSuggestions
      : buildDefaultSuggestions(
          type
        );

  const searchId = saveSearch({
    userId,
    type,
    query,
    analysis,
    filters,
    products:
      normalizedProducts,
    nextSuggestions:
      suggestions,
  });

  return {
    action: "SHOW_PRODUCTS",
    searchId,
    type,
    query,

    message:
      message ||
      `Am găsit ${rankedProducts.length} ${
        rankedProducts.length === 1
          ? "produs"
          : "produse"
      }.`,

    total:
      rankedProducts.length,

    analysis,
    filters,

    products:
      normalizedProducts,

    nextSuggestions:
      suggestions,
  };
}

function assertSearchAccess(
  search,
  userId
) {
  if (!search) {
    throw createServiceError(
      "Căutarea nu mai este disponibilă.",
      {
        code: "search_not_found",
        status: 404,
      }
    );
  }

  /*
   * Căutările guest au userId null și sunt accesibile
   * prin identificatorul aleatoriu searchId.
   */
  if (
    search.userId &&
    userId &&
    search.userId !== userId
  ) {
    throw createServiceError(
      "Nu ai acces la această căutare.",
      {
        code: "search_forbidden",
        status: 403,
      }
    );
  }
}

/* ======================================================
   EXPORT — căutare după fotografie
====================================================== */

export async function searchByImage({
  file,
  userId = null,
}) {
  const analysis =
    await analyzeImageIntent(file);

  const filters = {
    minPriceCents: null,
    maxPriceCents: null,
    customizableOnly: false,
    sort: "relevance",
  };

  const products =
    await getCatalogProducts(
      filters
    );

  const rankedProducts =
  rankProducts(
    products,
    analysis,
    {
      minimumSimilarity: 0.05,
      sort: filters.sort,
    }
  );

  return createSearchResponse({
    type: "image",
    analysis,
    rankedProducts,
    filters,
    userId,

    message:
      rankedProducts.length > 0
        ? "Am analizat fotografia și am găsit produse asemănătoare."
        : "Am analizat fotografia, dar nu am găsit produse suficient de apropiate.",
  });
}

/* ======================================================
   EXPORT — căutare textuală
====================================================== */

export async function searchByText({
  query,
  minPriceCents = null,
  maxPriceCents = null,
  customizableOnly = false,
  userId = null,
}) {
  const cleanedQuery =
    cleanDisplayText(
      query,
      1000
    );

  if (!cleanedQuery) {
    throw createServiceError(
      "Descrie produsul pe care îl cauți.",
      {
        code: "query_required",
        status: 400,
      }
    );
  }

  const budget =
    normalizeBudget({
      minPriceCents,
      maxPriceCents,
    });

  const analysis =
    await analyzeTextIntent({
      query: cleanedQuery,
      context: "product-search",
    });

  if (customizableOnly) {
    analysis.customizableOnly =
      true;
  }

  const filters = {
    ...budget,

    customizableOnly:
      analysis.customizableOnly,

    sort: "relevance",
  };

  const products =
    await getCatalogProducts(
      filters
    );

const rankedProducts =
  rankProducts(
    products,
    analysis,
    {
      minimumSimilarity: 0.12,
      sort: filters.sort,
      rawQuery: cleanedQuery,
    }
  );

  return createSearchResponse({
    type: "text",
    query: cleanedQuery,
    analysis,
    rankedProducts,
    filters,
    userId,

    message:
      rankedProducts.length > 0
        ? "Am găsit produse care se potrivesc descrierii tale."
        : "Nu am găsit produse potrivite pentru descrierea oferită.",
  });
}

/* ======================================================
   EXPORT — recomandări cadouri
====================================================== */

export async function recommendGifts({
  recipient,
  occasion,
  budgetLabel = "",
  minPriceCents = null,
  maxPriceCents = null,
  notes = "",
  userId = null,
}) {
  const cleanedRecipient =
    cleanDisplayText(
      recipient,
      160
    );

  const cleanedOccasion =
    cleanDisplayText(
      occasion,
      160
    );

  const cleanedNotes =
    cleanDisplayText(
      notes,
      1000
    );

  if (!cleanedRecipient) {
    throw createServiceError(
      "Spune pentru cine cauți cadoul.",
      {
        code: "recipient_required",
        status: 400,
      }
    );
  }

  if (!cleanedOccasion) {
    throw createServiceError(
      "Spune pentru ce ocazie este cadoul.",
      {
        code: "occasion_required",
        status: 400,
      }
    );
  }

  const budget =
    normalizeBudget({
      budgetLabel,
      minPriceCents,
      maxPriceCents,
    });

  const query = [
    `Cadou pentru: ${cleanedRecipient}`,
    `Ocazie: ${cleanedOccasion}`,

    cleanedNotes
      ? `Preferințe: ${cleanedNotes}`
      : "",
  ]
    .filter(Boolean)
    .join(". ");

 const baseAnalysis =
  await analyzeTextIntent({
    query,
    context:
      "gift-recommendations",
  });

const analysis =
  enrichGiftAnalysis({
    analysis: baseAnalysis,
    recipient:
      cleanedRecipient,
    occasion:
      cleanedOccasion,
    notes:
      cleanedNotes,
  });

  const filters = {
    ...budget,

    customizableOnly: false,
    sort: "relevance",

    recipient:
      cleanedRecipient,

    occasion:
      cleanedOccasion,

    notes:
      cleanedNotes,
  };

  const products =
    await getCatalogProducts(
      filters
    );

 const rankedProducts =
  rankProducts(
    products,
    analysis,
    {
      minimumSimilarity: 0.08,
      sort: filters.sort,
      rawQuery: query,
    }
  );

  return createSearchResponse({
    type: "gift",
    query,
    analysis,
    rankedProducts,
    filters,
    userId,

    message:
      rankedProducts.length > 0
        ? `Am pregătit câteva idei potrivite pentru ${cleanedRecipient.toLowerCase()}, pentru ${cleanedOccasion.toLowerCase()}.`
        : "Nu am găsit momentan recomandări potrivite.",
  });
}

/* ======================================================
   EXPORT — căutare după buget
====================================================== */

export async function searchByBudget({
  query = "",
  budgetLabel = "",
  minPriceCents = null,
  maxPriceCents = null,
  customizableOnly = false,
  userId = null,
}) {
  const budget =
    normalizeBudget({
      budgetLabel,
      minPriceCents,
      maxPriceCents,
    });

  if (
    budget.minPriceCents ===
      null &&
    budget.maxPriceCents ===
      null
  ) {
    throw createServiceError(
      "Trimite un buget sau un interval de preț valid.",
      {
        code: "budget_required",
        status: 400,
      }
    );
  }

  if (
    budget.minPriceCents !==
      null &&
    budget.maxPriceCents !==
      null &&
    budget.minPriceCents >
      budget.maxPriceCents
  ) {
    throw createServiceError(
      "Bugetul minim nu poate fi mai mare decât bugetul maxim.",
      {
        code: "invalid_budget",
        status: 400,
      }
    );
  }

  const cleanedQuery =
    cleanDisplayText(
      query,
      1000
    );

  const analysis =
    cleanedQuery
      ? await analyzeTextIntent({
          query:
            cleanedQuery,

          context:
            "budget-search",
        })
      : {
          productType: "",
          category: "",
          colors: [],
          materials: [],
          styles: [],
          occasions: [],
          recipientTags: [],
          keywords: [],
          customizableOnly,
        };

  if (customizableOnly) {
    analysis.customizableOnly =
      true;
  }

  const filters = {
    ...budget,

    customizableOnly:
      analysis.customizableOnly,

    sort: "relevance",
  };

  const products =
    await getCatalogProducts(
      filters
    );

const rankedProducts =
  cleanedQuery
    ? rankProducts(
        products,
        analysis,
        {
          minimumSimilarity: 0.08,
          sort: filters.sort,
          rawQuery: cleanedQuery,
        }
      )
    : products.map(
        (
          product,
          index
        ) => ({
          product,

          similarity:
            Math.max(
              0.01,
              0.2 -
                index * 0.001
            ),
        })
      );
  return createSearchResponse({
    type: "budget",
    query: cleanedQuery,
    analysis,
    rankedProducts,
    filters,
    userId,

    message:
      rankedProducts.length > 0
        ? "Am găsit produse care se încadrează în bugetul ales."
        : "Nu am găsit momentan produse în intervalul ales.",
  });
}

/* ======================================================
   EXPORT — rafinare
====================================================== */

export async function refineProductSearch({
  searchId,
  instruction,
  userId = null,
}) {
  const cleanedSearchId =
    cleanDisplayText(
      searchId,
      120
    );

  const cleanedInstruction =
    cleanDisplayText(
      instruction,
      1000
    );

  if (!cleanedSearchId) {
    throw createServiceError(
      "Identificatorul căutării lipsește.",
      {
        code: "search_id_required",
        status: 400,
      }
    );
  }

  if (!cleanedInstruction) {
    throw createServiceError(
      "Spune cum dorești să rafinezi rezultatele.",
      {
        code: "instruction_required",
        status: 400,
      }
    );
  }

  const current =
    readSearch(
      cleanedSearchId
    );

  assertSearchAccess(
    current,
    userId
  );

  const refinement =
    await analyzeRefinement({
      instruction:
        cleanedInstruction,

      currentAnalysis:
        current.analysis,

      currentFilters:
        current.filters,
    });

  const products =
    await getCatalogProducts(
      refinement.filters
    );

  const rankedProducts =
  rankProducts(
    products,
    refinement.analysis,
    {
      minimumSimilarity:
        current.type === "image"
          ? 0
          : 0.08,

      sort:
        refinement.filters.sort,

      rawQuery:
        current.type === "image"
          ? ""
          : current.query,
    }
  );

  const normalizedProducts =
    rankedProducts
      .slice(
        0,
        MAX_RETURNED_PRODUCTS
      )
      .map(
        ({
          product,
          similarity,
        }) =>
          normalizeProductForResponse(
            product,
            similarity
          )
      );

  const nextSuggestions =
    refinement
      .nextSuggestions
      ?.length
      ? refinement
          .nextSuggestions
      : buildDefaultSuggestions(
          current.type
        );

  updateSearch(
    cleanedSearchId,
    {
      query: [
        current.query,
        cleanedInstruction,
      ]
        .filter(Boolean)
        .join(" → "),

      analysis:
        refinement.analysis,

      filters:
        refinement.filters,

      products:
        normalizedProducts,

      nextSuggestions,
    }
  );

  return {
    action: "SHOW_PRODUCTS",

    searchId:
      cleanedSearchId,

    type:
      current.type,

    query: [
      current.query,
      cleanedInstruction,
    ]
      .filter(Boolean)
      .join(" → "),

    message:
      refinement.message,

    total:
      rankedProducts.length,

    analysis:
      refinement.analysis,

    filters:
      refinement.filters,

    products:
      normalizedProducts,

    nextSuggestions,
  };
}

/* ======================================================
   EXPORT — rezultate salvate
====================================================== */

export async function getSavedProductSearch({
  searchId,
  page = 1,
  limit = 24,
  userId = null,
}) {
  const cleanedSearchId =
    cleanDisplayText(
      searchId,
      120
    );

  const search =
    readSearch(
      cleanedSearchId
    );

  assertSearchAccess(
    search,
    userId
  );

  const normalizedPage =
    Math.max(
      1,
      Number(page) || 1
    );

  const normalizedLimit =
    Math.min(
      60,
      Math.max(
        1,
        Number(limit) || 24
      )
    );

  const start =
    (normalizedPage - 1) *
    normalizedLimit;

  const products =
    search.products.slice(
      start,
      start +
        normalizedLimit
    );

  return {
    action: "SHOW_PRODUCTS",

    searchId:
      cleanedSearchId,

    type:
      search.type,

    query:
      search.query,

    message:
      `Am încărcat ${search.products.length} ${
        search.products.length === 1
          ? "produs"
          : "produse"
      }.`,

    analysis:
      search.analysis,

    filters:
      search.filters,

    total:
      search.products.length,

    page:
      normalizedPage,

    limit:
      normalizedLimit,

    totalPages:
      Math.max(
        1,

        Math.ceil(
          search.products.length /
            normalizedLimit
        )
      ),

    products,

    nextSuggestions:
      search.nextSuggestions ||
      [],

    expiresAt:
      new Date(
        search.expiresAt
      ).toISOString(),
  };
}