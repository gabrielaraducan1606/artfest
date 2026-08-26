// backend/src/ai/manifests/seoVisibility.manifest.js

export const SEO_VISIBILITY_MANIFEST = {
  id: "seo-visibility",

  title: "Vizibilitate produse: sitemap, Google Shopping, Meta catalog",

  audience: ["VENDOR", "ADMIN"],

  knowledgeAudience: ["VENDOR", "ADMIN", "USER", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Includerea automată a produselor în sitemap.xml, în feed-ul Google Shopping și în catalogul Meta (Facebook/Instagram). Nu există acțiune manuală a vendorului pentru a 'adăuga' un produs în aceste liste - includerea e complet automată, pe baza stării produsului/serviciului/vendorului.",

  tags: [
    "seo",
    "google",
    "google shopping",
    "sitemap",
    "vizibilitate",
    "feed",
    "meta",
    "facebook",
    "instagram",
  ],

  aliases: [
    "de ce nu apare produsul meu pe google",
    "cum apar produsele in sitemap",
    "produsul nu apare pe google shopping",
  ],

  uiLocations: [],

  capabilities: {
    automaticSitemapInclusion: { available: true },
    automaticGoogleShoppingFeed: { available: true },
    automaticMetaCatalogFeed: { available: true },
    vendorManualSubmission: { available: false },
  },

  limitations: [
    "Vendorul nu poate forța manual includerea unui produs - trebuie ca produsul/serviciul/vendorul să îndeplinească toate condițiile automate de mai jos.",
    "Chiar dacă produsul apare corect în sitemap/feed-uri pe platforma Artfest, indexarea efectivă în Google este controlată de Google, nu de Artfest, și poate dura.",
  ],

  flows: [
    {
      name: "Condiții pentru includere în sitemap.xml",
      steps: [
        "Produsul: isActive = true, isHidden = false, moderationStatus = APPROVED.",
        "Serviciul asociat: isActive = true, status = ACTIVE.",
        "Vendorul: isActive = true.",
      ],
    },
    {
      name: "Condiții suplimentare pentru feed-ul Google Shopping",
      steps: [
        "Toate condițiile de sitemap, PLUS:",
        "Preț (priceCents) mai mare ca 0.",
        "Cel puțin o imagine încărcată.",
      ],
    },
  ],

  integrations: {},

  endpoints: {
    sitemap: {
      method: "GET",
      path: "/sitemap.xml",
      purpose: "Sitemap XML public, regenerat dinamic la fiecare cerere.",
      audience: ["USER"],
    },
    googleShoppingFeed: {
      method: "GET",
      path: "/google-shopping-feed.xml",
      purpose: "Feed XML pentru Google Shopping/Merchant Center.",
      audience: ["USER"],
    },
    metaCatalogFeed: {
      method: "GET",
      path: "/api/meta-product-feed.csv",
      purpose: "Feed CSV pentru catalogul Meta (Facebook/Instagram).",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "De ce nu apare produsul meu pe Google?",
      a: "Verifică, în ordine: produsul este activ și nu este ascuns; a fost aprobat la moderare (moderationStatus = APPROVED); are preț mai mare ca 0 și cel puțin o imagine; magazinul/serviciul tău este activ. Dacă toate sunt îndeplinite, produsul apare în feed-ul Google Shopping generat de Artfest - indexarea efectivă în Google poate dura suplimentar și e controlată de Google, nu de Artfest.",
    },
    {
      q: "Cum apar produsele în sitemap?",
      a: "Automat, dacă produsul este activ, vizibil (nu ascuns), aprobat la moderare, iar serviciul și vendorul sunt active. Nu există un pas manual de adăugare în sitemap.",
    },
  ],

  unavailableFeatures: ["Adăugare/eliminare manuală a unui produs din sitemap sau feed-uri"],

  notes:
    "Sursă: backend/src/routes/sitemap.js, googleShoppingFeed.js, metaCatalogFeedRoutes.js (criterii where din interogările Prisma). Verificat 2026-08-24.",
};
