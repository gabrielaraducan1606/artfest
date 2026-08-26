// backend/src/ai/manifests/reviews.manifest.js

export const REVIEWS_MANIFEST = {
  id: "reviews",

  title: "Recenzii și comentarii",

  audience: ["USER", "VENDOR"],

  available: true,
  status: "ACTIVE",

  description:
    "Recenzii pentru produse și magazine, plus comentarii pe produse.",

  tags: ["recenzie", "review", "comentariu", "evaluare"],

  aliases: [
    "cum las o recenzie",
    "cum raspund la o recenzie",
    "cum raportez o recenzie",
  ],

  uiLocations: [
    { audience: "USER", path: "nested în pagina de produs / cont" },
    { audience: "VENDOR", path: "nested în /produse" },
  ],

  capabilities: {
    productReviews: { available: true },
    storeReviews: { available: true },
    vendorReplyToReview: { available: true },
    reportReview: { available: true },
  },

  limitations: [],
  flows: [],
  integrations: {},

  endpoints: {
    productReviews: {
      method: "GET",
      path: "/api/products/:id/reviews",
      purpose: "Returnează recenziile unui produs.",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Cum las o recenzie?",
      a: "Poți lăsa o recenzie unui produs sau unui magazin, de regulă după ce ai cumpărat - din pagina produsului/magazinului sau din contul tău.",
    },
    {
      q: "Cum răspund la o recenzie?",
      a: "Ca vânzător, poți răspunde la recenziile primite direct din pagina produsului tău.",
    },
    {
      q: "Cum raportez o recenzie?",
      a: "Din recenzia respectivă ai opțiunea de a o raporta, dacă consideri că încalcă regulile.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: reviewsProductRoutes.js, reviewsStoreRoutes.js, commentProductRoutes.js. Verificat 2026-08-24.",
};
