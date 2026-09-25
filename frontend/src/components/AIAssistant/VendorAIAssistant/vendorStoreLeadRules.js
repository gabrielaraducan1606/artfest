// src/components/AIAssistant/VendorAIAssistant/vendorStoreLeadRules.js
//
// Helper PUR pentru "Magazinul meu" -> "Îmbunătățește magazinul" din
// Asistentul vendor (conectare flow, 2026-09-23). Reguli 100%
// deterministe pe date DEJA existente (GET /api/vendors/me/dashboard,
// GET /api/vendors/me/billing, GET /api/vendor/store/:slug/products,
// GET /api/vendor/quotes, GET /api/vendor/orders) - niciun scor
// numeric, niciun apel AI, nimic recalculat/agregat diferit de sursa
// reală. Fiecare regulă e documentată explicit cu sursa ei de date.
//
// Niciun apel de rețea în acest fișier - doar transformări pure.
//
// Rulare: node --test src/components/AIAssistant/VendorAIAssistant/vendorStoreLeadRules.test.js

const PRIORITY_ORDER = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

const DEFAULT_LIMIT = 5;

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function safeProducts(snapshot) {
  return Array.isArray(snapshot?.products) ? snapshot.products : [];
}

function countProducts(snapshot, predicate) {
  return safeProducts(snapshot).filter(predicate).length;
}

/*
 * "produse fără materialMain/color/occasionTags" (cerință - o
 * SINGURĂ regulă combinată, nu 3 separate) - lipsă dacă ORICARE
 * dintre cele 3 atribute lipsește.
 */
function isMissingCoreAttributes(product) {
  const missingMaterial = !hasText(product?.materialMain);
  const missingColor = !hasText(product?.color);

  const occasionTags = Array.isArray(product?.occasionTags)
    ? product.occasionTags
    : [];

  const missingOccasion = occasionTags.length === 0;

  return missingMaterial || missingColor || missingOccasion;
}

/*
 * Personalizare incompletă - regula OBIECTIVĂ aprobată (nu "ar putea
 * fi personalizabil"): produsul e marcat acceptsCustom=true, dar
 * customSchema (configurația efectivă a câmpurilor de personalizare)
 * e goală/lipsă - stare inconsistentă reală în date, nu o presupunere.
 */
function hasIncompletePersonalization(product) {
  if (product?.acceptsCustom !== true) return false;

  const schema = Array.isArray(product?.customSchema)
    ? product.customSchema
    : [];

  return schema.length === 0;
}

function hasFewImages(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  return images.length < 2;
}

/* =========================================================
   Regulile - fiecare întoarce un obiect sugestie SAU null.
   Ordinea din array-ul RULES de mai jos = ordinea de tie-break în
   interiorul aceleiași priorități (determinist, stabil).
========================================================= */

