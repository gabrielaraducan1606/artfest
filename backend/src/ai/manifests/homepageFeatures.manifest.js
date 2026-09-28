// backend/src/ai/manifests/homepageFeatures.manifest.js

export const HOMEPAGE_FEATURES_MANIFEST = {
  id: "homepage-features",

  title: "Produsul zilei / Artizanul săptămânii (promovare homepage)",

  audience: ["VENDOR", "USER", "ADMIN"],

  knowledgeAudience: ["VENDOR", "USER", "ADMIN", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Sistemul de promovare pe homepage: Produsul zilei (rotație zilnică) și Artizanul săptămânii (rotație săptămânală). Selecția este făcută automat de platformă (calendar generat periodic) sau manual de echipa Artfest - vânzătorii NU se pot înscrie sau aplica pentru a fi selectați. Odată selectat, vendorul primește notificare și poate alege opțional o reducere proprie (0/5/10/15/20%), suportată integral de vendor, sau poate refuza/redeschide răspunsul. Artfest oferă promovarea, nu reducerea; la 0% promovarea rămâne activă la prețul normal.",

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
    "pot refuza produsul zilei",
    "pot refuza sa fiu artizanul saptamanii",
    "nu vreau sa fiu produsul zilei",
    "cat e reducerea totala maxima",
    "care e limita de discount la produsul zilei",

    /*
     * BATCH D (2026-09-07) - fraze LIVE ("sunt produsul zilei acum",
     * "ce promovări active am") nu sunt răspunse din acest FAQ static
     * (vezi vendorAssistantPromotions.js, copilotRouter.js) - alias-urile
     * de mai jos există STRICT ca să ancoreze retrieval-ul pe acest
     * manifest când răspunsul LIVE nu se potrivește (ex. întrebare
     * ambiguă) și userul cade pe explicația mecanismului.
     */
    "sunt produsul zilei acum",
    "ce promovari active am",
    "ce promovari viitoare am",
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

    /*
     * Audit 2026-09-28: Artfest nu mai contribuie la reducere -
     * vendorHomepageFeatureRoutes.js, buildFeaturePayload -
     * totalDiscountPercent = vendorDiscountPercent (doar dacă ACCEPTED).
     */
    totalDiscountCap: {
      available: true,
      notes:
        "Reducerea afișată clientului este exclusiv reducerea aleasă de tine (maxim 20%), suportată integral de tine. Artfest nu adaugă nicio reducere proprie.",
    },
  },

  limitations: [
    "Vânzătorii nu pot aplica sau solicita să fie selectați ca Produsul zilei / Artizanul săptămânii - selecția este automată (calendar generat de platformă) sau manuală, făcută de echipa Artfest.",
    "Artfest oferă doar promovarea, NU și reducerea. Vendorul poate alege opțional o reducere proprie din setul fix 0/5/10/15/20%, suportată integral de vendor; la 0% produsul/magazinul rămâne promovat la prețul normal.",
  ],

  flows: [
    {
      name: "Răspuns vendor la selecție",
      steps: [
        "Platforma selectează automat (rotație) sau manual un produs/serviciu pentru o perioadă (dateKey).",
        "Vendorul este notificat (in-app și, opțional, prin email).",
        "Vendorul poate seta o reducere proprie (suportată integral de vendor): 0, 5, 10, 15 sau 20%.",
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
      purpose: "Vendorul setează reducerea proprie, suportată integral de vendor (0/5/10/15/20%).",
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
      q: "Ce este produsul zilei?",
      a: "O secțiune de pe homepage-ul Artfest care afișează, prin rotație zilnică, un produs selectat automat de platformă sau manual de echipa Artfest - vânzătorii nu pot aplica pentru asta. Artfest oferă promovarea; vânzătorul poate alege opțional o reducere, suportată integral de el.",
    },
    {
      q: "Cum găsesc produsul zilei?",
      a: "Direct pe homepage-ul Artfest - e afișat public, într-o secțiune dedicată, vizibilă tuturor vizitatorilor, fără cont.",
    },
    {
      q: "Ce este artizanul săptămânii?",
      a: "La fel ca produsul zilei, dar cu rotație săptămânală și centrat pe un vânzător (nu un produs anume) - afișat public pe homepage, selectat automat sau manual de echipa Artfest.",
    },
    {
      q: "Cum găsesc artizanul săptămânii?",
      a: "Direct pe homepage-ul Artfest, într-o secțiune dedicată, vizibilă public, fără cont.",
    },
    {
      q: "Cum devin Produsul zilei / Artizanul săptămânii?",
      a: "Nu poți aplica direct. Selecția e făcută automat (rotație generată de platformă) sau manual de echipa Artfest. Când ești selectat, primești o notificare și poți alege opțional o reducere proprie (0-20%), suportată integral de tine.",
    },
    {
      q: "Ce reduceri pot seta?",
      a: "Doar când ești selectat pentru Produsul zilei sau Artizanul săptămânii, poți alege o reducere proprie din setul fix: 0%, 5%, 10%, 15% sau 20%, suportată integral de tine. Alegerea 0% înseamnă că nu oferi reducere - promovarea rămâne activă la prețul normal. Artfest nu oferă reducere proprie.",
    },
    {
      q: "Pot refuza produsul zilei?",
      a: "Nu poți refuza să fii selectat/afișat - odată ales, apari pe homepage indiferent. Ce POȚI face e să nu oferi reducere, setând-o la 0% (promovarea rămâne activă la prețul normal). Nu există o opțiune reală de „nu vreau să fiu Produsul zilei”.",
    },
    {
      q: "Cât e reducerea totală maximă?",
      a: "20% - reducerea este doar cea aleasă de tine (0/5/10/15/20%) și e suportată integral de tine. Artfest oferă promovarea, nu adaugă reducere.",
    },
    {
      q: "Primesc notificare când sunt ales produsul zilei?",
      a: "Da - când unul din produsele tale e selectat ca Produsul zilei, primești o notificare (in-app și, opțional, prin email), ca să poți alege opțional o reducere proprie.",
    },
    {
      q: "Primesc notificare când sunt artizanul săptămânii?",
      a: "Da - la fel ca la Produsul zilei, primești o notificare (in-app și, opțional, prin email) când ești selectat ca Artizanul săptămânii.",
    },
  ],

  unavailableFeatures: [
    "Aplicare/solicitare din partea vendorului pentru a fi selectat",
    "Reduceri procentuale libere (în afara setului fix 0/5/10/15/20%)",
  ],

  notes:
    "Sursă: vendorHomepageFeatureRoutes.js, adminHomepageFeatureRoutes.js, homepagePublicRoutes.js, model Prisma HomepageFeature. Pagina vendor 'Promovări' (VendorPromotions.jsx) folosește exclusiv endpoint-urile /api/vendor/homepage-features* - nu există un sistem separat de 'discount-uri' inițiate liber de vendor (acela e vendor-campaigns, deja acoperit de manifestul vendor-campaigns). Verificat 2026-08-24.",
};
