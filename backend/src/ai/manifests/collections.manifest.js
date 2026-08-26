// backend/src/ai/manifests/collections.manifest.js

export const COLLECTIONS_MANIFEST = {
  id: "collections",

  title: "Colecții de produse",

  audience: ["VENDOR", "USER", "ADMIN"],

  knowledgeAudience: ["VENDOR", "USER", "ADMIN", "GUEST"],

  available: true,
  status: "PARTIAL",

  description:
    "Colecțiile de produse (afișate public la /colectii/:slug și incluse în sitemap) sunt curate complet de echipa Artfest, din zona de admin. Nu s-a găsit, în cod, niciun endpoint prin care un vendor să poată solicita sau adăuga singur un produs într-o colecție.",

  tags: ["colectie", "colecție", "colectii", "colecții", "categorie"],

  aliases: ["cum intru intr-o colectie", "cum ajung intr-o colectie de produse"],

  uiLocations: [
    { audience: "USER", path: "/colectii/:slug" },
    { audience: "ADMIN", path: "/admin (gestiune colecții)" },
  ],

  capabilities: {
    vendorRequestInclusion: { available: false },
    adminCurateCollections: { available: true },
    publicBrowse: { available: true },
  },

  limitations: [
    "Nu există un formular sau endpoint prin care vendorul să solicite includerea unui produs într-o colecție - toate rutele de gestiune a colecțiilor găsite în cod sunt exclusiv admin (adminCollectionsroutes.js).",
    "Câmpul promoCollectionId, vizibil vendorului pe unele produse cu reducere, este doar informativ (setat de platformă), nu editabil de vendor.",
  ],

  flows: [],

  integrations: {},

  endpoints: {
    adminList: {
      method: "GET",
      path: "/api/admin/collections",
      purpose: "Listează colecțiile (admin).",
      audience: ["ADMIN"],
    },
    adminCreate: {
      method: "POST",
      path: "/api/admin/collections",
      purpose: "Creează o colecție nouă (admin).",
      audience: ["ADMIN"],
    },
    adminDetail: {
      method: "GET",
      path: "/api/admin/collections/:id",
      purpose: "Detaliile unei colecții (admin).",
      audience: ["ADMIN"],
    },
  },

  faq: [
    {
      q: "Cum intru într-o colecție?",
      a: "Colecțiile sunt curate manual de echipa Artfest, din zona de admin - nu există un formular prin care un vendor să solicite sau să adauge singur un produs într-o colecție. Dacă vrei ca un produs de-al tău să apară într-o colecție tematică, contactează echipa Artfest.",
    },
  ],

  unavailableFeatures: ["Auto-includere sau solicitare de includere într-o colecție, din contul de vendor"],

  notes:
    "Sursă: backend/src/routes/adminCollectionsroutes.js (singurele rute pentru modelul Collection), vendorProductRoutes.js (câmp promoCollectionId - doar afișare). Verificat 2026-08-24.",
};
