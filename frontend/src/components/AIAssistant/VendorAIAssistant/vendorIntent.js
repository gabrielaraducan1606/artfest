// src/components/AIAssistant/Vendor/vendorIntent.js

import {
  normalizeForIntentDetection,
  isExplainIntentMessage,
} from "../explainIntent.js";

export const VENDOR_INTENTS = {
  ADD_PRODUCT: "ADD_PRODUCT",
  EDIT_PRODUCT: "EDIT_PRODUCT",
  UPDATE_PRICE: "UPDATE_PRICE",
  UPDATE_STOCK: "UPDATE_STOCK",
  PRODUCT_HELP: "PRODUCT_HELP",
};

/* =========================================================
   NAVIGARE VENDOR (audit - acțiuni/navigare pentru toate rolurile)

   Aceeași filozofie ca NAVIGATION din guestIntentTaxonomy.js -
   target semantic (nu URL), verb explicit de navigare + cuvânt-cheie
   de target, REZOLVAT la ruta reală prin assistantActionRegistry.js
   (VendorAssistant.jsx face rezolvarea, la fel cum face
   AiAssistant.jsx pentru GUEST/USER) - un singur registru central,
   nu o listă paralelă de rute.

   IMPORTANT: target-urile vendor înseamnă "ale MELE" (produsele mele,
   comenzile mele, magazinul meu) - diferit de NAVIGATION_TARGETS din
   guestIntentTaxonomy.js, unde "produse"/"comenzi" înseamnă catalogul
   public / comenzile cumpărătorului. De-aia e o listă SEPARATĂ, nu
   reutilizarea celei de GUEST/USER.
========================================================= */

const VENDOR_NAVIGATION_VERB_RE =
  /^(du ma|dute|mergi|navigheaza|deschide|vreau sa ajung)\b/;

/*
 * `allowArataVerb` - aceeași precauție ca la GUEST/USER: "arată-mi
 * produsele" e clar navigare (vrea să-și vadă catalogul), dar
 * "calculează prețul produsului X" NU trebuie confundat cu navigare
 * doar pentru că un target ambiguu s-ar potrivi din întâmplare -
 * calculatorul de preț rămâne accesibil prin "arată-mi"/"deschide",
 * NU prin verbe de comandă ("calculează"), care merg în continuare
 * la orchestratorul server-side, neatins.
 */
const VENDOR_NAVIGATION_TARGETS = [
  { re: /\bcomenzil?e?\b|\bcomand\w*/, target: "VENDOR_ORDERS", allowArataVerb: true },
  { re: /\bprodusele mele\b|\bprodusele\b/, target: "VENDOR_PRODUCTS", allowArataVerb: true },
  { re: /\bcampani\w*/, target: "VENDOR_CAMPAIGNS", allowArataVerb: true },
  { re: /\bpromov\w*/, target: "VENDOR_PROMOTIONS", allowArataVerb: true },
  {
    re: /\bcalculator\w*|\bcosturi\b|\bcosturi si profit\b|\bprofitabilitate\w*/,
    target: "VENDOR_PRICE_CALCULATOR",
    allowArataVerb: true,
  },
  { re: /\bbiblioteca de costuri\b/, target: "VENDOR_COST_LIBRARY", allowArataVerb: true },
  { re: /\bfactur\w*/, target: "VENDOR_INVOICES", allowArataVerb: true },
  { re: /\bmesaj\w*/, target: "VENDOR_MESSAGES", allowArataVerb: true },
  {
    re: /\bprofilul magazinului\b|\bmagazinul meu\b|\bprofil\b/,
    target: "VENDOR_STORE_PROFILE",
    allowArataVerb: true,
  },
  {
    re: /\bsetari(le)? de livrare\b|\bsetari\b/,
    target: "VENDOR_SETTINGS",
    allowArataVerb: true,
  },
  { re: /\bstatistici\w*|\bvizitatori\w*/, target: "VENDOR_STATS", allowArataVerb: true },
  { re: /\bdashboard\b|\bpanoul meu\b/, target: "VENDOR_DASHBOARD", allowArataVerb: true },
  { re: /\bnotificari\w*/, target: "VENDOR_NOTIFICATIONS", allowArataVerb: true },
  { re: /\bsuport\b/, target: "VENDOR_SUPPORT", allowArataVerb: true },
];

function matchVendorNavigationTarget(normalized) {
  for (const entry of VENDOR_NAVIGATION_TARGETS) {
    if (entry.re.test(normalized)) return entry;
  }
  return null;
}

/**
 * Determinist, fără LLM - analog cu regula "navigation-explicit" din
 * guestIntentTaxonomy.js, dar pe targeturi VENDOR. Întoarce
 * `{ target }` (o cheie din assistantActionRegistry.js) sau `null`.
 * NU e apelat pentru "adaugă produs" (rămâne pe detectVendorIntent -
 * VENDOR_INTENTS.ADD_PRODUCT, deschide wizard-ul, verificat separat
 * și cu prioritate mai mare în VendorAssistant.jsx).
 */
export function detectVendorNavigationTarget(text = "") {
  const normalized = normalizeForIntentDetection(text);

  if (!normalized) return null;
  if (isExplainIntentMessage(normalized)) return null;

  const matched = matchVendorNavigationTarget(normalized);
  if (!matched) return null;

  const hasCoreVerb = VENDOR_NAVIGATION_VERB_RE.test(normalized);

  if (hasCoreVerb) {
    return { target: matched.target };
  }

  if (matched.allowArataVerb && /\barata\w*\b/.test(normalized)) {
    return { target: matched.target };
  }

  return null;
}

