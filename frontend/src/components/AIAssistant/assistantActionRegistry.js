// src/components/AIAssistant/assistantActionRegistry.js

/*
 * =========================================================================
 * REGISTRU CENTRAL DE ACȚIUNI - GUEST / USER / VENDOR
 * =========================================================================
 *
 * Sursa de adevăr pentru "ce pagină reală corespunde unui target
 * semantic, cine are voie să ajungă acolo, și dacă cere cont" -
 * folosit din AiAssistant.jsx (GUEST/USER) și VendorAssistant.jsx
 * (VENDOR), ca să nu existe două liste separate care pot diverge.
 *
 * Principiu explicit cerut: "LLM-ul/regulile aleg un TARGET semantic,
 * codul mapează target-ul la ruta REALĂ" - niciun URL nu e inventat
 * sau construit dinamic din text liber. Fiecare `route` de mai jos a
 * fost verificată direct în App.jsx (comentat la fiecare intrare cu
 * linia reală) - nicio presupunere de nume de rută.
 *
 * Un target ABSENT din acest registru sau cu `available:false` NU
 * primește o navigare inventată - vezi resolveAssistantAction, care
 * întoarce explicit `notFound`/`unavailable` pentru apelant (fallback
 * la explicație text, nu la un URL ghicit).
 */

export const ASSISTANT_ROLES = {
  GUEST: "GUEST",
  USER: "USER",
  VENDOR: "VENDOR",

  /*
   * INFLUENCER (FAZA 3) - strict aditiv, nu schimbă GUEST/USER/VENDOR.
   * Reutilizează același AiAssistant.jsx (nu VendorAssistant) - vezi
   * AppLayout.jsx.
   */
  INFLUENCER: "INFLUENCER",
};

/*
 * Stratul de ACȚIUNI (cerința #1) - pe lângă intențiile de
 * clasificare (GUEST_INTENTS din guestIntentTaxonomy.js), acesta e
 * VOCABULARUL de acțiuni executabile. NAVIGATE e singurul tip
 * EXECUTAT direct în acest pas (navigare pură, reversibilă, fără
 * risc) - OPEN_MODAL/OPEN_ASSISTANT_FLOW pot returna un target care
 * declanșează un flow existent (ex. wizard-ul de adăugare produs),
 * niciodată o acțiune financiară/distructivă (vezi SENSITIVE_ACTIONS
 * mai jos - acelea nu au NICIUN executor, doar navigare + explicație).
 */
export const ASSISTANT_ACTION_TYPES = {
  NAVIGATE: "NAVIGATE",
  OPEN_MODAL: "OPEN_MODAL",
  OPEN_ASSISTANT_FLOW: "OPEN_ASSISTANT_FLOW",
  APPLY_FILTER: "APPLY_FILTER",
  OPEN_PRODUCT: "OPEN_PRODUCT",
  OPEN_STORE: "OPEN_STORE",
  OPEN_ORDER: "OPEN_ORDER",
  OPEN_REQUEST: "OPEN_REQUEST",
  OPEN_MESSAGES: "OPEN_MESSAGES",
  OPEN_SETTINGS: "OPEN_SETTINGS",

  /*
   * FAZA 3 (INFLUENCER) - SINGURUL tip nou adăugat, oglindă exactă a
   * OPEN_STORE (entitate publică, deschisă după slug) - verificat
   * înainte de adăugare (vezi raportul FAZA 2) că OPEN_STORE însuși
   * nu rezolvă la /selectii/:slug (rută diferită de /magazin/:slug),
   * deci nu poate fi reutilizat ca atare pentru o colecție.
   */
  OPEN_COLLECTION: "OPEN_COLLECTION",

  /*
   * FAZA 4 (Support × AiAssistant - navigare) - deschide tichetul
   * individual (ticketId dinamic, cunoscut doar la runtime) - oglindă
   * exactă a OPEN_PRODUCT/OPEN_COLLECTION. DOAR pentru USER - vezi
   * DYNAMIC_ASSISTANT_ROUTE_BUILDERS mai jos, ruta verificată direct
   * în App.jsx: path="/account/support/tickets/:ticketId". VENDOR nu
   * are o rută individuală reală (verificat - doar "/vendor/support",
   * fără segment :ticketId) - nu inventăm una; apelantul trebuie să
   * folosească VENDOR_SUPPORT (lista) pentru rolul VENDOR.
   */
  OPEN_SUPPORT_TICKET: "OPEN_SUPPORT_TICKET",
};

