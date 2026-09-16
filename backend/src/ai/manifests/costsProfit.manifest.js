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

    /*
     * FINAL BATCH 3 (audit regression, 2026-09-07) - completate STRICT
     * pe fapte deja confirmate în cod/notes existente ale acestui
     * manifest (priceRecommendation = calcul determinist, NU AI real;
     * costItemLibrary = biblioteca de costuri reutilizabile).
     */
    {
      q: "Poate AI-ul să îmi recomande prețul?",
      a: "Nu prin AI/machine learning - prețul recomandat vine dintr-un calcul determinist (materiale + manoperă + ambalaj + profitul dorit), nu dintr-un model AI care „învață” sau „prezice” prețul. Rezultatul e previzibil și explicabil, nu o estimare probabilistică.",
    },
    {
      q: "Cum folosesc calculatorul de preț?",
      a: "Din Costuri & Profit, completezi materialele folosite (cu cantități), manopera (ore x tarif), ambalajul/alte costuri și profitul dorit - calculatorul îți dă prețul recomandat, determinist. Poți face asta și conversațional, cerând direct asistentului „Calculează prețul pentru produsul X”.",
    },
    {
      q: "Cum văd dacă un produs este profitabil?",
      a: "Din Costuri & Profit ai o privire de ansamblu asupra profitabilității produselor tale (preț vs. cost calculat) - poți filtra produsele sub prețul minim recomandat sau întreba direct asistentul „Ce produse am sub cost?”.",
    },
    {
      q: "Cum salvez costurile recurente (materiale, ambalaje, tarife)?",
      a: "Din biblioteca de costuri (Costuri & Profit) - adaugi o singură dată un cost (material, ambalaj, tarif) și îl reutilizezi la calculul prețului pentru orice produs, fără să-l retastezi de fiecare dată.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: vendorCostProfitRoutes.js, vendorCostProfitAiRoutes.js, vendorAssistantCommandsRoutes.js/vendorAssistantCommandService.js, services/costProfitService.js. Modul deja cunoscut complet din sesiunile anterioare. Verificat 2026-08-24.",
};
