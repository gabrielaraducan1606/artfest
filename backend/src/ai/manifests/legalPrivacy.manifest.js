// backend/src/ai/manifests/legalPrivacy.manifest.js

export const LEGAL_PRIVACY_MANIFEST = {
  id: "legal-privacy",

  title: "Legal, confidențialitate și cookies",

  audience: ["USER", "VENDOR", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Documente legale: termeni și condiții, politică de confidențialitate, politică de retur, acord vânzători, politică cookies.",

  tags: ["legal", "confidentialitate", "cookies", "termeni", "gdpr"],

  aliases: [
    "unde gasesc termenii si conditiile",
    "politica de confidentialitate",
    "politica de retur",
    "cum imi schimb preferintele de cookies",
  ],

  uiLocations: [
    { audience: "GUEST", path: "/confidentialitate" },
    { audience: "GUEST", path: "/termenii-si-conditiile" },
    { audience: "GUEST", path: "/acord-vanzatori" },
    { audience: "GUEST", path: "/politica-retur" },
    { audience: "GUEST", path: "/politica-cookie" },
    { audience: "GUEST", path: "/preferinte-cookie" },
  ],

  capabilities: {
    staticLegalPages: { available: true },
    cookiePreferences: { available: true },
  },

  limitations: [],
  flows: [],
  integrations: {},

  endpoints: {},

  faq: [],
  unavailableFeatures: [],

  notes:
    "Sursă: legalRoutes.js, cookiesRoutes.js, agreementsRoutes.js. Pagini statice. Verificat 2026-08-24.",
};
