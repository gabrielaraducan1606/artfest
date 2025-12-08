// server/shared/search/smartSearchBackend.js
// Logică "deșteaptă" pentru interpretarea textului liber (română) în filtre de produse.

import { CATEGORIES_DETAILED } from "../constants/categories.js";
import { COLORS_DETAILED } from "../constants/colors.js";
import { OCCASION_TAGS_DETAILED } from "../constants/occasinsTags.js";
import { MATERIALS_DETAILED } from "../constants/materials.js";
import { STYLE_TAGS_DETAILED } from "../constants/stylesTags.js";
import { TECHNIQUES_DETAILED } from "../constants/tehniques.js";

// -------- util: normalizare text română --------
function normalizeText(str = "") {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // scoate diacritice
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]/gi, " ") // orice nu e literă/cifră devine spațiu
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- sinonime / normalizări frecvente ----------
const BASE_SYNONYMS = [
  // invitatie → invitatii (toate formele)
  { pattern: /\binvitatie(i|e|ilor|ile)?\b/g, token: "invitatii" },
  { pattern: /\binvitati(i|e|lor)?\b/g, token: "invitatii" },

  // marturie / marturii / martirii (typo) → marturii
  { pattern: /\bmarturie(i|e|lor)?\b/g, token: "marturii" },
  { pattern: /\bmartirii\b/g, token: "marturii" },

  // expresii frecvente invitații
  { pattern: /invitatii?\s+de\s+nunta/g, token: "invitatii nunta" },
  { pattern: /invitatii?\s+nunta/g, token: "invitatii nunta" },
  { pattern: /invitatii?\s+botez/g, token: "invitatii botez" },

  // ocazii
  { pattern: /\bnunta\b/g, token: "nunta" },
  { pattern: /\bbotez\b/g, token: "botez" },
  { pattern: /\blogodna\b/g, token: "logodna" },
  { pattern: /\bmajorat\b/g, token: "petrecere" },

  // lumânări / cadouri
  { pattern: /\blumanare(a|e|ilor|le)?\b/g, token: "lumanari" },
  { pattern: /\bcadou(ri)?\b/g, token: "cadouri" },

  // stiluri scrise cu spațiu
  { pattern: /\bboho chic\b/g, token: "boho" },
  { pattern: /\bshabby chic\b/g, token: "vintage" },
];

// ------------ sinonime extra pentru culori (peste COLOR_LABELS) ------------
const EXTRA_COLOR_SYNONYMS = {
  white: ["alb", "albe", "alba"],
  ivory: ["ivoire", "ivory"],
  cream: ["crem"],
  beige: ["bej"],

  grey_light: ["gri deschis"],
  grey_dark: ["gri inchis", "gri închis", "gri antracit"],
  black: ["negru", "negra", "negre"],

  brown_light: ["maro deschis"],
  brown: ["maro"],
  brown_dark: ["maro inchis", "maro închis"],
  taupe: ["taupe"],

  red: ["rosu", "roșu", "rosii"],
  burgundy: ["burgundy", "visiniu", "vișiniu", "bordo"],
  pink_light: ["roz deschis", "roz pal"],
  pink_dusty: ["roz pudra", "roz pudră", "prafuit"],
  pink_hot: ["roz aprins", "fucsia", "fuchsia"],

  lilac: ["lila", "lila deschis", "lavanda", "lavandă"],
  purple: ["mov", "purple"],

  yellow: ["galben"],
  mustard: ["mustar", "muștar"],
  orange: ["portocaliu", "oranj"],
  peach: ["piersica", "piersică", "somon"],

  blue_light: ["albastru deschis", "bleu", "baby blue"],
  blue: ["albastru"],
  blue_royal: ["albastru regal", "royal blue"],
  navy: ["bleumarin", "albastru marin"],
  turquoise: ["turcoaz"],
  teal: ["teal", "verde petrol"],

  green_light: ["verde deschis", "verde pastel"],
  green: ["verde"],
  green_olive: ["verde olive", "kaki", "khaki"],
  green_dark: ["verde inchis", "verde închis"],
  mint: ["verde menta", "verde mentă", "menta"],

  gold: ["auriu", "gold"],
  rose_gold: ["rose gold", "roz auriu"],
  silver: ["argintiu", "silver"],
  copper: ["cupru", "copper"],
  transparent: ["transparent", "incolor"],
  multicolor: ["multicolor", "colorat", "colorate"],
};

