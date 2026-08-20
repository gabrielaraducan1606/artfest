// src/ai/manifests/catalogImports.manifest.js

export const CATALOG_IMPORTS_MANIFEST = {
  id: "catalog-imports",

  title:
    "Import produse în catalog",

  audience: [
    "VENDOR",
    "ADMIN",
  ],

  available: true,

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