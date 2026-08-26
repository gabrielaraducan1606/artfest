// backend/src/ai/manifests/influencer.manifest.js

export const INFLUENCER_MANIFEST = {
  id: "influencer",

  title: "Program influencer/ambasador",

  audience: ["USER", "ADMIN"],

  available: true,
  status: "ACTIVE",

  description:
    "Program de recomandare pentru influenceri - înregistrare, link de recomandare, urmărire click-uri/rezultate.",

  tags: ["influencer", "ambasador", "recomandare"],

  aliases: [
    "cum devin influencer artfest",
    "cum ma inregistrez in programul de ambasador",
  ],

  uiLocations: [
    { audience: "USER", path: "/influencer" },
    { audience: "USER", path: "/influencer/register" },
  ],

  capabilities: {
    registration: { available: true },
    referralTracking: { available: true },
  },

  limitations: [],
  flows: [],
  integrations: {},

  endpoints: {
    register: {
      method: "POST",
      path: "/api/influencer/register",
      purpose: "Înregistrare în programul de influencer.",
      audience: ["GUEST", "USER"],
    },
  },

  faq: [],
  unavailableFeatures: [],

  notes:
    "Sursă: influencerRoutes.js, adminInfluencersRoutes.js. Verificat 2026-08-24.",
};
