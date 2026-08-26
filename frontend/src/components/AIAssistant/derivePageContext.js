// src/components/AIAssistant/derivePageContext.js

/*
 * Traduce un pathname REAL al aplicației (vezi App.jsx - singura
 * sursă de adevăr pentru rute) într-un {pageType, entity} pentru
 * copilot (PAGE-AWARE / ENTITY-AWARE). Nu inventează rute care nu
 * există (ex. NU există /vendor/products/:id - produsele se
 * editează prin modal pe /vendor/catalog sau pe /magazin/:slug
 * pentru owner, vezi useAnnounceCurrentEntity + CatalogProduse.jsx
 * / ProfilMagazin.jsx).
 *
 * Rutele STATICE care se suprapun cu un pattern dinamic (ex.
 * /vendor/costs-profit/library vs /vendor/costs-profit/:productId)
 * sunt verificate ÎNAINTEA celor dinamice, la fel cum le rezolvă
 * și react-router.
 */
const PATTERNS = [
  { re: /^\/vendor\/costs-profit\/library$/, pageType: "COST_LIBRARY" },
  {
    re: /^\/vendor\/costs-profit\/([^/]+)$/,
    pageType: "PRODUCT_COSTING",
    entityType: "PRODUCT_COSTING",
  },
  { re: /^\/vendor\/costs-profit$/, pageType: "COSTS_PROFIT" },
  { re: /^\/vendor\/catalog$/, pageType: "PRODUCT_CATALOG" },
  { re: /^\/vendor\/orders\/planning$/, pageType: "ORDERS_PLANNING" },
  {
    re: /^\/vendor\/orders\/([^/]+)$/,
    pageType: "ORDER_DETAILS",
    entityType: "ORDER",
  },
  { re: /^\/vendor\/orders$/, pageType: "ORDERS_LIST" },
  { re: /^\/vendor\/promovari$/, pageType: "HOMEPAGE_FEATURES" },
  { re: /^\/vendor\/invoices$/, pageType: "INVOICES" },
  { re: /^\/vendor\/visitors$/, pageType: "VENDOR_VISITORS" },
  { re: /^\/vendor\/support$/, pageType: "VENDOR_SUPPORT" },
  { re: /^\/vendor\/notifications$/, pageType: "NOTIFICATIONS" },
  {
    re: /^\/magazin\/([^/]+)$/,
    pageType: "STORE_PROFILE",
    entityType: "STORE",
  },
  /*
   * BUGFIX (audit) - pagina publică de produs (/produs/:id) lipsea
   * complet din această listă, deși e cea mai comună pagină pe care
   * un cumpărător o vede - fără ea, currentEntity era mereu null
   * acolo, inclusiv pentru distincția cerere-publică vs cerere-
   * directă-la-vendor (vezi detectQuoteRequestIntent).
   */
  {
    re: /^\/produs\/([^/]+)$/,
    pageType: "PRODUCT_DETAILS",
    entityType: "PRODUCT",
  },
  {
    re: /^\/cereri\/([^/]+)$/,
    pageType: "QUOTE_DETAILS",
    entityType: "QUOTE",
  },
  { re: /^\/cereri$/, pageType: "QUOTES_LIST" },
];

/*
 * Doar pentru retrieval (FAZA "knowledge contextual") - manifestul
 * cel mai relevant pentru fiecare pageType, folosit ca boost
 * determinist în knowledgeRetrieval.js (backend), NU aici -
 * lista rămâne ca referință/documentație pentru ce se trimite.
 */
export function derivePageContext(pathname) {
  const clean = String(pathname || "")
    .split("?")[0]
    .split("#")[0];

  for (const pattern of PATTERNS) {
    const match = clean.match(pattern.re);

    if (match) {
      return {
        currentPage: {
          pathname: clean,
          pageType: pattern.pageType,
        },

        entityFromUrl:
          pattern.entityType && match[1]
            ? { type: pattern.entityType, id: match[1] }
            : null,
      };
    }
  }

  return {
    currentPage: { pathname: clean, pageType: null },
    entityFromUrl: null,
  };
}
