// backend/src/ai/manifests/userProfile.manifest.js

export const USER_PROFILE_MANIFEST = {
  id: "user-profile",

  title: "Profilul și setările utilizatorului",

  audience: ["USER"],

  available: true,
  status: "ACTIVE",

  description:
    "Setările contului de cumpărător: date personale, adrese, preferințe.",

  tags: ["profil", "setari cont", "adresa", "date personale"],

  aliases: [
    "cum imi schimb adresa",
    "cum imi editez profilul",
    "unde imi vad setarile",
  ],

  uiLocations: [
    { audience: "USER", path: "/cont" },
    { audience: "USER", path: "/cont/setari" },
  ],

  capabilities: {
    editProfile: { available: true },
    manageAddresses: { available: true },
  },

  limitations: [],
  flows: [],
  integrations: {},

  endpoints: {
    settings: {
      method: "GET",
      path: "/api/account",
      purpose: "Returnează setările contului.",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Cum îmi editez profilul?",
      a: "Din secțiunea de cont/setări poți edita datele personale.",
    },
    {
      q: "Cum îmi schimb adresa?",
      a: "Din secțiunea de cont poți adăuga, edita sau șterge adresele salvate.",
    },
    {
      q: "Unde îmi văd setările?",
      a: "În secțiunea de cont din contul tău găsești datele personale, adresele și preferințele.",
    },
  ],
  unavailableFeatures: [],

  notes:
    "Sursă: userRoutes.js, userSettingsRoutes.js. Verificat 2026-08-24.",
};
