// src/features/smartListing/smartListingMockAi.js
//
// DOAR PENTRU TESTE AUTOMATE. Nu e importat de nicio componentă a
// aplicației (formularul real folosește smartListingAiClient.js -> AI-ul
// existent). Răspunsurile de mai jos au EXACT forma întoarsă azi de POST
// /ai/product-analyze (backend/src/routes/aiRoutes.js), ca adaptorul
// proposalFromLegacyAnalysis() să fie exersat pe date realiste, inclusiv pe
// limitările integrării actuale (încredere doar globală, „multicolor”,
// „alte”, variante cu valori citite din imagine).

import { proposalFromLegacyAnalysis } from "./smartListingProposal.js";

export const MOCK_SCENARIOS = Object.freeze([
  { id: "candle", label: "Lumânare parfumată (încredere mare)" },
  { id: "tshirt", label: "Tricou personalizat cu mărimi (variante observate)" },
  { id: "unsure", label: "Fotografie neclară (încredere mică)" },
  { id: "error", label: "AI indisponibil (eroare)" },
]);

const RESPONSES = {
  candle: {
    title: "Lumânare parfumată din ceară de soia, în borcan de sticlă",
    description:
      "Lumânare parfumată turnată manual în borcan de sticlă transparentă, cu fitil din bumbac.\n\nPotrivită ca decor pentru living sau ca idee de cadou pentru o persoană dragă.",
    category: "home_lumanari-parfumate",
    suggestedAdditionalCategories: ["decor_lumanari-decor"],
    materialMain: "Ceară de soia",
    materialMainKey: "wax_soy",
    technique: "Turnare manuală",
    color: "cream",
    styleTags: ["Minimalist", "Rustic"],
    occasionTags: ["Zi de naștere", "Cadou casă nouă"],
    careInstructions: "Nu lăsa lumânarea aprinsă nesupravegheată.",
    specialNotes: "",
    visualProductType: "Lumânare în borcan",
    likelyOrderMode: "READY_TO_BUY",
    orderModeConfidence: 0.62,
    orderModeReason: "Pare un produs standard, dar eticheta menționează mai multe arome.",
    likelyOptions: [{ key: "aroma", label: "Aromă / parfum", type: "select", required: true, options: ["Lavandă", "Vanilie"] }],
    likelyCustomFields: [],
    questions: ["Ce greutate are lumânarea (g)?", "Câte ore arde aproximativ?"],
    confidence: 0.86,
    analysisVersion: "product-vision-v1",
  },
  tshirt: {
    title: "Tricou din bumbac personalizat cu nume, pentru familie",
    description:
      "Tricou cu imprimeu personalizat, potrivit pentru seturi de familie sau evenimente.\n\nTextul și numele pot fi adaptate la cererea clientului.",
    category: "textile_personalizare-imprimare",
    suggestedAdditionalCategories: [],
    materialMain: "Bumbac",
    materialMainKey: "fabric_cotton",
    technique: "Imprimare",
    color: "white",
    styleTags: ["Modern"],
    occasionTags: ["Zi de naștere"],
    careInstructions: "Spălare la 30°C, pe dos.",
    specialNotes: "",
    visualProductType: "Tricou cu imprimeu",
    likelyOrderMode: "OPTIONS",
    orderModeConfidence: 0.9,
    orderModeReason: "Pe tricou apare un nume, iar fotografia arată mai multe mărimi.",
    likelyOptions: [
      { key: "marime", label: "Mărime", type: "select", required: true, options: ["S", "M", "L", "XL"] },
      { key: "culoare", label: "Culoare", type: "select", required: true, options: ["Alb", "Negru"] },
    ],
    likelyCustomFields: [{ key: "nume", label: "Nume", type: "text", required: false }],
    questions: ["Ce mărimi ai disponibile?"],
    confidence: 0.81,
    analysisVersion: "product-vision-v1",
  },
  unsure: {
    title: "Obiect decorativ handmade",
    description: "Obiect decorativ realizat manual.",
    category: "alte",
    suggestedAdditionalCategories: [],
    materialMain: "",
    materialMainKey: "",
    technique: "",
    color: "multicolor",
    styleTags: [],
    occasionTags: [],
    careInstructions: "",
    specialNotes: "",
    visualProductType: "",
    likelyOrderMode: "READY_TO_BUY",
    orderModeConfidence: 0.3,
    orderModeReason: "",
    likelyOptions: [],
    likelyCustomFields: [],
    questions: ["Ce este produsul și din ce material este făcut?"],
    confidence: 0.38,
    analysisVersion: "product-vision-v1",
  },
};

/**
 * Simulează analiza. Întoarce rezultatul validat (validateProposal) sau
 * aruncă o eroare - interfața oferă atunci completarea manuală.
 */
export function analyzePhotosMock(images, { scenario = "candle", delayMs = 1200 } = {}) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (!Array.isArray(images) || !images.length) {
        reject(new Error("Adaugă cel puțin o fotografie."));
        return;
      }
      if (scenario === "error" || !RESPONSES[scenario]) {
        reject(new Error("Nu am putut analiza fotografiile acum."));
        return;
      }
      resolve(proposalFromLegacyAnalysis(RESPONSES[scenario]));
    }, delayMs);
  });
}

export const MOCK_LEGACY_RESPONSES = RESPONSES;
