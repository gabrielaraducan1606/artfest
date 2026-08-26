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