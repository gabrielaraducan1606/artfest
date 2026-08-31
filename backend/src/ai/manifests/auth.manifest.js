// backend/src/ai/manifests/auth.manifest.js

export const AUTH_MANIFEST = {
  id: "auth-account",

  title: "Autentificare și cont",

  audience: ["USER", "VENDOR", "GUEST", "ADMIN"],

  available: true,
  status: "ACTIVE",

  description:
    "Înregistrare, autentificare (email/parolă și Google), verificare email, resetare parolă, ștergere cont - și, la fel de important pentru un vizitator, CÂND chiar e nevoie de cont pe Artfest (mult mai rar decât s-ar crede: browsing, căutare, coș și chiar finalizarea unei comenzi funcționează integral fără cont).",

  tags: [
    "login",
    "parola",
    "cont",
    "autentificare",
    "inregistrare",
    "signup",
    "google",
    "verificare email",
    "sterge cont",
    "cand am nevoie de cont",
    "trebuie cont",
    "guest checkout",
    "cumpar fara cont",
    "coșul se salvează după login",
  ],

  aliases: [
    "cum imi schimb parola",
    "mi-am uitat parola",
    "cum ma autentific cu google",
    "cum imi sterg contul",
    "nu am primit emailul de verificare",
    "cum imi fac cont",
    "cum ma inregistrez",
    "trebuie cont pentru a cumpara",
    "pot cumpara fara cont",
    "cand am nevoie de cont pe artfest",
    "ce pot face fara cont",
    "ce pot face doar cu cont",
    "ce se intampla cu cosul cand ma loghez",
    "produsele din cos raman dupa ce ma loghez",
  ],

  uiLocations: [
    { audience: "GUEST", path: "/autentificare" },
    { audience: "GUEST", path: "/inregistrare" },
    { audience: "GUEST", path: "/verify-email" },
    { audience: "GUEST", path: "/reset-parola" },
    { audience: "USER", path: "/cont" },
  ],

  capabilities: {
    emailPasswordLogin: { available: true },
    emailPasswordSignup: { available: true },
    googleLogin: { available: true },
    passwordReset: { available: true },
    emailVerification: { available: true },
    changePassword: { available: true },
    deleteAccount: { available: true },

    guestCheckout: {
      available: true,

      notes:
        "Un vizitator poate finaliza o comandă completă (inclusiv plata) FĂRĂ cont - rute backend dedicate, separate de cele autentificate (checkout/guest/quote, checkout/guest/place).",
    },

    guestCartMergeOnLogin: {
      available: true,

      notes:
        "Dacă un vizitator are produse în coș (salvate local, în browser) și apoi își face cont/se autentifică, coșul local se mută automat în contul nou - nu se pierde nimic.",
    },
  },

  limitations: [],

  flows: [
    {
      name: "resetare parolă",
      steps: [
        "cerere resetare (email)",
        "primire link/cod",
        "setare parolă nouă",
      ],
    },

    {
      name: "coșul unui vizitator, la autentificare",
      steps: [
        "vizitatorul adaugă produse în coș fără cont (salvat local, în browser)",
        "se autentifică sau își creează un cont",
        "coșul local se trimite automat către server și se unește cu contul",
        "coșul local se golește - de-acum coșul e cel din cont",
      ],
    },
  ],

  integrations: {
    google: { available: true, status: "ACTIVE" },
  },

  endpoints: {
    signup: {
      method: "POST",
      path: "/api/auth/signup",
      purpose: "Creează un cont nou (email și parolă).",
      audience: ["GUEST"],
    },

    login: {
      method: "POST",
      path: "/api/auth/login",
      purpose: "Autentificare cu email și parolă.",
      audience: ["GUEST"],
    },

    googleLogin: {
      method: "POST",
      path: "/api/auth/google",
      purpose: "Autentificare/înregistrare cu Google.",
      audience: ["GUEST"],
    },

    guestCheckoutQuote: {
      method: "POST",
      path: "/api/checkout/guest/quote",
      purpose: "Calculează totalul comenzii (transport, produse) fără cont.",
      audience: ["GUEST"],
    },

    guestCheckoutPlace: {
      method: "POST",
      path: "/api/checkout/guest/place",
      purpose: "Plasează efectiv comanda, fără cont.",
      audience: ["GUEST"],
    },

    cartMerge: {
      method: "POST",
      path: "/api/cart/merge",
      purpose: "Mută automat coșul local (guest) în contul nou, la autentificare.",
      audience: ["USER"],
    },

    changePassword: {
      method: "POST",
      path: "/api/account/change-password",
      purpose: "Schimbă parola contului autentificat.",
      audience: ["USER", "VENDOR"],
    },

    deleteAccount: {
      method: "DELETE",
      path: "/api/account",
      purpose: "Șterge contul utilizatorului autentificat.",
      audience: ["USER", "VENDOR"],
    },
  },

  faq: [
    {
      q: "Cum îmi schimb parola?",
      a: "Din contul tău, la secțiunea de setări, poți schimba parola dacă știi parola actuală. Dacă ai uitat-o, folosește opțiunea de resetare parolă din pagina de autentificare.",
    },

    {
      q: "Cum îmi fac cont pe Artfest?",
      a: "Din pagina de înregistrare, cu email și parolă, sau printr-un singur click cu Google - ambele opțiuni creează direct contul, fără pași suplimentari.",
    },

    {
      q: "Trebuie cont ca să cumpăr?",
      a: "Nu. Poți răsfoi, căuta, adăuga produse în coș și chiar finaliza integral o comandă (inclusiv plata) fără niciun cont. Ai nevoie de cont doar pentru lucruri legate strict de contul tău: să vezi istoricul comenzilor oricând mai târziu, să salvezi produse la favorite, să ceri o ofertă directă unui vânzător, sau să-i scrii un mesaj.",
    },

    {
      q: "Ce se întâmplă cu produsele din coș dacă mă loghez?",
      a: "Nimic nu se pierde - coșul salvat local (fără cont) se mută automat în contul tău, imediat ce te autentifici sau îți creezi unul.",
    },

    {
      q: "Mă pot autentifica cu Google?",
      a: "Da - autentificarea/înregistrarea cu Google e disponibilă, pe lângă email și parolă, printr-un singur click.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: authRoutes.js (/signup, /login, /me, /exists, /logout, /forgot-password, /reset-password), authGoogleRoutes.js (/google - login/signup, fără authRequired; /methods și /google/connect - authRequired, pentru un cont deja existent), changePasswordRoutes.js, accountDeleteRoutes.js. Extins 2026-08-28 (audit GUEST): chekoutRoutes.js confirmă rute de checkout PARALELE, fără authRequired (/checkout/guest/quote, /checkout/guest/place) distincte de cele autentificate (/checkout/quote, /checkout/place) - un guest poate plasa o comandă completă fără cont. Cart.jsx (mergeIfNeeded) confirmă merge automat al coșului local -> POST /api/cart/merge, apoi clearGuestCart() - la fiecare încărcare a paginii de coș, dacă userul tocmai s-a autentificat și mai are produse locale. Verificat 2026-08-24, extins 2026-08-28.",
};