// Din paleta de culori + sinonime construim un set de cuvinte / expresii cheie pentru fiecare culoare.
const COLOR_KEYWORDS = COLORS_DETAILED.map(({ key, label }) => {
  const baseNorm = normalizeText(label); // ex: "Roz pudră" -> "roz pudra"
  const parts = baseNorm.split(" ").filter(Boolean);

  const extra = (EXTRA_COLOR_SYNONYMS[key] || []).map((s) =>
    normalizeText(s)
  );

  const words = new Set([baseNorm, ...parts, ...extra]);

  return {
    key,
    words: Array.from(words).filter(Boolean),
  };
});

// toate cuvintele care indică o culoare (folosit mai jos să nu le tratăm ca "mustTextTokens")
const COLOR_HINT_WORDS = new Set();
for (const ck of COLOR_KEYWORDS) {
  for (const w of ck.words) {
    if (!w) continue;
    const parts = w.split(" ");
    for (const part of parts) {
      if (part) COLOR_HINT_WORDS.add(part);
    }
  }
}

const CATEGORY_HINTS = [
  {
    tokens: ["invitatii", "nunta"],
    categoryPrefix: "papetarie_invitatii-nunta",
  },
  {
    tokens: ["invitatii", "botez"],
    categoryPrefix: "papetarie_invitatii-botez",
  },
  {
    tokens: ["marturii", "nunta"],
    categoryPrefix: "marturii_nunta",
  },
  {
    tokens: ["marturii", "botez"],
    categoryPrefix: "marturii_botez",
  },
  {
    tokens: ["lumanari", "parfumate"],
    categoryPrefix: "home_lumanari-parfumate",
  },
  {
    tokens: ["guest", "book"],
    categoryPrefix: "papetarie_guest-book",
  },
];

const OCCASION_HINTS = [
  { tokens: ["nunta"], occasion: "wedding" },
  { tokens: ["botez"], occasion: "baptism" },
  { tokens: ["logodna"], occasion: "engagement" },
  { tokens: ["zi", "nastere"], occasion: "birthday" },
  { tokens: ["aniversare"], occasion: "anniversary" },
  { tokens: ["craciun"], occasion: "christmas" },
  { tokens: ["paste"], occasion: "easter" },
];

// cuvinte de legătură (nu ajută la sens)
const STOP_WORDS = new Set([
  "de",
  "si",
  "sau",
  "cu",
  "pentru",
  "la",
  "in",
  "din",
  "pe",
  "cat",
  "foarte",
  "mai",
  "mult",
  "putin",
  "super",
  "mega",
  "ultra",
  "stil",
  "model",
  "tip",
  "lei",
  "ron",
]);

// cuvinte care în mod normal sunt indicii de filtre (categorie / ocazie)
const FILTER_HINT_WORDS = new Set([
  "invitatii",
  "invitatie",
  "nunta",
  "botez",
  "marturii",
  "cadouri",
  "cadou",
  "lumanari",
  "lumanare",
  "decor",
  "party",
  "set",
  "pahare",
  "pernuta",
  "cutie",
  "tablouri",
  "bijuterii",
  "florale",
  "flori",
  "aranjamente",
]);

function tokensIncludeAll(tokens, required) {
  return required.every((r) => tokens.includes(r));
}

