// src/components/AIAssistant/Vendor/vendorIntent.js

export const VENDOR_INTENTS = {
  ADD_PRODUCT: "ADD_PRODUCT",
  EDIT_PRODUCT: "EDIT_PRODUCT",
  UPDATE_PRICE: "UPDATE_PRICE",
  UPDATE_STOCK: "UPDATE_STOCK",
  PRODUCT_HELP: "PRODUCT_HELP",
};

const INTENT_PATTERNS = [
  {
    type: VENDOR_INTENTS.ADD_PRODUCT,
    patterns: [
      "adauga produs",
      "adaug produs",
      "vreau sa adaug un produs",
      "vreau sa adaug produs",
      "produs nou",
      "creeaza produs",
      "creaza produs",
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

function normalize(text = "") {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectVendorIntent(text = "") {
  const normalized = normalize(text);

  for (const intent of INTENT_PATTERNS) {
    const found = intent.patterns.some((pattern) =>
      normalized.includes(normalize(pattern))
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