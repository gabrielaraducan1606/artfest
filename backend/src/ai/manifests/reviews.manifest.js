// backend/src/ai/manifests/reviews.manifest.js

export const REVIEWS_MANIFEST = {
  id: "reviews",

  title: "Recenzii și comentarii",

  /*
   * BUGFIX (audit GUEST, 2026-08-28): audience-ul controlează CINE
   * poate LĂSA o recenzie (necesită cont) - dar CITIREA recenziilor
   * e publică, verificat direct în cod (reviewsProductRoutes.js,
   * router.get("/public/product/:id/reviews", ...) NU are
   * authRequired). GUEST adăugat DOAR la knowledgeAudience, ca un
   * vizitator care întreabă "pot vedea recenziile?" să primească
   * răspunsul corect (da, poți citi, dar ai nevoie de cont ca să
   * lași una), nu "nu am informații".
   */
  audience: ["USER", "VENDOR"],
  knowledgeAudience: ["USER", "VENDOR", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Recenzii pentru produse și magazine, plus comentarii pe produse. Citirea recenziilor e publică (nu necesită cont) - a LĂSA o recenzie necesită cont autentificat.",

  tags: [
    "recenzie",
    "review",
    "comentariu",
    "evaluare",
    "recenzii publice",
    "rating produs",
  ],

  aliases: [
    "cum las o recenzie",
    "cum raspund la o recenzie",
    "cum raportez o recenzie",
    "pot vedea recenziile fara cont",
    "recenziile sunt publice",
    "trebuie cont ca sa citesc recenzii",
    "trebuie sa cumpar ca sa las recenzie",
    "recenzie verificata ce inseamna",
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

    publicReadAccess: {
      available: true,
      audience: ["GUEST"],

      notes:
        "Oricine poate citi recenziile unui produs/magazin, fără cont - endpoint-urile publice de citire nu cer autentificare.",
    },

    verifiedPurchaseBadge: {
      available: true,

      notes:
        "O recenzie primește automat un badge de 'verificat' dacă userul a avut o comandă PLĂTITĂ/FINALIZATĂ cu acel produs - dar cumpărarea produsului NU e o condiție obligatorie pentru a lăsa o recenzie, doar pentru badge.",
    },
  },

  limitations: [
    "Nu poți recenzia propriul produs (dacă ești vânzătorul lui).",
    "Limită de maximum 10 recenzii/24h per cont, ca protecție anti-spam.",
  ],

  flows: [],
  integrations: {},

  endpoints: {
    productReviewsPublic: {
      method: "GET",
      path: "/api/public/product/:id/reviews",
      purpose: "Returnează recenziile unui produs - public, fără autentificare.",
      audience: ["USER", "VENDOR", "GUEST"],
    },

    productReviewsAverage: {
      method: "GET",
      path: "/api/public/product/:id/reviews/average",
      purpose: "Returnează media notelor unui produs - public.",
      audience: ["USER", "VENDOR", "GUEST"],
    },

    createReview: {
      method: "POST",
      path: "/api/reviews",
      purpose: "Lasă o recenzie unui produs (cont necesar).",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Cum las o recenzie?",
      a: "Poți lăsa o recenzie unui produs sau unui magazin din pagina produsului/magazinului sau din contul tău - ai nevoie de un cont, dar NU e obligatoriu să fi cumpărat produsul (dacă ai cumpărat, recenzia primește automat un badge de 'verificat').",
    },
    {
      q: "Cum răspund la o recenzie?",
      a: "Ca vânzător, poți răspunde la recenziile primite direct din pagina produsului tău.",
    },
    {
      q: "Cum raportez o recenzie?",
      a: "Din recenzia respectivă ai opțiunea de a o raporta, dacă consideri că încalcă regulile.",
    },
    {
      q: "Pot vedea recenziile unui produs fără cont?",
      a: "Da - recenziile și rating-ul unui produs sunt vizibile public, fără să fii autentificat. Ai nevoie de cont doar dacă vrei chiar tu să lași o recenzie.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: reviewsProductRoutes.js, reviewsStoreRoutes.js, commentProductRoutes.js. Verificat 2026-08-24. Extins 2026-08-28 (audit GUEST): confirmat direct în cod - router.get('/public/product/:id/reviews', ...) și .../reviews/average NU au authRequired (citire publică); router.post('/reviews', authRequired, ...) - creare recenzie necesită cont, verifică isVendorOwnerOfProduct (blochează auto-recenzie) și rate-limit 10/24h; badge 'verificat' setat separat, din istoricul de comenzi PAID/FULFILLED al userului, nu e o condiție de blocare.",
};
