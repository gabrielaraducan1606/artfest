// backend/src/ai/manifests/vendorVisitors.manifest.js
//
// BATCH 2 (audit regression Vendor Assistant, 2026-09-06) - manifest nou.
// Domeniul "Statistici/performanță magazin" nu avea NICIUN manifest
// înainte de această etapă, deși vendorVisitorsRoutes.js (montat la
// /api/vendors/me/visitors) e complet funcțional - 0/15 PASS în audit.
//
// Sursă verificată direct în cod (2026-09-06):
// - backend/src/routes/vendorVisitorsRoutes.js (toate endpoint-urile,
//   protejate authRequired+requireRole("VENDOR")+attachVendor)
// - frontend, pagina reală: /vendor/visitors (assistantActionRegistry.js,
//   VENDOR_STATS)
//
// STRICT ce există (nu inventat):
// - /series: evoluție zilnică (vizitatori/vizualizări/CTA/mesaje) pe un
//   interval (implicit ultimele 30 de zile)
// - /kpi: totaluri pe interval - vizitatori (sesiuni unice cu PAGEVIEW),
//   urmăritori (ServiceFollow), vizualizări, click-uri CTA, mesaje,
//   rată de conversie (mesaje/CTA), defalcat și per magazin/serviciu
// - /top-pages: top 10 pagini după vizualizări (fiecare produs are URL
//   propriu /produs/:id, deci fiecare rând e deja per-produs)
// - /referrers: sursă de trafic (hostname din referrer, mapat pe
//   Google/Facebook/Instagram/Twitter-X/YouTube/Direct/altul), cu %
// - /searches: top 10 interogări de căutare internă care au dus la
//   acest magazin
// - /cta-performance: click-uri + conversii per etichetă de buton CTA
// - /realtime: sesiuni active în ultimele 5 minute
// - /meta: data creării contului de vânzător (limită naturală "de când
//   există date")
//
// STRICT ce NU există (nu inventat, nu presupus):
// - Nicio legătură cu comenzi/vânzări/câștiguri/stoc - acelea sunt
//   domenii separate (orders/costs-profit/products), NEATINSE aici.
// - Niciun istoric mai vechi decât data creării contului (/meta).
// - Niciun "cele mai puțin vizualizate produse" în pagina reală (doar
//   top 10 descrescător) - Vendor Assistant poate totuși răspunde la
//   asta LIVE, printr-o interogare separată (vezi
//   vendorAssistantAnalytics.js), nu prin manifest.
// - Nicio granularitate sub-zi (orară) în afară de /realtime (ultimele
//   5 minute).

