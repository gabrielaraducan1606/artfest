// backend/src/ai/manifests/wishlist.manifest.js

export const WISHLIST_MANIFEST = {
  id: "wishlist",

  title: "Favorite / Wishlist",

  audience: ["USER"],

  available: true,
  status: "ACTIVE",

  description: "Salvarea produselor favorite pentru mai târziu.",

  tags: ["wishlist", "favorite", "produse salvate"],

  aliases: [
    "cum salvez un produs",
    "unde imi vad favoritele",
  ],

  uiLocations: [{ audience: "USER", path: "/wishlist" }],

  capabilities: {
    addToWishlist: { available: true },
    removeFromWishlist: { available: true },
  },

  limitations: [],
  flows: [],
  integrations: {},

  endpoints: {
    myFavorites: {
      method: "GET",
      path: "/api/favorites",
      purpose: "Returnează produsele favorite ale utilizatorului.",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Cum salvez un produs la favorite?",
      a: "Din pagina produsului, apeși pe iconița de inimă/favorite - produsul apare apoi în lista ta de favorite.",
    },
    {
      q: "Unde îmi văd favoritele?",
      a: "În pagina de Favorite din contul tău - acolo găsești toate produsele salvate.",
    },
  ],

  unavailableFeatures: [],

  notes: "Sursă: favoritesRoutes.js. Verificat 2026-08-24.",
};