/*
 * FAZA 3 - construiește rute pentru entități PUBLICE, dinamice
 * (id/slug cunoscut doar la runtime, nu un target static din
 * ASSISTANT_ACTION_REGISTRY) - OPEN_PRODUCT/OPEN_COLLECTION erau
 * declarate în enum de mai sus, dar NEIMPLEMENTATE (niciun handler
 * în AiAssistant.jsx) - acesta e mecanismul de rezolvare, ca
 * AiAssistant.jsx să nu hardcodeze niciun URL.
 *
 * Rute verificate direct în App.jsx:
 * - /produs/:id -> ProductDetails
 * - /selectii/:slug -> PublicInfluencerCollectionPage
 */
const DYNAMIC_ASSISTANT_ROUTE_BUILDERS = {
  [ASSISTANT_ACTION_TYPES.OPEN_PRODUCT]: (params) =>
    params?.productId
      ? `/produs/${encodeURIComponent(params.productId)}`
      : null,

  [ASSISTANT_ACTION_TYPES.OPEN_COLLECTION]: (params) =>
    params?.slug
      ? `/selectii/${encodeURIComponent(params.slug)}`
      : null,

  [ASSISTANT_ACTION_TYPES.OPEN_SUPPORT_TICKET]: (params) =>
    params?.ticketId
      ? `/account/support/tickets/${encodeURIComponent(params.ticketId)}`
      : null,
};

/**
 * buildDynamicAssistantRoute(type, params) - rezolvă un tip de
 * acțiune dinamică (OPEN_PRODUCT/OPEN_COLLECTION) la o rută REALĂ,
 * folosind DOAR șabloanele verificate mai sus. Întoarce `null` dacă
 * tipul nu are un șablon (ex. OPEN_STORE, încă neimplementat) sau
 * dacă lipsește parametrul necesar - apelantul cade pe explicație
 * text, nu pe un URL ghicit.
 */
export function buildDynamicAssistantRoute(type, params) {
  const builder = DYNAMIC_ASSISTANT_ROUTE_BUILDERS[type];

  return builder ? builder(params || {}) : null;
}

/**
 * buildAssistantActionUrl(entry, params) - adaugă query params
 * (ex. category/activity pentru INFLUENCER_RESOURCES) peste ruta
 * STATICĂ a unui target NAVIGATE din registru, fără să reconstruiască
 * URL-ul manual la fiecare punct de apel. `entry.route` poate deja
 * conține un query string propriu (ex. "?tab=resources") - params
 * se adaugă peste, nu îl înlocuiesc.
 */
export function buildAssistantActionUrl(entry, params = {}) {
  if (!entry?.route) {
    return entry?.route || null;
  }

  const url = new URL(entry.route, "http://internal.artfest.local");

  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, value);
  }

  return `${url.pathname}${url.search}`;
}

/*
 * Acțiuni SENSIBILE (cerința #7) - NU au niciun handler de execuție
 * nicăieri în acest registru sau în codul care îl consumă. Enumerate
 * aici DOAR ca listă de recunoaștere, ca asistentul să poată explica
 * ("pentru asta trebuie să mergi la pagina X și să confirmi acolo")
 * în loc să încerce o acțiune. Niciun target din ASSISTANT_ACTION_REGISTRY
 * de mai jos nu execută vreuna dintre ele.
 */