const RULES = [
  /* ============ HIGH ============ */

  {
    id: "store-inactive",
    priority: "HIGH",
    check: (s) => s?.isActive === false,
    build: () => ({
      title: "Activează magazinul",
      reason:
        "Magazinul tău nu este activ - clienții nu îl pot găsi în platformă.",
      cta: { action: "edit-store", label: "Editează magazinul" },
    }),
  },

  {
    id: "store-missing-logo",
    priority: "HIGH",
    check: (s) => !hasText(s?.logoUrl),
    build: () => ({
      title: "Adaugă un logo",
      reason:
        "Un magazin fără logo pare neterminat și inspiră mai puțină încredere.",
      cta: { action: "edit-store", label: "Editează magazinul" },
    }),
  },

  {
    id: "store-missing-description",
    priority: "HIGH",
    check: (s) => !hasText(s?.about),
    build: () => ({
      title: "Completează descrierea magazinului",
      reason:
        "O descriere bună îi ajută pe clienți să înțeleagă ce creezi.",
      cta: { action: "edit-store", label: "Editează magazinul" },
    }),
  },

  {
    id: "store-no-active-products",
    priority: "HIGH",
    check: (s) => Number(s?.activeProductsCount) === 0,
    build: () => ({
      title: "Adaugă cel puțin un produs activ",
      reason:
        "Magazinul tău nu are niciun produs activ - clienții nu pot cumpăra nimic.",
      cta: { action: "add-product", label: "Adaugă produs" },
    }),
  },

  {
    id: "store-stripe-inactive",
    priority: "HIGH",
    check: (s) => s?.stripeChargesEnabled === false,
    build: () => ({
      title: "Activează plata cu cardul",
      reason:
        "Fără Stripe activ, clienții nu pot plăti online cu cardul la tine.",
      cta: { action: "vendor-payouts", label: "Activează plata cu cardul" },
    }),
  },

  {
    id: "store-billing-incomplete",
    priority: "HIGH",
    check: (s) => s?.billingComplete === false,
    build: () => ({
      title: "Completează datele de facturare",
      reason:
        "Fără datele de facturare complete, unele funcții de plată/facturare rămân blocate.",
      cta: { action: "vendor-billing", label: "Completează datele de facturare" },
    }),
  },

  {
    id: "store-unanswered-quotes",
    priority: "HIGH",
    check: (s) => Number(s?.unansweredQuotesCount) > 0,
    build: (s) => {
      const count = Number(s.unansweredQuotesCount);
      return {
        title: "Ai primit cereri la care nu ai răspuns",
        reason:
          count === 1
            ? "Ai 1 cerere de ofertă trimisă, fără nicio ofertă trimisă înapoi."
            : `Ai ${count} cereri de ofertă trimise, fără nicio ofertă trimisă înapoi.`,
        cta: { action: "received-quotes", label: "Răspunde cererilor" },
      };
    },
  },

  {
    id: "store-new-orders",
    priority: "HIGH",
    check: (s) => Number(s?.newOrdersCount) > 0,
    build: (s) => {
      const count = Number(s.newOrdersCount);
      return {
        title: "Ai comenzi noi neprocesate",
        reason:
          count === 1
            ? "Ai 1 comandă nouă care așteaptă să fie procesată."
            : `Ai ${count} comenzi noi care așteaptă să fie procesate.`,
        cta: { action: "vendor-orders", label: "Vezi comenzile" },
      };
    },
  },

  /* ============ MEDIUM ============ */

  {
    id: "products-missing-category",
    priority: "MEDIUM",
    check: (s) => countProducts(s, (p) => !hasText(p?.category)) > 0,
    build: (s) => {
      const count = countProducts(s, (p) => !hasText(p?.category));
      return {
        title: "Completează categoria produselor",
        reason:
          count === 1
            ? "Ai 1 produs fără categorie completată."
            : `Ai ${count} produse fără categorie completată.`,
        cta: { action: "edit-products", label: "Vezi produsele mele" },
      };
    },
  },

  {
    id: "products-missing-core-attributes",
    priority: "MEDIUM",
    check: (s) => countProducts(s, isMissingCoreAttributes) > 0,
    build: (s) => {
      const count = countProducts(s, isMissingCoreAttributes);
      return {
        title: "Completează material/culoare/ocazii",
        reason:
          count === 1
            ? "Ai 1 produs fără material, culoare sau ocazii setate."
            : `Ai ${count} produse fără material, culoare sau ocazii setate.`,
        cta: { action: "edit-products", label: "Vezi produsele mele" },
      };
    },
  },

  {
    id: "products-sold-out",
    priority: "MEDIUM",
    check: (s) =>
      countProducts(s, (p) => p?.availability === "SOLD_OUT") > 0,
    build: (s) => {
      const count = countProducts(
        s,
        (p) => p?.availability === "SOLD_OUT"
      );
      return {
        title: "Actualizează produsele fără stoc",
        reason:
          count === 1
            ? "1 produs este marcat ca stoc epuizat (SOLD_OUT)."
            : `${count} produse sunt marcate ca stoc epuizat (SOLD_OUT).`,
        cta: { action: "edit-products", label: "Vezi produsele mele" },
      };
    },
  },

  {
    id: "products-few-images",
    priority: "MEDIUM",
    check: (s) => countProducts(s, hasFewImages) > 0,
    build: (s) => {
      const count = countProducts(s, hasFewImages);
      return {
        title: "Adaugă mai multe imagini la produse",
        reason:
          count === 1
            ? "1 produs are mai puțin de 2 imagini."
            : `${count} produse au mai puțin de 2 imagini.`,
        cta: { action: "edit-products", label: "Vezi produsele mele" },
      };
    },
  },

  {
    id: "products-incomplete-personalization",
    priority: "MEDIUM",
    check: (s) => countProducts(s, hasIncompletePersonalization) > 0,
    build: (s) => {
      const count = countProducts(s, hasIncompletePersonalization);
      return {
        title: "Completează configurația de personalizare",
        reason:
          count === 1
            ? "1 produs are personalizarea activată, dar fără configurație completă."
            : `${count} produse au personalizarea activată, dar fără configurație completă.`,
        cta: { action: "edit-products", label: "Vezi produsele mele" },
      };
    },
  },

  /* ============ LOW ============ */

  {
    id: "products-missing-description",
    priority: "LOW",
    check: (s) => countProducts(s, (p) => !hasText(p?.description)) > 0,
    build: (s) => {
      const count = countProducts(s, (p) => !hasText(p?.description));
      return {
        title: "Completează descrierea produselor",
        reason:
          count === 1
            ? "1 produs este fără descriere."
            : `${count} produse sunt fără descriere.`,
        cta: { action: "edit-products", label: "Vezi produsele mele" },
      };
    },
  },

  {
    id: "store-few-products",
    priority: "LOW",
    check: (s) =>
      Number(s?.productsCount) > 0 && Number(s.productsCount) < 5,
    build: () => ({
      title: "Adaugă mai multe produse",
      reason:
        "Un catalog cu mai multe produse pare mai complet și mai de încredere pentru clienți.",
      cta: { action: "add-product", label: "Adaugă produs" },
    }),
  },
];

