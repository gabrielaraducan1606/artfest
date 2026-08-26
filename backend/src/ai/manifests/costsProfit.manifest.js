// backend/src/ai/manifests/costsProfit.manifest.js

export const COSTS_PROFIT_MANIFEST = {
  id: "costs-profit",

  title: "Costuri & Profit",

  audience: ["VENDOR"],

  /*
   * BUGFIX (generalizare USER/GUEST): unealta e strict VENDOR
   * (audience de mai sus rămâne neschimbat, folosit pentru
   * execuție), dar CONCEPTUL trebuie explicabil oricui întreabă
   * "cum funcționează Costuri & Profit?" - inclusiv unui viitor
   * vânzător neautentificat.
   */
  knowledgeAudience: ["VENDOR", "USER", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Bibliotecă de costuri reutilizabile (materiale/ambalaje/tarife), calculul de cost și preț recomandat per produs, profitabilitate, recalculare în masă, aplicare preț recomandat. Poate fi folosit atât din interfață, cât și conversațional prin Vendor Assistant (calculator de preț, editare bibliotecă de costuri, editare costing produs).",

  tags: [
    "cost",
    "profit",
    "pret recomandat",
    "calculator pret",
    "marja",
    "materiale",
    "biblioteca costuri",
    "comision",
  ],

  aliases: [
    "cum calculez pretul",
    "ce produse am sub cost",
    "cum adaug un cost in biblioteca",
    "cum aplic pretul recomandat",
    "cum recalculez produsele",
    "cum functioneaza costuri si profit",
    "ce este costuri si profit",
    "ce inseamna costuri si profit",
  ],

  uiLocations: [
    { audience: "VENDOR", path: "/vendor/costs-profit" },
    { audience: "VENDOR", path: "/vendor/costs-profit/library" },
    { audience: "VENDOR", path: "/vendor/costs-profit/:productId" },
  ],

  capabilities: {
    costItemLibrary: { available: true },
    productCosting: { available: true },
    priceRecommendation: { available: true },
    profitabilityOverview: { available: true },
    batchRecalculate: { available: true },
    applyRecommendedPrice: { available: true },
    conversationalCalculator: {
      available: true,
      notes: "Prin Vendor Assistant - calculator de preț, editare bibliotecă/costing conversațional.",
    },
    photoBasedCostDetection: {
      available: true,
      notes: "Analiză de fotografie pentru identificarea componentelor/materialelor.",
    },
  },

  limitations: [
    "Comisionul aplicat vine strict din planul de abonament activ al vendorului, nu poate fi editat manual în calculator.",
  ],

  flows: [
    {
      name: "calcul preț",
      steps: [
        "materiale + cantități",
        "manoperă (ore + tarif)",
        "ambalaj/alte costuri",
        "profit dorit",
        "preț recomandat calculat determinist",
      ],
    },
  ],

  integrations: {},

  endpoints: {
    productCosting: {
      method: "GET",
      path: "/api/vendor/products/:productId/costing",
      purpose: "Returnează costingul salvat al unui produs.",
      audience: ["VENDOR"],
    },

    profitability: {
      method: "GET",
      path: "/api/vendor/products/profitability",
      purpose: "Returnează profitabilitatea produselor vendorului.",
      audience: ["VENDOR"],
    },

    assistantCommand: {
      method: "POST",
      path: "/api/ai/assistant/command",
      purpose: "Comandă conversațională (Vendor Assistant) pentru costuri/produs.",
      audience: ["VENDOR"],
    },
  },

  faq: [
    {
      q: "Cum calculez prețul unui produs?",
      a: "Poți folosi calculatorul din Costuri & Profit, sau poți cere direct asistentului vendor: „Calculează prețul pentru produsul X” - te va întreba materialele, manopera și profitul dorit, apoi îți arată prețul recomandat.",
    },
    {
      q: "Ce produse am sub cost?",
      a: "Din Costuri & Profit poți filtra produsele cu preț sub prețul minim recomandat, sau poți întreba direct asistentul „Ce produse am sub cost?”.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: vendorCostProfitRoutes.js, vendorCostProfitAiRoutes.js, vendorAssistantCommandsRoutes.js/vendorAssistantCommandService.js, services/costProfitService.js. Modul deja cunoscut complet din sesiunile anterioare. Verificat 2026-08-24.",
};
