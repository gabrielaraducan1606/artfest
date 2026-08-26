// backend/src/ai/manifests/invoices.manifest.js

export const INVOICES_MANIFEST = {
  id: "invoices",

  title: "Facturi",

  audience: ["USER", "VENDOR", "ADMIN"],

  available: true,
  status: "ACTIVE",

  description:
    "Facturile emise pentru comenzi (cumpărător) și facturile vendorului pentru comisioane/abonament.",

  tags: ["factura", "facturi", "facturile mele"],

  aliases: [
    "unde gasesc factura",
    "cum descarc factura",
    "cum vad facturile mele",
    "vreau sa vad facturile",
  ],

  uiLocations: [
    { audience: "USER", path: "/facturi" },
    { audience: "VENDOR", path: "/vendor/invoices" },
  ],

  capabilities: {
    viewInvoices: { available: true },
    downloadInvoices: { available: true },
  },

  limitations: [],
  flows: [],
  integrations: {},

  endpoints: {
    myInvoices: {
      method: "GET",
      path: "/api/users/me/invoices",
      purpose: "Returnează facturile utilizatorului.",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Unde găsesc factura?",
      a: "Facturile tale sunt disponibile în secțiunea „Facturi” din contul tău (cumpărător) sau din panoul de vânzător.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: userInvoicesRoutes.js, vendorInvoices.js, adminInvoicesRoutes.js. Verificat 2026-08-24.",
};
