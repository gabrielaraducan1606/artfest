// backend/src/ai/manifests/auth.manifest.js

export const AUTH_MANIFEST = {
  id: "auth-account",

  title: "Autentificare și cont",

  audience: ["USER", "VENDOR", "GUEST", "ADMIN"],

  available: true,
  status: "ACTIVE",

  description:
    "Înregistrare, autentificare (email/parolă și Google), verificare email, resetare parolă, ștergere cont.",

  tags: [
    "login",
    "parola",
    "cont",
    "autentificare",
    "inregistrare",
    "google",
    "verificare email",
    "sterge cont",
  ],

  aliases: [
    "cum imi schimb parola",
    "mi-am uitat parola",
    "cum ma autentific cu google",
    "cum imi sterg contul",
    "nu am primit emailul de verificare",
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
    googleLogin: { available: true },
    passwordReset: { available: true },
    emailVerification: { available: true },
    changePassword: { available: true },
    deleteAccount: { available: true },
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
  ],

  integrations: {
    google: { available: true, status: "ACTIVE" },
  },

  endpoints: {
    login: {
      method: "POST",
      path: "/api/auth/login",
      purpose: "Autentificare cu email și parolă.",
      audience: ["GUEST"],
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
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: authRoutes.js, authGoogleRoutes.js, changePasswordRoutes.js, accountDeleteRoutes.js. Verificat 2026-08-24.",
};
