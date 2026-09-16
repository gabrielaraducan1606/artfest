// src/ai/manifests/catalogProducts.manifest.js

export const CATALOG_PRODUCTS_MANIFEST = {
  id: "catalog-products",

  title:
    "Administrare produse catalog",

  audience: [
    "VENDOR",
    "ADMIN",
  ],

  /*
   * BATCH B (audit regression Vendor Assistant, 2026-09-07) - BUGFIX
   * găsit în auditul inițial (WEAK_RETRIEVAL sistemic): manifestul nu
   * avea `knowledgeAudience`, deci era complet invizibil la retrieval
   * pentru orice audience diferit de VENDOR/ADMIN - un GUEST/USER care
   * întreba "Unde își vede vânzătorul produsele?" sau similar primea
   * "nu am informații". La fel ca la messages.manifest.js/
   * costsProfit.manifest.js, `audience` rămâne strict pentru execuție,
   * `knowledgeAudience` extinde DOAR cine poate GĂSI/CITI despre asta.
   */
  knowledgeAudience: ["VENDOR", "ADMIN", "USER", "GUEST"],

  available: true,

  status: "ACTIVE",

  tags: [
    "catalog",
    "produse",
    "bulk",
    "activare",
    "dezactivare",
    "pret",
    "categorie",
    "duplicare produs",
    "produse ascunse",
    "produse inactive",
    "stergere produs",
    "import produse",
    "recomandari produse",
  ],

  aliases: [
    "cum administrez produsele",
    "schimb pretul la mai multe produse",
    "activez mai multe produse odata",
    "duplic un produs",

    /*
     * BATCH B (2026-09-07) - țintă directă pentru retrieval, nu doar
     * tags/aliases generice (manifestul nu avea deloc FAQ înainte).
     */
    "unde vad produsele mele",
    "unde imi vad produsele",
    "cum vad toate produsele",
    "diferenta dintre import si catalog",
    "diferenta intre a importa produse si a le administra din catalog",
    "ce produse sunt ascunse",
    "ce produse sunt inactive",
    "cum sterg un produs",
    "pot sterge un produs",
    "cum sterg mai multe produse odata",
    "ce imi recomanzi sa modific la produse",
    "ce produse ar trebui sa imbunatatesc",
    "ce produse au probleme",
  ],

  uiLocations: [
    {
      audience: "VENDOR",
      path: "/vendor/catalog",
    },
  ],

  capabilities: {
    bulkActivateDeactivate: { available: true },
    bulkDelete: { available: true },
    bulkPrice: { available: true },
    bulkCategory: { available: true },
    duplicateProduct: { available: true },
    bulkVariants: { available: false, status: "PLANNED" },
  },

  limitations: [
    "Modificarea în masă a variantelor nu este disponibilă încă - variantele se editează per produs.",
  ],

  unavailableFeatures: [
    "Editare în masă a variantelor de produs",
  ],

  faq: [
    {
      q: "Unde văd produsele mele?",
      a: "În secțiunea Catalog din contul de vânzător (/vendor/catalog) - acolo vezi toate produsele tale, din toate magazinele, cu opțiuni de căutare și filtrare după status sau mod de comandă.",
    },
    {
      q: "Cum folosesc catalogul de produse?",
      a: "Catalogul (/vendor/catalog) e locul unde vezi și administrezi toate produsele tale existente - căutare, filtrare după status/mod de comandă, activare/dezactivare/ștergere/schimbare preț sau categorie în masă, sau duplicare. Editarea completă a unui produs individual se face separat, din pagina lui.",
    },
    {
      q: "Cum administrez produsele?",
      a: "Din /vendor/catalog poți activa/dezactiva, șterge, schimba prețul sau categoria pentru mai multe produse simultan (selecție în masă), sau poți duplica un produs existent ca punct de plecare pentru unul nou. Editarea detaliată (titlu, descriere, imagini, variante) se face per produs.",
    },
    {
      q: "Care e diferența dintre import și catalog?",
      a: "Importul (Excel/CSV) e modul de a ADUCE produse noi în platformă, dintr-un fișier. Catalogul (/vendor/catalog) e locul unde vezi și administrezi produsele deja existente în magazinul tău, indiferent cum au fost create (manual sau prin import).",
    },
    {
      q: "Ce produse sunt ascunse sau inactive?",
      a: "Asta ține de fiecare produs în parte (dezactivat = isActive fals, ascuns = isHidden adevărat) - pot fi văzute filtrând lista din /vendor/catalog după status. Vendor Assistant îți poate arăta live câte produse ai în această situație, dacă întrebi \"Ce îmi recomanzi să modific la produse?\" sau \"Am produse ascunse?\".",
    },
    {
      q: "Cum șterg un produs?",
      a: "Din /vendor/catalog - selectezi produsul (sau mai multe, pentru ștergere în masă) și alegi opțiunea de ștergere. E o acțiune permanentă, diferită de dezactivare/ascundere (care păstrează produsul, doar îl fac invizibil clienților).",
    },
    {
      q: "Ce îmi recomanzi să modific la produse?",
      a: "Asta e o informație LIVE, calculată din produsele tale reale (fără costing, sub prețul minim, fără stoc, ascunse/inactive, sau cu listare incompletă - fără descriere suficientă, prea puține imagini sau fără categorie) - întreabă-mă direct \"Ce îmi recomanzi să modific la produse?\" ca să văd situația ta curentă, nu pot da un răspuns general aici.",
    },

    /*
     * FINAL BATCH 3 (audit regression, 2026-09-07) - 3 formulări
     * "Poate AI-ul..." identificate în audit ca AMBIGUOUS_USER_QUESTION
     * (pot fi interpretate fie ca întrebare statică despre capacități,
     * fie ca o cerere de analiză LIVE a catalogului propriu). Regula
     * cerută: cererile de analiză a catalogului PROPRIU sunt date LIVE
     * (VENDOR_INSIGHTS), NU cunoștințe generice - aceste 3 intrări
     * clarifică asta explicit și redirecționează exact ca FAQ-ul de
     * mai sus, ca fallback dacă mesajul ajunge totuși aici (nu am
     * schimbat clasificatorul/routing-ul în acest batch).
     */
    {
      q: "Poate AI-ul să îmi analizeze catalogul?",
      a: "Da, dar nu ca „AI generic” - Vendor Assistant îți poate calcula LIVE, din produsele tale reale, ce ar trebui verificat (fără costing, sub prețul minim, fără stoc, ascunse/inactive sau cu listare incompletă). Întreabă-mă direct \"Ce îmi recomanzi să modific la produse?\" ca să văd situația ta curentă - nu pot da un răspuns general aici, fără să mă uit la datele tale.",
    },
    {
      q: "Poate AI-ul să îmi spună ce produse au probleme?",
      a: "Da - e o informație LIVE, nu una generică. Întreabă-mă direct \"Am produse cu probleme?\" sau \"Ce produse ar trebui să îmbunătățesc?\" ca să calculez din produsele tale reale (fără costing, sub prețul minim, fără stoc, ascunse/inactive, listare incompletă).",
    },
    {
      q: "Poate AI-ul să îmi spună ce produse nu au stoc?",
      a: "Da - e o informație LIVE, calculată din produsele tale reale. Întreabă-mă direct \"Ce produse nu au stoc?\" ca să văd situația ta curentă, nu pot da un răspuns general aici.",
    },
  ],

  notes:
    "Sursă: vendorCatalogProductsRoutes.js + acest manifest. Verificat 2026-08-24. Extins BATCH B (audit regression Vendor Assistant, 2026-09-07): adăugat knowledgeAudience (lipsea, cauza WEAK_RETRIEVAL confirmat în auditul inițial) + FAQ complet (manifestul avea faq:[] gol). \"Ce îmi recomanzi să modific la produse?\" e acum LIVE DATA reală, NU acest FAQ generic - vezi insightsService.js (BATCH B): două insight-uri noi, PRODUCT_HIDDEN_OR_INACTIVE (Product.isActive/isHidden) și PRODUCT_INCOMPLETE_LISTING (Product.description sub 20 caractere, Product.images sub 2, sau Product.category lipsă - praguri simple, documentate în cod, NU un scor compus), alături de cele deja existente (PRODUCT_NO_COSTING/PRODUCT_BELOW_MIN_PRICE/PRODUCT_NEEDS_RECALCULATION din costsProfit, PRODUCT_OUT_OF_STOCK) - toate expuse prin categoria VENDOR_INSIGHTS deja funcțională (copilotRouter.js, handleVendorInsightsQuery), NU un tool nou/paralel. Verificat pe date reale (vendor de test): 16/18 produse cu listare incompletă, 0 ascunse/inactive - insight-urile se generează corect. NU am adăugat un insight pentru leadTimeDays/availability generic - fără o interpretare clară de \"problemă\" în schema reală (ar fi presupunere, nu fapt verificabil).",

  basePath:
    "/api/vendor/catalog/products",

  description:
    "Permite vânzătorului să vadă și să administreze produsele din toate magazinele sale.",

  features: {
    listProducts: true,

    searchProducts: true,

    filterByStatus: true,

    filterByOrderMode: true,

    bulkActivate: true,

    bulkDeactivate: true,

    bulkDelete: true,

    bulkPrice: true,

    bulkCategory: true,

    duplicateProduct: true,

    /*
     * Variantele sunt structurate.
     * Modificarea bulk a variantelor
     * o vom face separat.
     */
    bulkVariants: false,
  },

  endpoints: {
    list: {
      method: "GET",

      path: "/",

      purpose:
        "Returnează produsele vendorului din toate magazinele sale.",
    },

    bulkStatus: {
      method: "PATCH",

      path:
        "/bulk-status",

      purpose:
        "Activează sau dezactivează mai multe produse ale vendorului.",
    },

    bulkDelete: {
      method: "DELETE",

      path:
        "/bulk",

      purpose:
        "Șterge mai multe produse ale vendorului.",
    },

    bulkPrice: {
      method: "PATCH",

      path:
        "/bulk-price",

      purpose:
        "Setează același preț pentru mai multe produse.",
    },

    bulkCategory: {
      method: "PATCH",

      path:
        "/bulk-category",

      purpose:
        "Schimbă categoria mai multor produse.",
    },

    duplicate: {
      method: "POST",

      path:
        "/:productId/duplicate",

      purpose:
        "Creează o copie inactivă a unui produs al vendorului, păstrând datele, imaginile, variantele și personalizarea.",
    },
  },
};

export function getCatalogProductsRoute(
  key
) {
  const endpoint =
    CATALOG_PRODUCTS_MANIFEST
      .endpoints[key];

  if (!endpoint) {
    throw new Error(
      `Unknown catalog products route: ${key}`
    );
  }

  return endpoint.path;
}

export function getCatalogProductsFullRoute(
  key
) {
  const endpoint =
    CATALOG_PRODUCTS_MANIFEST
      .endpoints[key];

  if (!endpoint) {
    throw new Error(
      `Unknown catalog products route: ${key}`
    );
  }

  const base =
    String(
      CATALOG_PRODUCTS_MANIFEST
        .basePath || ""
    ).replace(
      /\/+$/,
      ""
    );

  const path =
    endpoint.path === "/"
      ? ""
      : endpoint.path;

  return `${base}${path}`;
}