/* CATEGORY din CATEGORIES_DETAILED */
function findCategoryFromTokens(tokens) {
  const normTokens = tokens.map((t) => normalizeText(t)).filter(Boolean);
  if (!normTokens.length) return null;

  const joined = ` ${normTokens.join(" ")} `;

  // 1) hints declarative → preferăm categoryPrefix
  for (const h of CATEGORY_HINTS) {
    if (tokensIncludeAll(normTokens, h.tokens)) {
      let best = null;

      for (const c of CATEGORIES_DETAILED) {
        const labelNorm = normalizeText(c.label);
        const keyNorm = normalizeText(c.key);

        let score = 0;

        if (c.key.startsWith(h.categoryPrefix)) {
          score += 5;
        }

        for (const tok of normTokens) {
          if (labelNorm.includes(tok)) score += 2;
          if (keyNorm.includes(tok)) score += 1;
        }

        if (score > 0 && (!best || score > best.score)) {
          best = { key: c.key, score };
        }
      }

      if (best) return best.key;
    }
  }

  // 2) scor general
  let best = null;

  for (const c of CATEGORIES_DETAILED) {
    const labelNorm = normalizeText(c.label);
    const keyNorm = normalizeText(c.key);

    let score = 0;

    for (const t of normTokens) {
      if (labelNorm.includes(t)) score += 2;
      if (keyNorm.includes(t)) score += 1;
    }

    if (labelNorm.includes("invitat") && joined.includes(" invitatii ")) {
      score += 1;
    }
    if (labelNorm.includes("nunta") && joined.includes(" nunta ")) {
      score += 1;
    }
    if (labelNorm.includes("botez") && joined.includes(" botez ")) {
      score += 1;
    }
    if (labelNorm.includes("marturii") && joined.includes(" marturii ")) {
      score += 1;
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { key: c.key, score };
    }
  }

  return best?.key || null;
}

/* COLORS – poate întoarce mai multe culori */
function findColorsFromTokens(tokens) {
  const normTokens = tokens.map((t) => normalizeText(t));
  const joined = ` ${normTokens.join(" ")} `;

  const matched = new Set();

  // 1) potrivire directă folosind COLOR_KEYWORDS (etichete + sinonime)
  for (const ck of COLOR_KEYWORDS) {
    const candidateWords = ck.words;
    const hit = candidateWords.some((w) => {
      if (!w) return false;
      if (w.includes(" ")) {
        return joined.includes(` ${w} `);
      }
      return normTokens.includes(w);
    });

    if (hit) {
      matched.add(ck.key);
    }
  }

  if (matched.size > 0) {
    return Array.from(matched);
  }

  // 2) fallback: scor pe label-uri
  let best = null;
  for (const c of COLORS_DETAILED) {
    const labelNorm = normalizeText(c.label);
    let score = 0;
    for (const t of normTokens) {
      if (labelNorm.includes(t)) score += 2;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { key: c.key, score };
    }
  }

  return best ? [best.key] : [];
}

/* OCCASION */
function findOccasionFromTokens(tokens) {
  const normTokens = tokens.map((t) => normalizeText(t));

  // 1) hints declarative
  for (const h of OCCASION_HINTS) {
    if (tokensIncludeAll(normTokens, h.tokens)) {
      const exists = OCCASION_TAGS_DETAILED.find(
        (o) => o.key === h.occasion
      );
      if (exists) return exists.key;
    }
  }

  // 2) scor general
  let best = null;
  for (const o of OCCASION_TAGS_DETAILED) {
    const labelNorm = normalizeText(o.label);
    let score = 0;
    for (const t of normTokens) {
      if (labelNorm.includes(t)) score += 2;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { key: o.key, score };
    }
  }

  return best?.key || null;
}

/* MATERIAL (hint) */
function findMaterialFromTokens(tokens) {
  const normTokens = tokens.map(normalizeText);
  let best = null;
  for (const m of MATERIALS_DETAILED) {
    const labelNorm = normalizeText(m.label);
    let score = 0;
    for (const t of normTokens) {
      if (labelNorm.includes(t)) score += 2;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { key: m.key, score };
    }
  }
  return best?.key || null;
}

