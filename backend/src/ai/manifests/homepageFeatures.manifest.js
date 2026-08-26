// backend/src/ai/manifests/homepageFeatures.manifest.js

export const HOMEPAGE_FEATURES_MANIFEST = {
  id: "homepage-features",

  title: "Produsul zilei / Artizanul săptămânii (promovare homepage)",

  audience: ["VENDOR", "USER", "ADMIN"],

  knowledgeAudience: ["VENDOR", "USER", "ADMIN", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Sistemul de promovare pe homepage: Produsul zilei (rotație zilnică) și Artizanul săptămânii (rotație săptămânală). Selecția este făcută automat de platformă (calendar generat periodic) sau manual de echipa Artfest - vânzătorii NU se pot înscrie sau aplica pentru a fi selectați. Odată selectat, vendorul primește notificare și poate accepta opțional o reducere suplimentară (0/5/10/15/20%) pe lângă reducerea finanțată de platformă, sau poate refuza/redeschide răspunsul.",

  tags: [
    "produsul zilei",
    "artizanul saptamanii",
    "artizanul săptămânii",
    "homepage",
    "promovare homepage",
    "reducere",
    "discount",
    "promotii",
    "promoții",
  ],

  aliases: [
    "cum functioneaza produsul zilei",
    "cum devin artizanul saptamanii",
    "ce reduceri pot seta",
    "cum apar pe homepage",
  ],

  uiLocations: [
    { audience: "VENDOR", path: "/vendor/promovari" },
    { audience: "USER", path: "/ (homepage - secțiunile Produsul zilei / Artizanul săptămânii)" },
  ],

  capabilities: {
    vendorSelfApply: { available: false },
    automaticRotation: { available: true },
    manualAdminSelection: { available: true },
    vendorVoluntaryDiscountResponse: { available: true },
    vendorDeclineOrReopen: { available: true },
    vendorNotification: { available: true },
    publicDisplay: { available: true },
  },

  limitations: [
    "Vânzătorii nu pot aplica sau solicita să fie selectați ca Produsul zilei / Artizanul săptămânii - selecția este automată (calendar generat de platformă) sau manuală, făcută de echipa Artfest.",
    "Reducerea 'de bază' (platformDiscountPercent) este finanțată/decisă de platformă; vendorul poate doar adăuga opțional o reducere suplimentară proprie din setul fix 0/5/10/15/20%.",
  ],

  flows: [
    {
      name: "Răspuns vendor la selecție",
      steps: [
        "Platforma selectează automat (rotație) sau manual un produs/serviciu pentru o perioadă (dateKey).",
        "Vendorul este notificat (in-app și, opțional, prin email).",
        "Vendorul poate seta o reducere suplimentară proprie: 0, 5, 10, 15 sau 20%.",
        "0% = vendorDiscountStatus DECLINED; peste 0% = ACCEPTED.",
        "Vendorul poate redeschide (reopen) răspunsul dacă vrea să schimbe decizia, cât timp promovarea e încă activă.",
      ],
    },
  ],

  integrations: {},

  endpoints: {
    vendorList: {
      method: "GET",
      path: "/api/vendor/homepage-features",
      purpose: "Listează promovările (produs/artizan) asociate vendorului autentificat.",
      audience: ["VENDOR"],
    },
    vendorDetail: {
      method: "GET",
      path: "/api/vendor/homepage-features/:id",
      purpose: "Detaliile unei promovări a vendorului.",
      audience: ["VENDOR"],
    },
    vendorSetDiscount: {
      method: "PATCH",
      path: "/api/vendor/homepage-features/:id/discount",
      purpose: "Vendorul setează reducerea suplimentară proprie (0/5/10/15/20%).",
      audience: ["VENDOR"],
    },
    vendorReopen: {
      method: "PATCH",
      path: "/api/vendor/homepage-features/:id/reopen",
      purpose: "Vendorul redeschide răspunsul (poate schimba decizia anterioară).",
      audience: ["VENDOR"],
    },
    publicProductOfDay: {
      method: "GET",
      path: "/api/homepage/product-of-the-day",
      purpose: "Produsul zilei curent, afișat public pe homepage.",
      audience: ["USER"],
    },
    publicArtisanOfWeek: {
      method: "GET",
      path: "/api/homepage/artisan-of-the-week",
      purpose: "Artizanul săptămânii curent, afișat public pe homepage.",
      audience: ["USER"],
    },
    adminList: {
      method: "GET",
      path: "/api/admin/homepage-features",
      purpose: "Listează toate promovările homepage (admin).",
      audience: ["ADMIN"],
    },
    adminGenerate: {
      method: "POST",
      path: "/api/admin/homepage-features/generate",
      purpose: "Generează automat calendarul pentru perioadele lipsă (nu trimite notificări automat).",
      audience: ["ADMIN"],
    },
    adminCreateProductFeature: {
      method: "POST",
      path: "/api/admin/homepage-features/product",
      purpose: "Selectează manual un produs pentru Produsul zilei.",
      audience: ["ADMIN"],
    },
    adminCreateArtisanFeature: {
      method: "POST",
      path: "/api/admin/homepage-features/artisan",
      purpose: "Selectează manual un vendor pentru Artizanul săptămânii.",
      audience: ["ADMIN"],
    },
  },

  faq: [
    {
      q: "Cum devin Produsul zilei / Artizanul săptămânii?",
      a: "Nu poți aplica direct. Selecția e făcută automat (rotație generată de platformă) sau manual de echipa Artfest. Când ești selectat, primești o notificare și poți alege opțional o reducere suplimentară (0-20%).",
    },
    {
      q: "Ce reduceri pot seta?",
      a: "Doar când ești selectat pentru Produsul zilei sau Artizanul săptămânii, poți alege o reducere suplimentară proprie din setul fix: 0%, 5%, 10%, 15% sau 20%. Alegerea 0% înseamnă că refuzi reducerea suplimentară (rămâi doar cu reducerea platformei, dacă există una).",
    },
  ],

  unavailableFeatures: [
    "Aplicare/solicitare din partea vendorului pentru a fi selectat",
    "Reduceri procentuale libere (în afara setului fix 0/5/10/15/20%)",
  ],

  notes:
    "Sursă: vendorHomepageFeatureRoutes.js, adminHomepageFeatureRoutes.js, homepagePublicRoutes.js, model Prisma HomepageFeature. Pagina vendor 'Promovări' (VendorPromotions.jsx) folosește exclusiv endpoint-urile /api/vendor/homepage-features* - nu există un sistem separat de 'discount-uri' inițiate liber de vendor (acela e vendor-campaigns, deja acoperit de manifestul vendor-campaigns). Verificat 2026-08-24.",
};