/*
 * Punct de intrare unic - rulează toate regulile, în ordine, peste
 * `snapshot`, întoarce sugestiile aplicabile sortate HIGH -> MEDIUM ->
 * LOW (stabil, ordinea din RULES ca tie-break), limitate la `limit`.
 */
export function buildVendorStoreSuggestions(
  snapshot,
  limit = DEFAULT_LIMIT
) {
  if (!snapshot || typeof snapshot !== "object") return [];

  const found = [];

  for (const rule of RULES) {
    let matches = false;

    try {
      matches = Boolean(rule.check(snapshot));
    } catch {
      matches = false;
    }

    if (!matches) continue;

    let built = null;

    try {
      built = rule.build(snapshot);
    } catch {
      built = null;
    }

    if (!built) continue;

    found.push({
      id: rule.id,
      priority: rule.priority,
      ...built,
    });
  }

  const safeLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Number(limit)
      : DEFAULT_LIMIT;

  return found
    .map((suggestion, index) => ({ suggestion, index }))
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.suggestion.priority] ?? 3;
      const pb = PRIORITY_ORDER[b.suggestion.priority] ?? 3;

      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    })
    .map((entry) => entry.suggestion)
    .slice(0, safeLimit);
}

/*
 * "Magazin complet" - niciuna dintre regulile de mai sus nu s-a
 * declanșat. Folosit de VendorAssistant.jsx pentru starea perfectă.
 */
export function isVendorStoreComplete(snapshot) {
  return buildVendorStoreSuggestions(snapshot, 1).length === 0;
}

/*
 * Construiește snapshot-ul consumat de buildVendorStoreSuggestions()
 * din răspunsurile BRUTE ale celor 4 endpointuri deja existente -
 * STRICT maparea numelor de câmpuri, nicio recalculare/agregare
 * suplimentară dincolo de ce fiecare endpoint întoarce deja.
 */
export function buildVendorStoreSnapshot({
  dashboard,
  billing,
  products,
  unansweredQuotesCount,
  newOrdersCount,
} = {}) {
  const service =
    Array.isArray(dashboard?.services) && dashboard.services.length
      ? dashboard.services[0]
      : null;

  const productList = Array.isArray(products) ? products : [];

  const activeProductsCount = productList.filter(
    (p) => p?.isActive === true && p?.isHidden !== true
  ).length;

  return {
    isActive: Boolean(service?.isActive),
    logoUrl:
      service?.profile?.logoUrl || dashboard?.vendor?.logoUrl || null,
    about: service?.profile?.about || dashboard?.vendor?.about || null,
    productsCount: productList.length,
    activeProductsCount,
    stripeChargesEnabled: Boolean(
      dashboard?.vendor?.stripeChargesEnabled
    ),
    billingComplete: Boolean(billing),
    unansweredQuotesCount: Number(unansweredQuotesCount) || 0,
    newOrdersCount: Number(newOrdersCount) || 0,
    products: productList,
  };
}
