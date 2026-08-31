// backend/src/ai/manifests/wishlist.manifest.js

export const WISHLIST_MANIFEST = {
  id: "wishlist",

  title: "Favorite / Wishlist",

  /*
   * BUGFIX (audit GUEST, 2026-08-28): TOATE rutele de favorite
   * (favoritesRoutes.js) cer authRequired, fără nicio excepție și
   * fără niciun echivalent local (spre deosebire de coș - vezi
   * guestCart.js) - un vizitator neautentificat nu poate salva
   * NIMIC la favorite, nici măcar temporar în browser. GUEST adăugat
   * la knowledgeAudience STRICT ca să primească acest răspuns clar
   * ("nu, ai nevoie de cont"), nu ca să sugereze că ar putea folosi
   * funcția.
   */
  audience: ["USER"],
  knowledgeAudience: ["USER", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Salvarea produselor favorite pentru mai târziu - necesită cont; spre deosebire de coșul de cumpărături, NU există o variantă locală/temporară pentru vizitatori neautentificați.",

  tags: [
    "wishlist",
    "favorite",
    "produse salvate",
    "favorite fara cont",
  ],

  aliases: [
    "cum salvez un produs",
    "unde imi vad favoritele",
    "pot salva la favorite fara cont",
    "trebuie cont pentru favorite",
    "favoritele se salveaza fara cont",
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
      a: "Din pagina produsului, apeși pe iconița de inimă/favorite - produsul apare apoi în lista ta de favorite. Ai nevoie să fii autentificat.",
    },
    {
      q: "Unde îmi văd favoritele?",
      a: "În pagina de Favorite din contul tău - acolo găsești toate produsele salvate.",
    },
    {
      q: "Pot salva produse la favorite fără cont?",
      a: "Nu - spre deosebire de coșul de cumpărături (care funcționează și fără cont), favoritele necesită autentificare. Dacă apeși inima fără cont, ești invitat să te autentifici sau să-ți creezi unul rapid.",
    },
  ],

  unavailableFeatures: [
    "Salvarea produselor favorite fără cont (fără echivalentul local pe care îl are coșul de cumpărături)",
  ],

  notes:
    "Sursă: favoritesRoutes.js. Verificat 2026-08-24. Extins 2026-08-28 (audit GUEST): toate rutele (/ids, /, /toggle, /bulk, /count, DELETE) confirmate cu authRequired, fără nicio excepție - niciun mecanism local (localStorage) echivalent guestCart.js.",
};
