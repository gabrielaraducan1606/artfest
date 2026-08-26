// backend/src/ai/manifests/vendorStoreProfile.manifest.js

export const VENDOR_STORE_PROFILE_MANIFEST = {
  id: "vendor-store-profile",

  title: "Profil magazin și onboarding vânzător",

  audience: ["VENDOR"],

  /*
   * BUGFIX (generalizare USER/GUEST): "Cum devin vânzător?" trebuie
   * să funcționeze pentru orice vizitator, nu doar pentru cineva
   * deja autentificat ca VENDOR.
   */
  knowledgeAudience: ["VENDOR", "USER", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Crearea și administrarea profilului de vânzător/magazin: date magazin, tipuri de servicii oferite, onboarding inițial. Include și cum devine cineva vânzător pe Artfest (înregistrare cu opțiunea 'Devino partener', urmată de completarea profilului de magazin).",

  tags: [
    "magazin",
    "profil vanzator",
    "onboarding",
    "date magazin",
    "servicii",
    "devin vanzator",
    "inregistrare vanzator",
    "cont vanzator",
    "forma juridica",
    "pfa",
    "srl",
    "creator independent",
    "business verificat",
    "persoana fizica",
  ],

  aliases: [
    "cum imi creez magazinul",
    "cum imi editez profilul de vanzator",
    "cum adaug un serviciu nou",
    "cum devin vanzator",
    "cum ma inregistrez ca vanzator",
    "vreau sa vand pe artfest",
    "cum incep sa vand pe artfest",
    "trebuie sa am firma ca sa vand",
    "pot vinde fara srl",
    "pot vinde fara pfa",
    "pot incepe sa vand ca persoana fizica",
    "ce se intampla daca depasesc 10000 lei",
    "cand trebuie sa imi fac firma",
    "cat pot vinde fara firma",
  ],

  uiLocations: [
    { audience: "VENDOR", path: "/onboarding" },
    { audience: "VENDOR", path: "/onboarding/details" },
    { audience: "VENDOR", path: "/vendor/store" },
  ],

  capabilities: {
    createStoreProfile: { available: true },
    editStoreProfile: { available: true },
    manageServiceTypes: { available: true },

    vendorSelfRegistration: {
      available: true,
      audience: ["GUEST", "USER"],
    },

    /*
     * Regulă de business (nu regulă fiscală/juridică verificată -
     * nicio sursă legală confirmată în cod) - vezi FAQ pentru
     * formularea exactă cerută. Confirmat determinist ca opțiune
     * reală de cont ("sellerType") din billingRoutes.js/
     * BillingTab.jsx: "independent_creator" (🌱 Creator Independent
     * - "Nu am încă PFA/SRL și vreau să testez vânzarea pe
     * platformă") vs "verified_business" (✓ Business Verificat -
     * "Am PFA, SRL, II sau IF"). NU am găsit, în cod, nicio
     * verificare/blocare AUTOMATĂ a pragului de 10.000 lei/an -
     * e o regulă de politică Artfest, aplicată administrativ, nu
     * un mecanism tehnic care oprește automat vânzarea.
     */
    sellFromIndividualAccount: {
      available: true,
      status: "ACTIVE",
      audience: ["GUEST", "USER", "VENDOR"],
    },
  },

  limitations: [
    "Un creator poate începe să vândă pe Artfest fără formă juridică (cont „Creator Independent”) - este o variantă pentru început, nu regula finală.",
    "Dacă vânzările depășesc 10.000 lei într-un an, regula Artfest (nu lege fiscală confirmată în acest sistem) cere trecerea la un cont de vânzător cu formă juridică („Business Verificat” - PFA, SRL, II sau IF), pentru a continua să vândă pe platformă.",
    "Nu există, în cod, o verificare/blocare automată a acestui prag - aplicarea regulii e administrativă, nu tehnică.",
  ],
  flows: [],
  integrations: {},

  endpoints: {
    vendorProfile: {
      method: "GET",
      path: "/api/vendors/me",
      purpose: "Returnează profilul vendorului autentificat.",
      audience: ["VENDOR"],
    },
  },

  faq: [
    {
      q: "Cum îmi creez magazinul?",
      a: "Prin pașii de onboarding de la prima conectare ca vânzător - completezi datele magazinului și tipul de servicii pe care le oferi.",
    },
    {
      q: "Cum îmi editez profilul de vânzător?",
      a: "Din pagina magazinului tău poți edita oricând datele - nume, descriere, imagini și celelalte informații publice.",
    },
    {
      q: "Cum adaug un serviciu nou?",
      a: "Din profilul magazinului, poți adăuga tipuri noi de servicii pe care le oferi clienților.",
    },
    {
      q: "Cum devin vânzător pe Artfest?",
      a: "Te înregistrezi folosind opțiunea „Devino partener” (din pagina principală sau din meniul de autentificare), bifând că vrei cont de vânzător. După înregistrare, magazinul tău e creat, dar inactiv, până completezi pașii de onboarding - datele magazinului și tipurile de servicii pe care le oferi.",
    },
    {
      q: "Trebuie să am firmă ca să vând pe Artfest?",
      a: "Nu, poți începe să vinzi și fără formă juridică, ca „Creator Independent” - e o variantă pentru început. Este o regulă Artfest, nu o lege fiscală: dacă vânzările tale depășesc 10.000 lei într-un an, pentru a continua să vinzi pe platformă trebuie să treci la un cont „Business Verificat”, cu PFA, SRL, II sau IF.",
    },
    {
      q: "Pot vinde fără SRL/PFA?",
      a: "Da, la început poți vinde fără formă juridică, alegând tipul de cont „Creator Independent” la înregistrare. Dacă vânzările depășesc 10.000 lei într-un an, regula Artfest cere trecerea la un cont cu formă juridică pentru a continua să vinzi.",
    },
    {
      q: "Pot începe să vând ca persoană fizică?",
      a: "Da - opțiunea „Creator Independent” e făcută exact pentru asta, ca să poți testa vânzarea pe platformă fără să ai încă PFA sau SRL.",
    },
    {
      q: "Ce se întâmplă dacă depășesc 10.000 lei în vânzări?",
      a: "Conform regulii Artfest (nu e o afirmație de lege fiscală), dacă depășești 10.000 lei în vânzări într-un an ca „Creator Independent”, pentru a continua să vinzi pe platformă trebuie să treci la un cont „Business Verificat”, cu formă juridică (PFA, SRL, II sau IF). Nu am găsit o blocare automată a contului la depășirea pragului - regula se aplică administrativ.",
    },
    {
      q: "Când trebuie să îmi fac firmă?",
      a: "Când vânzările tale pe Artfest, ca „Creator Independent”, depășesc 10.000 lei într-un an - regulă Artfest, nu obligație fiscală confirmată aici. Până atunci poți vinde fără formă juridică.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: vendorRoutes.js, vendorStoreRoutes.js, vendorSettingRoutes.js, serviceTypesRoutes.js. Înregistrare vânzător: HeroSection.jsx (link /?auth=register&as=partner), Navbar.jsx (deschide modal Register defaultAsVendor), Register.jsx (câmp asVendor trimis la înregistrare), authRoutes.js (creează Vendor cu isActive:false la asVendor:true). Formă juridică/sellerType: vendorRoutes.js (ALLOWED_SELLER_TYPES=[independent_creator, verified_business]), billingRoutes.js (validare câmpuri per tip), BillingTab.jsx (copy real: 'Creator Independent'/'Business Verificat'). Pragul de 10.000 lei/an e regulă de business primită direct de la echipa Artfest - NU am găsit nicio sursă juridică sau blocare tehnică automată în cod pentru acest prag. Verificat 2026-08-25.",
};
