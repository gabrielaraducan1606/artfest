// backend/src/ai/manifests/ambassadorVendorProgram.manifest.js

export const AMBASSADOR_VENDOR_PROGRAM_MANIFEST = {
  id: "ambassador-vendor-program",

  title: "Programul de ambasadori pentru vânzători (referral vendor)",

  audience: ["VENDOR"],

  knowledgeAudience: ["VENDOR", "USER", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Program de recomandare (referral) pentru vânzători: fiecare vendor primește automat un cod și un link propriu de recomandare, cu care poate invita alți creatori pe platformă. Nivelul de ambasador crește automat în funcție de numărul de invitați acceptați (invitedCount). Este DIFERIT de programul 'influencer' (manifest separat, id: influencer) - acela e o înregistrare explicită pentru useri, nu un profil auto-generat de vendor.",

  tags: ["ambasador", "ambasadori", "program de ambasadori", "referral", "recomandare", "invitatii"],

  aliases: [
    "cum functioneaza programul de ambasadori",
    "cum devin ambasador artfest",
    "codul meu de recomandare",
    "link de invitatie vendor",
  ],

  uiLocations: [{ audience: "VENDOR", path: "/vendor (secțiunea Ambasadori)" }],

  capabilities: {
    autoEnrollment: { available: true },
    referralCodeAndLink: { available: true },
    levelProgression: { available: true },
    leaderboard: { available: true },
  },

  limitations: [
    "Disponibil doar pentru conturi de vendor (necesită un vendor existent) - nu există variantă pentru useri simpli.",
    "Nu există un pas explicit de 'înscriere' - profilul de ambasador este creat automat la prima accesare a secțiunii (GET /me).",
  ],

  flows: [
    {
      name: "Nivele program (după invitedCount)",
      steps: [
        "FOUNDING (Founding Creator) - de la 0 invitați.",
        "AMBASSADOR (Ambasador) - de la 3 invitați.",
        "GOLD (Ambasador Gold) - de la 10 invitați.",
        "ELITE (Ambasador Elite) - de la 25 invitați.",
      ],
    },
  ],

  integrations: {},

  endpoints: {
    me: {
      method: "GET",
      path: "/api/ambassadors/me",
      purpose: "Returnează (și creează automat, dacă nu există) profilul de ambasador al vendorului: cod și link de recomandare, nivel, oraș, număr invitați.",
      audience: ["VENDOR"],
    },
    leaderboard: {
      method: "GET",
      path: "/api/ambassadors/leaderboard",
      purpose: "Clasamentul public al ambasadorilor.",
      audience: ["USER"],
    },
    benefits: {
      method: "GET",
      path: "/api/ambassadors/benefits",
      purpose: "Lista beneficiilor pe fiecare nivel.",
      audience: ["USER"],
    },
    mission: {
      method: "GET",
      path: "/api/ambassadors/mission",
      purpose: "Statistici despre misiunea platformei (număr creatori curent/țintă).",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Cum funcționează programul de ambasadori?",
      a: "Ca vendor, primești automat un cod și un link propriu de recomandare (vizibile în secțiunea Ambasadori din contul tău). Nivelul tău (Founding Creator, Ambasador, Gold, Elite) crește automat pe măsură ce inviți alți creatori care se înregistrează prin link-ul tău - nu trebuie să te înscrii separat.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: backend/src/routes/ambassadorRoutes.js, model Prisma AmbassadorProfile. Distinct de manifestul 'influencer' (influencerRoutes.js/adminInfluencersRoutes.js), care e un program separat, cu înregistrare explicită pentru useri. Verificat 2026-08-24.",
};