/*
 * NU mai există aici detecție client-side de tip "e o
 * întrebare despre profitabilitate?" / "e o cerere de calcul
 * de preț?" (foste intents PRICE_CALCULATOR / COSTING_ASSISTANT,
 * bazate pe potrivire de cuvinte-cheie). S-au dovedit fragile
 * (ex: "lei pe gram" nu era acoperit de "lei/gram") și, mai
 * important, arhitectura corectă e ca ORCHESTRATORUL server-side
 * (POST /api/ai/assistant/command, cu clasificare prin LLM) să
 * decidă ce tip de comandă e un mesaj liber - nu un regex
 * client. Vezi handleCostingAssistantCommand din
 * VendorAssistant.jsx, care trimite acolo orice mesaj care nu
 * e ADD_PRODUCT și nu are o poză atașată.
 */

const INTENT_PATTERNS = [
  {
    type: VENDOR_INTENTS.ADD_PRODUCT,
    patterns: [
      "adauga produs",
      "adauga un produs",
      "adaug produs",
      "adaug un produs",
      "vreau sa adaug un produs",
      "vreau sa adaug produs",
      "produs nou",
      "creeaza produs",
      "creeaza un produs",
      "creaza produs",
      "creaza un produs",
      "publica produs",
      "public produs",
    ],
  },

  {
    type: VENDOR_INTENTS.EDIT_PRODUCT,
    patterns: [
      "editeaza produs",
      "editez produs",
      "modifica produs",
      "modific produs",
      "schimba produs",
    ],
  },

  {
    type: VENDOR_INTENTS.UPDATE_PRICE,
    patterns: [
      "modifica pret",
      "schimba pret",
      "actualizeaza pret",
      "pret produs",
      "pretul produsului",
    ],
  },

  {
    type: VENDOR_INTENTS.UPDATE_STOCK,
    patterns: [
      "actualizeaza stoc",
      "modifica stoc",
      "schimba stoc",
      "stoc produs",
      "cantitate produs",
    ],
  },

  {
    type: VENDOR_INTENTS.PRODUCT_HELP,
    patterns: [
      "ajutor produs",
      "ma ajuti cu un produs",
      "nu stiu cum sa adaug",
      "nu merge produsul",
      "am o problema cu produsul",
    ],
  },
];

/*
 * BUGFIX (raportat manual): "Cum adaug produse cu Shopify?" conține
 * substring-ul "adaug produs" (din "adaug produse") - matching-ul
 * de mai jos îl confunda cu o CERERE de adăugare și deschidea
 * wizard-ul, înainte ca mesajul să ajungă vreodată la copilot.
 * Aceeași problemă exista, latent, pentru ORICE întrebare
 * explicativă care conține din întâmplare un verb de acțiune -
 * "cum adaug", "cum șterg", "pot să modific" etc.
 *
 * Regula NU e specifică pentru "adaug"/Shopify - e generală, pe
 * FORMA propoziției: vezi explainIntent.js (comună cu AiAssistant.jsx,
 * ca să nu diveargă cele două widget-uri).
 */

export function detectVendorIntent(text = "") {
  const normalized = normalizeForIntentDetection(text);

  if (!normalized) return null;

  if (isExplainIntentMessage(normalized)) {
    return null;
  }

  for (const intent of INTENT_PATTERNS) {
    const found = intent.patterns.some((pattern) =>
      normalized.includes(normalizeForIntentDetection(pattern))
    );

    if (found) {
      return {
        type: intent.type,
        confidence: 1,
      };
    }
  }

  return null;
}

/* =========================================================
   Extragere nume produs dintr-un mesaj de tip
   "calculează prețul pentru X" / "cât mă costă Y"

   Best-effort, nu NLU real - dacă niciun tipar nu se
   potrivește, întoarce null și apelantul tratează cazul ca
   pe o cerere generică (fără nume de produs).
========================================================= */

const PRODUCT_NAME_PATTERNS = [
  /calculeaz[ăa](?:-mi)?\s+pre[țt]ul\s+(?:pentru\s+|produsului\s+)?(.+)/i,
  /verific[ăa]?\s+profitul\s+(?:produsului\s+|pentru\s+)?(.+)/i,
  /c[âa]t\s+m[ăa]\s+cost[ăa]\s+(?:produsul\s+)?(.+)/i,
  /c[âa]t\s+[îi]mi\s+r[ăa]m[âa]ne\s+(?:la\s+|pentru\s+|din\s+)?(.+)/i,
  /calculeaz[ăa]\s+costul\s+(?:pentru\s+|produsului\s+)?(.+)/i,
  /calculeaz[ăa]\s+profitul\s+(?:pentru\s+|produsului\s+)?(.+)/i,

  /*
   * EDIT_PRODUCT cu nume explicit - "modifică produsul X",
   * "editează produsul X". Fără nume după "produsul" (ex. "editează
   * produs", "vreau să modific un produs") -> nu se potrivește
   * niciun tipar, extractProductNameFromMessage întoarce null,
   * apelantul (VendorAssistant.jsx) arată selectorul de produse.
   */
  /edit(?:eaz[ăa])?\s+produsul\s+(.+)/i,
  /modific[ăa]?\s+produsul\s+(.+)/i,
  /schimb[ăa]?\s+produsul\s+(.+)/i,
];

export function extractProductNameFromMessage(
  text = ""
) {
  const raw = String(text || "").trim();

  for (const pattern of PRODUCT_NAME_PATTERNS) {
    const match = raw.match(pattern);

    if (match && match[1]) {
      const captured = match[1]
        .replace(/^["'„“]+|["'”“.,!?]+$/g, "")
        .trim();

      if (captured) {
        return captured;
      }
    }
  }

  return null;
}