export const SENSITIVE_ACTION_KEYWORDS = [
  "delete",
  "sterge",
  "anuleaza",
  "cancel",
  "refund",
  "ramburseaza",
  "payment",
  "plateste",
  "publish",
  "publica",
  "deactivate",
  "dezactiveaza",
  "delete_product",
  "sterge produs",
  "send_message",
  "trimite mesaj",
  "send_offer",
  "trimite oferta",
];

const A = ASSISTANT_ACTION_TYPES;
const R = ASSISTANT_ROLES;

/*
 * Fiecare intrare:
 * - route: path REAL (verificat în App.jsx - vezi comentariul cu
 *   numărul liniei la data verificării) sau null dacă nu navighează
 *   direct (OPEN_ASSISTANT_FLOW).
 * - action: unul din ASSISTANT_ACTION_TYPES.
 * - allowedRoles: cine are voie SĂ AJUNGĂ acolo (nu neapărat cine
 *   poate EXECUTA ceva acolo - ex. CART e vizibil și pentru GUEST).
 * - requiresAuth: dacă userul curent trebuie autentificat (indiferent
 *   de rol) - separat de allowedRoles, pentru că un GUEST poate avea
 *   allowedRoles care include USER/VENDOR doar ca perspectivă, dar
 *   pentru EL, requiresAuth decide dacă îl trimitem la login.
 * - precondition: text scurt, opțional, verificat de apelant înainte
 *   de navigare (ex. "cont de vânzător activ") - informativ, nu
 *   impune cod suplimentar aici.
 * - label: text uman, pentru mesajul "Te duc la ...".
 * - available: false => target cunoscut semantic, dar FĂRĂ rută reală
 *   (nu inventăm una) - apelantul cade pe explicație (PLATFORM_KNOWLEDGE).
 * - prefetch: opțional, () => import(...) pentru chunk-ul lazy al
 *   rutei (vezi App.jsx `lazy(() => import(...))`) - folosit doar
 *   pentru rutele confirmate ca lazy-loaded.
 */
