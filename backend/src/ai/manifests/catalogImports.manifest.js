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
  ],

  notes:
    "Sursă: vendorCatalogImportRoutes.js (POST /:importId/preview - validează fiecare rând, status READY/WARNING/FAILED; POST /:importId/execute - importă doar READY/WARNING, exclude FAILED; PATCH /:importId/items/:itemId/skip; POST /:importId/retry-failed - reia STRICT rândurile FAILED, nu tot fișierul; GET /:importId/errors-report - genererază errors.xlsx cu toate rândurile problematice; GET /:importId/history - ultimele 50 importuri ale vendorului) + model Prisma ProductImportItem (rowNumber, rawData, normalizedData, status, warnings, errors). Verificat 2026-08-26.",

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