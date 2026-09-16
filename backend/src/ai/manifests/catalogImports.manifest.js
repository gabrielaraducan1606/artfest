// src/ai/manifests/catalogImports.manifest.js

export const CATALOG_IMPORTS_MANIFEST = {
  id: "catalog-imports",

  title:
    "Import produse în catalog",

  audience: [
    "VENDOR",
    "ADMIN",
  ],

  knowledgeAudience: [
    "VENDOR",
    "ADMIN",
    "USER",
    "GUEST",
  ],

  available: true,

  /*
   * Câmpuri noi (schema comună a copilot-ului general) - pur
   * aditive, nu ating basePath/endpoints/features de mai jos,
   * care sunt sursa reală a path-urilor înregistrate în
   * vendorCatalogImportRoutes.js (getCatalogImportRoute).
   */
  status: "ACTIVE",

  tags: [
    "import",
    "export",
    "excel",
    "csv",
    "catalog",
    "produse in bulk",
    "shopify",
    "easysales",
    "woocommerce",
    "sincronizare",
  ],

  aliases: [
    "cum import produse",
    "cum adaug produse",
    "import din excel",
    "import din csv",
    "pot importa din shopify",
    "cum adaug produse cu shopify",
    "cum import produse din shopify",
    "pot importa din woocommerce",
    "cum adaug produse cu woocommerce",
    "pot importa din easysales",
    "cum adaug produse cu easysales",
    "cum import produse din easysales",
    "cum mut produsele din alt magazin",
    "cum mut produse din alt magazin",
    "adaug produse din alt magazin",
    "sincronizare produse",
    "cum sincronizez produsele",
    "export catalog",
    "ce fac daca importul da erori",
    "unde vad erorile din import",
    "pot reincerca produsele esuate",
    "pot descarca raportul de erori",
    "ce fac daca o coloana nu este recunoscuta",
    "importul a esuat",
    "randuri invalide la import",

    /*
     * BATCH F (audit regression Vendor Assistant, 2026-09-07).
     */
    "ce se intampla cu variantele la import",
    "importul recunoaste variante",
    "importul genereaza titlu cu ai",
    "importul genereaza descriere cu ai",
    "importul completeaza categoria automat",
    "exista imbunatatire automata a imaginilor",
    "exista enhance image",
    "cum calculez pretul produselor importate",
    "pot folosi biblioteca de costuri la import",
  ],

  uiLocations: [
    {
      audience: "VENDOR",
      path: "/vendor/catalog (tab Import)",
    },
  ],

  capabilities: {
    excelCsvImport: { available: true },
    previewBeforeImport: { available: true },
    catalogExport: { available: true },
    shopifyImport: { available: false, status: "PLANNED" },
    woocommerceImport: { available: false, status: "PLANNED" },
    easySalesImport: { available: false, status: "PLANNED" },
  },

  limitations: [
    "Imaginile nu se pot atașa direct în fișier - trebuie URL public.",
    "Fișierul maxim admis este 20MB.",
  ],

  unavailableFeatures: [
    "Import direct din Shopify",
    "Import direct din WooCommerce",
    "Import direct din EasySales",
  ],

  faq: [
    {
      q: "Pot importa produse din Shopify sau WooCommerce?",
      a: "Nu încă - integrarea este planificată, dar nu este disponibilă momentan. Poți importa oricând din Excel sau CSV.",
    },
    {
      q: "Cum adaug produse cu EasySales?",
      a: "Integrarea directă cu EasySales este planificată, dar nu este disponibilă momentan. Poți importa oricând produsele din Excel sau CSV.",
    },
    {
      q: "Cum mut produsele din alt magazin în Artfest?",
      a: "Momentan nu există o mutare/sincronizare automată dintr-un alt magazin (Shopify, WooCommerce, EasySales) - varianta disponibilă este exportul produselor tale într-un fișier Excel/CSV și importul lor în Artfest.",
    },
    {
      q: "Ce fac dacă importul dă erori?",
      a: "Nimic nu se pierde. La preview, fiecare rând primește un status: Gata (READY), Atenție (WARNING) sau Eroare (FAILED). Rândurile fără eroare se importă normal - cele cu eroare NU blochează restul, doar sunt excluse din acel lot. Poți vedea exact ce e greșit la fiecare rând, corecta fișierul sau doar reîncerca ulterior rândurile eșuate, fără să reiei tot importul de la zero.",
    },
    {
      q: "Unde văd erorile din import?",
      a: "Direct în ecranul de preview, la fiecare rând (mesajul exact de eroare/atenționare), sau descărcând raportul complet - un fișier Excel cu toate rândurile problematice, mesajele lor și datele originale, ca să le corectezi ușor.",
    },
    {
      q: "Pot reîncerca produsele eșuate?",
      a: "Da - există un buton dedicat care reia DOAR rândurile care au eșuat ultima dată, nu tot fișierul. Trebuie mai întâi să corectezi problema (fie în fișierul original, fie direct din ecranul de import, dacă e o eroare simplă).",
    },
    {
      q: "Pot descărca raportul de erori?",
      a: "Da - un fișier Excel (errors.xlsx) cu toate rândurile care au avut o problemă (eroare sau atenționare), numărul rândului, mesajul exact și datele respective, ca să le corectezi rapid și să reîncerci.",
    },
    {
      q: "Ce fac dacă o coloană nu este recunoscută?",
      a: "Nu e o eroare - la încărcarea fișierului, coloanele sunt asociate automat cu câmpurile Artfest (titlu, preț, categorie etc.); o coloană pe care sistemul n-o poate potrivi automat rămâne pur și simplu nemapată, iar tu poți s-o asociezi manual din ecranul de mapare înainte de preview. Singura coloană obligatorie e titlul produsului.",
    },
    {
      q: "Pot omite (skip) un rând din import?",
      a: "Da - poți marca explicit un rând ca omis, ca să nu fie luat în calcul nici la import, nici la rapoartele de erori ulterioare.",
    },
    {
      q: "Ce se întâmplă cu variantele la import?",
      a: "Coloana de variante este recunoscută la import, dar NU se transformă automat în opțiuni reale Artfest - primești o atenționare (warning, nu eroare) că variantele au fost identificate și trebuie configurate manual, din pagina produsului, după ce importul s-a încheiat. Dacă un produs e marcat pe modul „cu opțiuni” (OPTIONS) dar nu are variante identificate în fișier, primești tot o atenționare.",
    },
    {
      q: "Importul generează automat titlu sau descriere cu AI?",
      a: "Nu - la import, titlul și descrierea vin STRICT din coloanele fișierului tău (Excel/CSV), fără nicio generare sau completare automată prin AI. Titlul e singura coloană obligatorie.",
    },
    {
      q: "Importul completează automat categoria produsului?",
      a: "Nu la import - categoria vine tot din fișier, ca orice altă coloană. Există separat, în alt flux (AI Product Wizard, la crearea individuală a unui produs din poză), o funcție de sugerare a categoriei - dar e încă un prototip neconectat la un provider AI real (vezi manifestul products pentru detalii), nu ceva disponibil la import în masă.",
    },
    {
      q: "Există o funcție de îmbunătățire automată a imaginilor (enhance)?",
      a: "Nu - nu există nicio funcție de procesare/îmbunătățire automată a imaginilor, nici la import, nici altundeva în platformă. Imaginile se folosesc exact așa cum sunt la URL-ul furnizat.",
    },
    {
      q: "Cum calculez prețul produselor importate?",
      a: "Importul nu calculează automat prețuri sau costuri - prețul vine din fișier. Pentru calculul costului și al prețului recomandat per produs, folosești separat unealta Costuri & Profit, după import.",
    },
    /*
     * FINAL BATCH 3 (audit regression, 2026-09-07) - formulări directe
     * ale conținutului deja existent mai sus (nu conținut nou) -
     * necesare STRICT ca ancore de retrieval (Batch 1: faq[].q e
     * indexat), verificate ca fiind consistente cu FAQ-urile vecine.
     */
    {
      q: "Ce format trebuie să aibă fișierul Excel pentru import?",
      a: "Excel (.xlsx, .xls) sau CSV, maximum 20MB. Există un model de descărcat (buton „Descarcă șablonul”) cu 4 foi: Produse, Instrucțiuni, Ajutor imagini, Valori acceptate - singura coloană obligatorie e titlul produsului, restul se mapează automat sau manual la coloanele Artfest.",
    },
    {
      q: "Cum folosesc AI pentru categorie la import?",
      a: "Nu poți - la import, categoria vine STRICT din coloana fișierului tău, ca orice altă coloană, fără nicio sugestie sau completare automată prin AI. O funcție de sugerare a categoriei din poză există doar separat, în AI Product Wizard (la crearea individuală a unui produs), și e încă un prototip neconectat la un provider AI real.",
    },
    {
      q: "Cum folosesc AI pentru preț la import?",
      a: "Nu poți - importul nu calculează sau sugerează prețuri prin AI, prețul vine strict din fișier. Pentru calcul de preț recomandat, folosești separat, după import, unealta Costuri & Profit (calcul determinist, nu AI).",
    },
    {
      q: "AI-ul poate crea produsul pentru mine?",
      a: "Nu integral - AI Product Wizard te ghidează prin pașii de creare, dar analiza automată a fotografiei (categorie/culoare/material) nu e conectată la niciun provider AI real, întoarce mereu un rezultat gol. Titlul, descrierea, categoria și prețul trebuie completate manual de tine, fie la import (din fișier), fie la creare individuală.",
    },
    {
      q: "Pot folosi biblioteca de costuri la import?",
      a: "Nu direct în fluxul de import - biblioteca de costuri reutilizabile (materiale, ambalaje, tarife) face parte din Costuri & Profit și se aplică produselor individual, după ce au fost deja importate.",
    },
  ],

  notes:
    "Sursă: vendorCatalogImportRoutes.js (POST /:importId/preview - validează fiecare rând, status READY/WARNING/FAILED; POST /:importId/execute - importă doar READY/WARNING, exclude FAILED; PATCH /:importId/items/:itemId/skip; POST /:importId/retry-failed - reia STRICT rândurile FAILED, nu tot fișierul; GET /:importId/errors-report - genererază errors.xlsx cu toate rândurile problematice; GET /:importId/history - ultimele 50 importuri ale vendorului) + model Prisma ProductImportItem (rowNumber, rawData, normalizedData, status, warnings, errors). Verificat 2026-08-26.\n\nBATCH F (audit regression Vendor Assistant, 2026-09-07): verificat direct în cod, nu presupus. Variante: productImportService.js:1102-1106 - coloana e recunoscută (parsată la linia ~870-874), dar generează doar un WARNING (\"variantele au fost identificate, dar trebuie verificate înainte de transformarea lor în opțiuni Artfest\") - NU se generează optionsSchema/customSchema automat (comentariu explicit în cod, linia ~1108-1110, neschimbat față de auditul inițial). AI la import: grep exhaustiv (\"enhance\", \"ai.titl\", \"ai.descri\", \"generateTitle\", \"generateDescription\", \"openai\", \"\\bai\\b\") pe productImportService.js - ZERO rezultate; titlul/descrierea/prețul vin STRICT din coloanele fișierului. \"Enhance image\": grep pe tot backend/src (\"enhanceImage\", \"imageEnhance\") - ZERO rezultate, funcția nu există nicăieri în platformă, nu doar la import. Categorie sugerată de AI: există DOAR ca prototip separat, neconectat (analyzeProductImagesWithAi, src/lib/productAI.js - stub confirmat deja în Batch B, products.manifest.js), nu la import în masă - referit aici, nu duplicat. Calculator preț/bibliotecă costuri: strict costs-profit.manifest.js, aplicate per-produs după import, nu în fluxul de import - doar referite aici, nu duplicate.",

  basePath:
    "/api/vendor/catalog/imports",

  description:
    "Permite vânzătorilor să importe produse din Excel sau CSV, să verifice datele înainte de import și să exporte catalogul.",

  formats: [
    ".xlsx",
    ".xls",
    ".csv",
  ],

  limits: {
    maxFileSizeMb: 20,
  },

  flow: [
    "upload",
    "mapping",
    "preview",
    "execute",
  ],

  features: {
    automaticColumnDetection: true,
    manualMapping: true,
    previewBeforeImport: true,
    skipInvalidRows: true,
    importHistory: true,
    retryFailedRows: true,
    errorExcelReport: true,
    templateDownload: true,
    catalogExport: true,
    multipleStores: true,
  },

  images: {
    mode:
      "PUBLIC_URL",

    mainImageColumn:
      "image",

    galleryColumn:
      "images",

    multipleImagesSeparator:
      "|",

    localFilesSupportedInExcel:
      false,

    rules: [
      "Imaginile nu se atașează fizic în fișierul Excel.",

      "În coloana image se introduce URL-ul public al imaginii principale.",

      "În coloana images se introduc URL-urile imaginilor suplimentare.",

      "Mai multe imagini pot fi separate prin caracterul |.",

      "URL-ul trebuie să poată fi accesat public prin http:// sau https://.",

      "Folderul în care se află imaginea nu contează dacă URL-ul este public.",

      "Căile locale precum C:\\Users\\Ana\\Desktop\\poza.jpg nu pot fi accesate de Artfest.",

      "Dacă imaginile există doar pe telefon sau calculator, image și images pot fi lăsate goale.",

      "Imaginile pot fi adăugate ulterior în Artfest.",

      "Linkurile Google Drive sau Dropbox pot fi folosite numai dacă fișierul este accesibil public fără autentificare.",
    ],
  },

  template: {
    available: true,

    sheets: [
      "Produse",
      "Instrucțiuni",
      "Ajutor imagini",
      "Valori acceptate",
    ],
  },

  endpoints: {
    services: {
      method:
        "GET",

      path:
        "/services",

      purpose:
        "Listează magazinele disponibile pentru import.",
    },

    history: {
      method:
        "GET",

      path:
        "/",

      purpose:
        "Returnează istoricul importurilor.",
    },

    upload: {
      method:
        "POST",

      path:
        "/upload",

      purpose:
        "Încarcă și analizează fișierul Excel sau CSV.",
    },

    preview: {
      method:
        "POST",

      path:
        "/:importId/preview",

      purpose:
        "Normalizează și validează produsele înainte de import.",
    },

    execute: {
      method:
        "POST",

      path:
        "/:importId/execute",

      purpose:
        "Execută importul produselor validate.",
    },

    retryFailed: {
      method:
        "POST",

      path:
        "/:importId/retry-failed",

      purpose:
        "Reîncearcă produsele care au eșuat.",
    },

    template: {
      method:
        "GET",

      path:
        "/template",

      purpose:
        "Descarcă modelul Excel.",
    },

    export: {
      method:
        "GET",

      path:
        "/export",

      purpose:
        "Exportă produsele existente din Artfest într-un fișier Excel.",
    },

    errorsReport: {
      method:
        "GET",

      path:
        "/:importId/errors.xlsx",

      purpose:
        "Descarcă raportul Excel cu problemele importului.",
    },
    detail: {
  method: "GET",
  path: "/:importId",
  purpose:
    "Returnează detaliile unui import și rândurile sale.",
},

skipItem: {
  method: "PATCH",
  path: "/:importId/items/:itemId/skip",
  purpose:
    "Marchează un rând al importului ca omis și îl exclude din import.",
},
  },

  integrations: {
    easySales: {
      available: false,
      status:
        "PLANNED",
    },

    shopify: {
      available: false,
      status:
        "PLANNED",
    },

    woocommerce: {
      available: false,
      status:
        "PLANNED",
    },
  },
};

export function getCatalogImportRoute(
  key
) {
  const endpoint =
    CATALOG_IMPORTS_MANIFEST
      .endpoints[key];

  if (!endpoint) {
    throw new Error(
      `Unknown catalog import route: ${key}`
    );
  }

  return endpoint.path;
}

export function getCatalogImportFullRoute(
  key
) {
  const endpoint =
    CATALOG_IMPORTS_MANIFEST
      .endpoints[key];

  if (!endpoint) {
    throw new Error(
      `Unknown catalog import route: ${key}`
    );
  }

  const base =
    CATALOG_IMPORTS_MANIFEST
      .basePath.replace(
        /\/+$/,
        ""
      );

  const path =
    endpoint.path === "/"
      ? ""
      : endpoint.path;

  return `${base}${path}`;
}