/* TECHNIQUE (hint) */
function findTechniqueFromTokens(tokens) {
  const normTokens = tokens.map(normalizeText);
  let best = null;
  for (const tDef of TECHNIQUES_DETAILED) {
    const labelNorm = normalizeText(tDef.label);
    let score = 0;
    for (const t of normTokens) {
      if (labelNorm.includes(t)) score += 2;
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { key: tDef.key, score };
    }
  }
  return best?.key || null;
}

/* STYLE TAGS (poate fi mai multe) */
function findStyleTagsFromTokens(tokens) {
  const normTokens = tokens.map(normalizeText);
  const matched = new Set();

  for (const s of STYLE_TAGS_DETAILED) {
    const labelNorm = normalizeText(s.label);
    for (const t of normTokens) {
      if (labelNorm.includes(t)) {
        matched.add(s.key);
        break;
      }
    }
  }

  return Array.from(matched);
}

/* sinonime pe string normalizat */
function applyBaseSynonyms(normString) {
  let s = ` ${normString} `;
  for (const rule of BASE_SYNONYMS) {
    if (rule.pattern.test(s)) {
      s = s.replace(rule.pattern, ` ${rule.token} `);
    }
  }
  return s.trim().replace(/\s+/g, " ");
}

/* -----------------------------------------
   Funcția principală – folosită în ruta /products
------------------------------------------*/
export function smartSearchFromQueryBackend(qRaw) {
  const original = String(qRaw || "").trim();
  if (!original) {
    return {
      original,
      normalized: "",
      tokens: [],
      inferredCategory: null,
      inferredColor: null,
      inferredColors: [],
      inferredOccasionTag: null,
      inferredMaterial: null,
      inferredTechnique: null,
      inferredStyleTags: [],
      mustTextTokens: [],
      looseTextTokens: [],
    };
  }

  // 1) normalizare + sinonime
  let norm = normalizeText(original);
  norm = applyBaseSynonyms(norm);

  const tokens = norm.split(/\s+/).filter(Boolean);

  // 2) inferențe de filtre
  const inferredCategory = findCategoryFromTokens(tokens);
  const inferredColors = findColorsFromTokens(tokens);
  const inferredColor = inferredColors[0] || null;
  const inferredOccasionTag = findOccasionFromTokens(tokens);
  const inferredMaterial = findMaterialFromTokens(tokens);
  const inferredTechnique = findTechniqueFromTokens(tokens);
  const inferredStyleTags = findStyleTagsFromTokens(tokens);

  // 3) separam token-urile care sunt mai degrabă "filtre"
  const filterTokens = new Set(
    tokens.filter((t) => FILTER_HINT_WORDS.has(t))
  );

  // mustTextTokens: scoatem stop words, tokens de tip "hint" (categorie)
  // și – important – tokens care sunt pur de culoare (alb, albe, auriu...)
  let mustTextTokens = tokens.filter(
    (t) =>
      !STOP_WORDS.has(t) &&
      !filterTokens.has(t) &&
      t.length >= 3 &&
      !COLOR_HINT_WORDS.has(t)
  );

  // fallback: dacă nu avem nimic, măcar scoatem stop-words (și păstrăm inclusiv culorile & hint-urile)
  if (mustTextTokens.length === 0) {
    mustTextTokens = tokens.filter((t) => !STOP_WORDS.has(t));
  }

  // looseTextTokens = toate cuvintele (fără stop words),
  // utile pentru fallback sau match "mai relaxat"
  const looseTextTokens = tokens.filter(
    (t) => !STOP_WORDS.has(t)
  );

  return {
    original,
    normalized: norm,
    tokens,
    inferredCategory,
    inferredColor,
    inferredColors,
    inferredOccasionTag,
    inferredMaterial,
    inferredTechnique,
    inferredStyleTags,
    mustTextTokens,
    looseTextTokens,
  };
}