export const VENDOR_VISITORS_MANIFEST = {
  id: "vendor-visitors",

  title: "Statistici / performanța magazinului",

  audience: ["VENDOR"],

  /*
   * La fel ca la costs-profit.manifest.js: unealta e strict VENDOR, dar
   * conceptul trebuie explicabil oricui întreabă "unde văd statisticile
   * magazinului meu" - inclusiv unui vizitator/cumpărător care ia în
   * calcul să devină vânzător.
   */
  knowledgeAudience: ["VENDOR", "USER", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Statistici de trafic ale magazinului: vizitatori, vizualizări de pagini/produse, surse de trafic, căutări interne care au dus la magazin, performanța butoanelor de acțiune (CTA) și sesiuni active în timp real.",

  tags: [
    "statistici",
    "performanta magazin",
    "vizitatori",
    "vizualizari",
    "trafic",
    "surse de trafic",
    "pagini populare",
    "produse vizualizate",
    "cautari interne",
    "sesiuni active",
  ],

  aliases: [
    "unde vad statisticile",
    "unde vad statisticile magazinului",
    "unde vad vizitatorii magazinului",
    "cum functioneaza statisticile",
    "ce inseamna vizualizarile",
    "ce inseamna vizitatorii unici",
    "ce pagini sunt cele mai vizitate",
    "de unde vin vizitatorii",
    "cum vad performanta magazinului",
    "cum vad traficul magazinului",
    "ce este pagina de vizitatori",
    "cate persoane mi-au vazut magazinul",
    "ce cautari au dus la magazinul meu",
    "cum vad cate persoane sunt acum pe magazin",
  ],

  uiLocations: [{ audience: "VENDOR", path: "/vendor/visitors" }],

  capabilities: {
    dailySeries: {
      available: true,
      notes:
        "Evoluție zilnică (vizitatori, vizualizări, click-uri CTA, mesaje) pe un interval ales, implicit ultimele 30 de zile.",
    },

    kpiSummary: {
      available: true,
      notes:
        "Totaluri pe interval: vizitatori unici, urmăritori, vizualizări, click-uri CTA, mesaje, rată de conversie (mesaje/CTA), defalcat pe fiecare serviciu/magazin al vânzătorului.",
    },

    topPages: {
      available: true,
      notes:
        "Top 10 pagini după vizualizări. Fiecare produs are propria pagină, deci apare individual, nu grupat pe categorie.",
    },

    leastViewedProducts: {
      available: true,
      liveOnly: true,
      notes:
        "Nu există în pagina de statistici (care arată doar top 10 descrescător), dar Vendor Assistant poate calcula live cele mai puțin vizualizate produse, la cerere.",
    },

    referrers: {
      available: true,
      notes:
        "Sursele de trafic (Google, Facebook, Instagram, Twitter/X, YouTube, Direct sau alt site), cu procentaj din total.",
    },

    internalSearches: {
      available: true,
      notes:
        "Top interogări de căutare internă (din platformă) care au dus vizitatori la acest magazin.",
    },

    ctaPerformance: {
      available: true,
      notes:
        "Click-uri și conversii (mesaje trimise) per etichetă de buton de acțiune (CTA) de pe pagina magazinului.",
    },

    realtimeActiveSessions: {
      available: true,
      notes:
        "Numărul de sesiuni active în ultimele 5 minute.",
    },
  },

  limitations: [
    "Statisticile pornesc de la data creării contului de vânzător - nu există date dinainte.",
    "Nu includ date despre comenzi, vânzări, câștiguri sau stoc - acelea se văd în alte secțiuni (Comenzi, Costuri & Profit).",
    "Pagina de statistici arată doar top 10 cele mai vizualizate pagini/produse (nu și un clasament complet sau invers, de la cele mai puțin vizualizate) - pentru asta poți întreba direct Vendor Assistant-ul.",
  ],

  flows: [],
  integrations: {},

  endpoints: {
    series: {
      method: "GET",
      path: "/api/vendors/me/visitors/series",
      purpose: "Evoluție zilnică pe interval (vizitatori/vizualizări/CTA/mesaje).",
      audience: ["VENDOR"],
    },
    kpi: {
      method: "GET",
      path: "/api/vendors/me/visitors/kpi",
      purpose: "Totaluri pe interval + defalcare per serviciu.",
      audience: ["VENDOR"],
      connectedToAssistant: true,
    },
    topPages: {
      method: "GET",
      path: "/api/vendors/me/visitors/top-pages",
      purpose: "Top 10 pagini după vizualizări.",
      audience: ["VENDOR"],
      connectedToAssistant: true,
    },
    referrers: {
      method: "GET",
      path: "/api/vendors/me/visitors/referrers",
      purpose: "Surse de trafic, cu procentaj.",
      audience: ["VENDOR"],
      connectedToAssistant: true,
    },
    searches: {
      method: "GET",
      path: "/api/vendors/me/visitors/searches",
      purpose: "Top căutări interne care au dus la acest magazin.",
      audience: ["VENDOR"],
    },
    ctaPerformance: {
      method: "GET",
      path: "/api/vendors/me/visitors/cta-performance",
      purpose: "Click-uri și conversii per etichetă CTA.",
      audience: ["VENDOR"],
    },
    realtime: {
      method: "GET",
      path: "/api/vendors/me/visitors/realtime",
      purpose: "Sesiuni active în ultimele 5 minute.",
      audience: ["VENDOR"],
    },
  },

  faq: [
    {
      q: "Unde văd statisticile magazinului meu?",
      a: "În secțiunea Statistici din contul de vânzător (/vendor/visitors), unde vezi vizitatori, vizualizări de pagini/produse, surse de trafic și performanța butoanelor de acțiune, pe un interval de timp ales.",
    },
    {
      q: "Unde văd vizitatorii magazinului?",
      a: "Tot în secțiunea Statistici - acolo vezi numărul de vizitatori unici (sesiuni distincte) pe zi și pe interval, alături de vizualizările totale de pagină.",
    },
    {
      q: "Cum funcționează statisticile?",
      a: "Fiecare vizită pe pagina magazinului sau a unui produs, fiecare click pe un buton de acțiune și fiecare mesaj trimis din pagina publică sunt înregistrate automat. Datele sunt agregate pe zi și pot fi filtrate pe un interval (implicit ultimele 30 de zile).",
    },
    {
      q: "Ce înseamnă vizualizările?",
      a: "O vizualizare este o încărcare a unei pagini din magazinul tău (profil sau pagină de produs) de către un vizitator. Vizitatorii unici sunt calculați separat, ca sesiuni distincte, nu ca număr de vizualizări.",
    },
    {
      q: "Ce pagini sunt cele mai vizitate?",
      a: "În Statistici există un clasament al primelor 10 pagini după numărul de vizualizări - fiecare produs apare individual, cu propriul URL, nu grupat pe categorie.",
    },
    {
      q: "De unde vin vizitatorii?",
      a: "Statisticile arată sursa de trafic pentru fiecare sesiune (Google, Facebook, Instagram, Twitter/X, YouTube, acces direct sau alt site), cu procentajul din total.",
    },
    {
      q: "Cum văd performanța magazinului?",
      a: "Secțiunea Statistici (/vendor/visitors) e locul central pentru performanța magazinului: vizitatori, vizualizări, surse de trafic, căutări interne care au dus la tine și rata de conversie a butoanelor de acțiune (CTA). Pentru performanța comenzilor/vânzărilor, acelea se văd separat, în secțiunile Comenzi și Costuri & Profit.",
    },
  ],

  unavailableFeatures: [
    "Date despre comenzi, vânzări sau câștiguri (acestea sunt în alte secțiuni, nu în Statistici).",
    "Istoric dinainte de data creării contului de vânzător.",
    "Clasament complet sau invers (cele mai puțin vizualizate) direct în pagina de Statistici - doar top 10 descrescător; pentru inversul acesta, întreabă direct Vendor Assistant-ul.",
  ],

  notes:
    "Sursă: backend/src/routes/vendorVisitorsRoutes.js (toate endpoint-urile, verificate direct 2026-09-06 - series/kpi/top-pages/referrers/searches/cta-performance/realtime/meta), montat la /api/vendors/me/visitors (server.js). Pagină reală: /vendor/visitors (assistantActionRegistry.js, VENDOR_STATS). LIVE DATA: kpi/top-pages/referrers conectate la Vendor Assistant printr-un serviciu subțire nou, backend/src/services/vendorAssistantAnalytics.js (reutilizează aceleași modele Prisma - Event, ServiceFollow - fără duplicare de logică de business), apelat din copilotRouter.js STRICT pentru audience VENDOR și STRICT pentru întrebări de trafic/vizite (detectVisitorAnalyticsTopic) - comenzi/câștiguri/stoc rămân, deliberat, neatinse în această etapă. searches/cta-performance/realtime/series/meta rămân doar STATIC knowledge (explicate aici), fără conectare live în acest batch.",
};