export const ASSISTANT_ACTION_REGISTRY = {
  /* =====================================================
     PUBLIC - accesibil GUEST/USER/VENDOR, fără cont
  ===================================================== */

  HOME: {
    route: "/",
    action: A.NAVIGATE,
    allowedRoles: [R.GUEST, R.USER, R.VENDOR],
    requiresAuth: false,
    label: "pagina principală",
  },

  // App.jsx: path="/produse" -> ProductsPage
  PRODUCTS: {
    route: "/produse",
    action: A.NAVIGATE,
    allowedRoles: [R.GUEST, R.USER, R.VENDOR],
    requiresAuth: false,
    label: "produse",
  },

  // App.jsx: path="/categorii" -> MobileCategories
  CATEGORIES: {
    route: "/categorii",
    action: A.NAVIGATE,
    allowedRoles: [R.GUEST, R.USER, R.VENDOR],
    requiresAuth: false,
    label: "categorii",
  },

  // App.jsx: path="/magazine" -> StoresPage
  STORES: {
    route: "/magazine",
    action: A.NAVIGATE,
    allowedRoles: [R.GUEST, R.USER, R.VENDOR],
    requiresAuth: false,
    label: "magazine",
  },

  /*
   * "colecțiile" (plural, index) - NU există o rută listă, doar
   * /colectii/:slug (o colecție anume, are nevoie de slug cunoscut).
   * Nu inventăm o rută index - target recunoscut semantic, dar
   * `available:false` => apelantul explică, nu navighează orb.
   */
  COLLECTIONS: {
    route: null,
    action: A.NAVIGATE,
    allowedRoles: [R.GUEST, R.USER, R.VENDOR],
    requiresAuth: false,
    available: false,
    label: "colecții",
    notes:
      "Nu există /colectii (listă) în App.jsx - doar /colectii/:slug, per colecție. Fără slug cunoscut, nu navigăm - explicăm.",
  },

  // App.jsx: path="/cereri" -> CustomerRequestsPage (cereri publice)
  PUBLIC_REQUESTS: {
    route: "/cereri",
    action: A.NAVIGATE,
    allowedRoles: [R.GUEST, R.USER, R.VENDOR],
    requiresAuth: false,
    label: "cereri publice",
  },

  /*
   * Coșul funcționează integral și pentru GUEST (guestCart.js,
   * localStorage) - vezi auth.manifest.js, verificat 2 sesiuni în
   * urmă. App.jsx: path="/cos" -> Cart.
   */
  CART: {
    route: "/cos",
    action: A.NAVIGATE,
    allowedRoles: [R.GUEST, R.USER, R.VENDOR],
    requiresAuth: false,
    label: "coșul tău",
  },

  /*
   * Login/signup - reutilizează modalul GLOBAL existent (Navbar.jsx,
   * query param ?auth=login|register - vezi useEffect acolo), NU o
   * navigare simplă către o pagină - de-aia `action` e OPEN_MODAL,
   * nu NAVIGATE. Există și o pagină dedicată (/autentificare), dar
   * modalul păstrează contextul (nu schimbă pagina curentă).
   */
  LOGIN: {
    route: null,
    action: A.OPEN_MODAL,
    modalParams: { auth: "login" },
    allowedRoles: [R.GUEST],
    requiresAuth: false,
    label: "autentificare",
  },

  SIGNUP: {
    route: null,
    action: A.OPEN_MODAL,
    modalParams: { auth: "register" },
    allowedRoles: [R.GUEST],
    requiresAuth: false,
    label: "înregistrare",
  },

  /*
   * Cont de vânzător - verificat direct în cod, NU presupus:
   * Navbar.jsx ascultă ?auth=register&as=partner (același listener
   * global ca LOGIN/SIGNUP) și, când e prezent, deschide modalul cu
   * <Register defaultAsVendor={true} inModal /> - ACEEAȘI componentă
   * de înregistrare, doar cu modul "vânzător" pre-selectat. E EXACT
   * mecanismul din spatele butonului "Devino partener" din Navbar -
   * nu o rută/flow separat, inventat.
   *
   * După creare, backend-ul redirecționează la /onboarding
   * (Register.jsx: `window.location.assign(response?.next ||
   * "/onboarding")`) - pagina RequireVendor de selecție servicii,
   * urmată de /onboarding/details.
   */
  VENDOR_SIGNUP: {
    route: null,
    action: A.OPEN_MODAL,
    modalParams: { auth: "register", as: "partner" },
    allowedRoles: [R.GUEST],
    requiresAuth: false,
    label: "crearea unui cont de vânzător",
    notes:
      "Sursă: Navbar.jsx (listener ?auth=register&as=partner -> setPartnerOpen(true) -> <Register defaultAsVendor={true} inModal />, identic cu butonul 'Devino partener'). Register.jsx redirecționează la /onboarding după creare (RequireVendor).",
  },

  /* =====================================================
     USER - necesită cont (USER sau VENDOR, care rămâne și cumpărător)
  ===================================================== */

  // App.jsx: path="/wishlist" -> (favorite)
  FAVORITES: {
    route: "/wishlist",
    action: A.NAVIGATE,
    allowedRoles: [R.USER, R.VENDOR],
    requiresAuth: true,
    label: "favoritele tale",
  },

  // App.jsx: path="/comenzile-mele"
  USER_ORDERS: {
    route: "/comenzile-mele",
    action: A.NAVIGATE,
    allowedRoles: [R.USER, R.VENDOR],
    requiresAuth: true,
    label: "comenzile tale",
  },

  /*
   * "cererile mele" - nu există o rută separată de listare filtrată
   * pe user; /cereri e lista publică, iar cererile proprii (directe,
   * către un vânzător) se văd prin asistent (openMyQuotes, din
   * quotes.manifest.js) - navigăm la /cereri (cea mai apropiată rută
   * reală) și notăm diferența, nu inventăm alta.
   */
  USER_REQUESTS: {
    route: "/cereri",
    action: A.NAVIGATE,
    allowedRoles: [R.USER, R.VENDOR],
    requiresAuth: true,
    label: "cererile tale",
    notes:
      "Cererile publice trimise de user apar aici; cele directe către un vânzător se văd prin asistent (\"arată-mi cererile mele\" în chat), nu pe o pagină separată.",
  },

  // App.jsx: path="/cont/mesaje" -> (mesaje user, distinct de /mesaje vendor)
  USER_MESSAGES: {
    route: "/cont/mesaje",
    action: A.NAVIGATE,
    allowedRoles: [R.USER, R.VENDOR],
    requiresAuth: true,
    label: "mesajele tale",
  },

  // App.jsx: path="/cont"
  USER_PROFILE: {
    route: "/cont",
    action: A.NAVIGATE,
    allowedRoles: [R.USER, R.VENDOR],
    requiresAuth: true,
    label: "profilul tău",
  },

  // App.jsx: path="/cont/setari"
  USER_SETTINGS: {
    route: "/cont/setari",
    action: A.NAVIGATE,
    allowedRoles: [R.USER, R.VENDOR],
    requiresAuth: true,
    label: "setările contului",
  },

  /*
   * FAZA 4 (Support × AiAssistant - navigare) - listă tichete USER.
   * App.jsx (verificat): path="/account/support" -> UserSupportPage
   * (RequireUser). Există și "/account/support/tickets/:ticketId" -
   * vezi OPEN_SUPPORT_TICKET (rută dinamică, mai jos), NU acest target
   * static (care e mereu lista).
   *
   * VENDOR NU folosește acest target - are deja VENDOR_SUPPORT
   * (/vendor/support) mai sus, o rută diferită - nu le amestecăm.
   */
  USER_SUPPORT_TICKETS: {
    route: "/account/support",
    action: A.NAVIGATE,
    allowedRoles: [R.USER],
    requiresAuth: true,
    label: "tichetele tale",
  },

  /*
   * ADĂUGAT (audit Guest Batch 2, 2026-09-08) - App.jsx (verificat):
   * path="/support" -> GuestSupportPage, FĂRĂ <RequireUser> - rută
   * publică reală, distinctă de USER_SUPPORT_TICKETS (/account/support,
   * autentificată). Un guest poate deschide aici un tichet nou
   * (nume+email), fără cont.
   */
  GUEST_SUPPORT: {
    route: "/support",
    action: A.NAVIGATE,
    allowedRoles: [R.GUEST],
    requiresAuth: false,
    label: "pagina de suport",
  },

  // App.jsx: path="/facturi" -> UserInvoicesPage (lazy)
  USER_INVOICES: {
    route: "/facturi",
    action: A.NAVIGATE,
    allowedRoles: [R.USER, R.VENDOR],
    requiresAuth: true,
    label: "facturile tale",
    // App.jsx: import("./pages/User/Invoices/UserInvoicesPage")
    prefetch: () =>
      import("../../pages/User/Invoices/UserInvoicesPage").catch(() => null),
  },

  /* =====================================================
     VENDOR - necesită cont de vânzător (RequireVendor în App.jsx)
  ===================================================== */

  // App.jsx: path="/desktop" -> RequireVendor + Desktop
  VENDOR_DASHBOARD: {
    route: "/desktop",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "panoul tău de vânzător",
  },

  // App.jsx: path="/vendor/catalog" -> RequireVendor + CatalogProdusePage
  VENDOR_PRODUCTS: {
    route: "/vendor/catalog",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "produsele tale",
  },

  /*
   * Tab-uri REALE ale /vendor/catalog (CatalogProduse.jsx,
   * searchParams "tab": products|imports|campaigns - verificat
   * direct în cod) - nu rute separate, query param pe aceeași pagină.
   */
  VENDOR_CAMPAIGNS: {
    route: "/vendor/catalog?tab=campaigns",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "campaniile tale",
  },

  VENDOR_CATALOG_IMPORTS: {
    route: "/vendor/catalog?tab=imports",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "importuri catalog",
  },

  /*
   * "Adaugă produs" - NU e o rută separată, e flow-ul EXISTENT al
   * VendorAssistant.jsx (VENDOR_ACTION_IDS.ADD_PRODUCT din
   * vendorMenus.js - deschide VendorProductWizard). Reutilizăm acel
   * flow prin OPEN_ASSISTANT_FLOW, nu creăm o pagină/rută paralelă
   * (cerința #11: "reutilizează flow-urile existente").
   */
  ADD_PRODUCT: {
    route: null,
    action: A.OPEN_ASSISTANT_FLOW,
    flowTarget: "VENDOR_ADD_PRODUCT",
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "adăugarea unui produs nou",
  },

  // App.jsx: path="/vendor/orders" -> RequireVendor + VendorOrdersPage
  VENDOR_ORDERS: {
    route: "/vendor/orders",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "comenzile magazinului tău",
  },

  // App.jsx: path="/vendor/orders/planning" -> lazy VendorOrdersPlanningPage
  VENDOR_ORDERS_PLANNING: {
    route: "/vendor/orders/planning",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "planificarea comenzilor",
    // App.jsx: import("./pages/Vendor/Orders/VendorOrdersPlaningPage.jsx")
    // (numele fișierului real are un singur "n" - "Planing", nu "Planning")
    prefetch: () =>
      import(
        "../../pages/Vendor/Orders/VendorOrdersPlaningPage.jsx"
      ).catch(() => null),
  },

  // App.jsx: path="/mesaje" -> RequireVendor + VendorMessagesPage
  VENDOR_MESSAGES: {
    route: "/mesaje",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "mesajele magazinului tău",
  },

  // App.jsx: path="/vendor/store" -> RequireVendor + StoreRedirect
  VENDOR_STORE_PROFILE: {
    route: "/vendor/store",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "profilul magazinului tău",
  },

  // Tab "Promoții" al /vendor/catalog (CatalogProduse.jsx) - "/vendor/promovari"
  // rămâne doar ca redirect pentru linkuri vechi (email/notificări), vezi App.jsx.
  VENDOR_PROMOTIONS: {
    route: "/vendor/catalog?tab=promotions",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "promovările tale",
  },

  // App.jsx: path="/vendor/invoices" -> lazy VendorInvoicesPage
  VENDOR_INVOICES: {
    route: "/vendor/invoices",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "facturile magazinului tău",
    // App.jsx: import("./pages/Vendor/Invoices/InvoicePage.jsx")
    prefetch: () =>
      import("../../pages/Vendor/Invoices/InvoicePage.jsx").catch(
        () => null
      ),
  },

  // App.jsx: path="/vendor/costs-profit" -> lazy ProfitabilityPage
  VENDOR_PRICE_CALCULATOR: {
    route: "/vendor/costs-profit",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "calculatorul de preț",
    prefetch: () =>
      import("../../pages/Vendor/CostsProfit/ProfitabilityPage.jsx").catch(
        () => null
      ),
  },

  // App.jsx: path="/vendor/costs-profit/library" -> lazy CostLibraryPage
  VENDOR_COST_LIBRARY: {
    route: "/vendor/costs-profit/library",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "biblioteca de costuri",
  },

  /*
   * "setările de livrare" - nu există o rută dedicată separată -
   * cea mai apropiată rută reală e /setari (SettingsPage, generic).
   * Nu inventăm /vendor/setari-livrare.
   */
  VENDOR_SETTINGS: {
    route: "/setari",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "setările magazinului",
    notes:
      "Nu există o rută separată doar pentru livrare - /setari e pagina generală de setări vendor. Pentru un tab anume, vezi VENDOR_SETTINGS_* mai jos (fix 2026-09-04, audit Setări Vendor) - același pattern ca VENDOR_CAMPAIGNS/INFLUENCER_RESOURCES, query param pe aceeași rută, NU o rută nouă.",
  },

  /*
   * Fix 2026-09-04 (audit Setări Vendor) - tab-uri REALE ale /setari
   * (SettingsPage.jsx, searchParams "tab": profile|shipping|
   * notifications|marketing|security|billing|subscription|payouts|
   * danger - verificat direct în cod). Nu toate tab-urile au un
   * target dedicat aici - doar cele cerute, pentru care există deja
   * un motiv real de navigare directă din asistent. "danger"
   * (dezactivare cont) e EXCLUS intenționat - nu se navighează
   * direct acolo din asistent (SENSITIVE_ACTION_KEYWORDS).
   */
  VENDOR_SETTINGS_PROFILE: {
    route: "/setari?tab=profile",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "profilul magazinului tău (nume, descriere, logo, adresă)",
  },

  VENDOR_SETTINGS_SHIPPING: {
    route: "/setari?tab=shipping",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "setările de livrare și retururi",
  },

  VENDOR_SETTINGS_MARKETING: {
    route: "/setari?tab=marketing",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "preferințele de marketing și email",
  },

  VENDOR_SETTINGS_SECURITY: {
    route: "/setari?tab=security",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "securitatea contului (parolă, email)",
  },

  VENDOR_SETTINGS_BILLING: {
    route: "/setari?tab=billing",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "datele de facturare",
  },

  VENDOR_SETTINGS_PAYOUTS: {
    route: "/setari?tab=payouts",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "încasările tale Stripe",
  },

  // App.jsx: path="/vendor/visitors" -> VendorVisitorsPage (statistici)
  VENDOR_STATS: {
    route: "/vendor/visitors",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "statisticile magazinului tău",
  },

  VENDOR_SUPPORT: {
    route: "/vendor/support",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "suport vânzător",
  },

  VENDOR_NOTIFICATIONS: {
    route: "/vendor/notifications",
    action: A.NAVIGATE,
    allowedRoles: [R.VENDOR],
    requiresAuth: true,
    precondition: "cont de vânzător activ",
    label: "notificările tale",
  },

  /* =====================================================
     INFLUENCER (FAZA 3) - necesită cont de influencer activ.

     App.jsx: path="/influencer" -> InfluencerDashboardPage.
     Tab-urile sunt REALE (DASHBOARD_TABS din
     InfluencerDashboardPage.jsx: home/promotion/orders/resources),
     dar dashboardul citea starea DOAR din useState intern, nu din
     URL - InfluencerDashboardPage.jsx a fost extins minim (FAZA 3)
     să inițializeze activeTab din ?tab=..., ca aceste target-uri să
     poată deep-link-a direct pe tab-ul corect.
  ===================================================== */

  INFLUENCER_DASHBOARD: {
    route: "/influencer",
    action: A.NAVIGATE,
    allowedRoles: [R.INFLUENCER],
    requiresAuth: true,
    precondition: "cont de influencer activ",
    label: "panoul tău de influencer",
  },

  /*
   * category/activity se adaugă peste această rută prin
   * buildAssistantActionUrl (nu sunt parte din `route` static) -
   * vezi InfluencerResourcesSection.jsx, care citește aceiași
   * parametri (category/activity) din URL la montare.
   */
  INFLUENCER_RESOURCES: {
    route: "/influencer?tab=resources",
    action: A.NAVIGATE,
    allowedRoles: [R.INFLUENCER],
    requiresAuth: true,
    precondition: "cont de influencer activ",
    label: "resursele tale",
  },

  INFLUENCER_ORDERS: {
    route: "/influencer?tab=orders",
    action: A.NAVIGATE,
    allowedRoles: [R.INFLUENCER],
    requiresAuth: true,
    precondition: "cont de influencer activ",
    label: "comenzile tale",
  },

  INFLUENCER_PROMOTION: {
    route: "/influencer?tab=promotion",
    action: A.NAVIGATE,
    allowedRoles: [R.INFLUENCER],
    requiresAuth: true,
    precondition: "cont de influencer activ",
    label: "promovarea ta",
  },

  /*
   * Colecțiile influencerului nu au un tab dedicat - se gestionează
   * din modalul "Colecțiile mele", deschis din tab-ul Promovare
   * (InfluencerDashboardPage.jsx: setCollectionsOpen(true), buton
   * "Colecțiile mele" din Acțiuni rapide/Promovare). Navigăm la cel
   * mai apropiat tab real, nu inventăm o rută separată - pentru
   * DESCHIDEREA unei colecții publice anume, vezi OPEN_COLLECTION
   * (rută dinamică, nu acest target static).
   */
  INFLUENCER_COLLECTIONS: {
    route: "/influencer?tab=promotion",
    action: A.NAVIGATE,
    allowedRoles: [R.INFLUENCER],
    requiresAuth: true,
    precondition: "cont de influencer activ",
    label: "colecțiile tale",
    notes:
      "Nu există tab dedicat - /influencer?tab=promotion e cea mai apropiată rută reală; colecțiile se deschid din modalul 'Colecțiile mele' de acolo.",
  },
};

/* =========================================================================
   REZOLVARE (target semantic -> decizie de execuție)
========================================================================= */

/**
 * Traduce un TARGET semantic (ales de reguli/LLM, NICIODATĂ un URL
 * liber) într-o decizie de execuție, ținând cont de rolul curent și
 * de starea de autentificare. Nu execută nimic - doar decide.
 *
 * Întoarce întotdeauna un obiect cu `status`:
 * - "ok"            -> execută (vezi `entry` pentru route/action/label)
 * - "needs_auth"     -> guest/neautentificat, target cere cont
 * - "role_forbidden" -> autentificat, dar rolul nu are acces
 * - "unavailable"    -> target cunoscut, dar fără rută reală (nu inventăm)
 * - "not_found"      -> target necunoscut în registru
 */
export function resolveAssistantAction(
  target,
  { role = ASSISTANT_ROLES.GUEST, isAuthenticated = false } = {}
) {
  const entry = ASSISTANT_ACTION_REGISTRY[target];

  if (!entry) {
    return { status: "not_found", target };
  }

  if (entry.available === false) {
    return { status: "unavailable", target, entry };
  }

  const roleAllowed = entry.allowedRoles.includes(role);

  if (entry.requiresAuth && !isAuthenticated) {
    /*
     * Un GUEST văzând un target USER/VENDOR primește login, NU
     * "rol interzis" - odată autentificat ca USER, poate avea acces
     * (vezi allowedRoles) - distincția contează pentru mesajul
     * potrivit (cerința #6: login+redirect vs. explicație de rol).
     */
    return { status: "needs_auth", target, entry };
  }

  if (!roleAllowed) {
    return { status: "role_forbidden", target, entry };
  }

  return { status: "ok", target, entry };
}

/**
 * Listă de targeturi vizibile pentru un rol dat - utilă pentru
 * sugestii/alternative ("nu ai acces la asta, dar poți la...").
 */
export function listTargetsForRole(role) {
  return Object.entries(ASSISTANT_ACTION_REGISTRY)
    .filter(
      ([, entry]) =>
        entry.available !== false && entry.allowedRoles.includes(role)
    )
    .map(([target, entry]) => ({ target, label: entry.label }));
}
