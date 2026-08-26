// backend/src/ai/manifests/returns.manifest.js

export const RETURNS_MANIFEST = {
  id: "returns",

  title: "Retururi comenzi",

  /*
   * BUGFIX (audit): GUEST adăugat - politica de retur e o întrebare
   * legitimă și pentru un vizitator neautentificat, înainte de
   * cumpărare (era complet invizibil pentru GUEST în retrieval).
   */
  /*
   * BUGFIX (audit): VENDOR lipsea din audience - un vânzător e și
   * el cumpărător pe platformă (poate întreba "Cum fac retur?"), și
   * oricum ar putea avea nevoie să explice politica unui client.
   * Nicio capabilitate din acest manifest nu e VENDOR-executabilă
   * (doar user/admin), deci nu există niciun motiv de restricție.
   */
  audience: ["USER", "VENDOR", "ADMIN", "GUEST"],

  available: true,
  status: "PARTIAL",

  description:
    "Gestionarea retururilor pentru comenzi. Modelul ReturnRequest există în baza de date, iar admin-ul poate procesa retururi existente (listă, detaliu, schimbare status, creare AWB de retur prin curier). NU s-a găsit, în cod, niciun endpoint backend funcțional prin care un utilizator să CREEZE efectiv o cerere de retur - frontend-ul are un formular (ReturnRequestModal) care apelează POST /api/user/returns, dar acest endpoint nu este montat/implementat nicăieri în backend.",

  tags: ["retur", "returnare", "retur produs", "retur comanda", "retururi"],

  aliases: ["cum fac retur", "vreau sa returnez un produs", "politica de retur"],

  uiLocations: [
    { audience: "USER", path: "/comenzile-mele (modal Solicită retur)" },
    { audience: "ADMIN", path: "/admin (procesare retururi)" },
  ],

  capabilities: {
    userRequestReturn: { available: false, status: "PARTIAL" },
    adminListReturns: { available: true },
    adminUpdateReturnStatus: { available: true },
    adminCreateReturnShipment: { available: true },
  },

  limitations: [
    "Nu există confirmare, în cod, a unui endpoint backend funcțional pentru crearea unei cereri de retur de către utilizator (formularul din frontend trimite către un endpoint - POST /api/user/returns - care nu are un handler montat în server.js).",
    "În consecință, comportamentul confirmat este: retururile existente pot fi procesate doar de admin; nu poate fi confirmat un flux self-service funcțional de inițiere a unui retur de către client.",
  ],

  flows: [],

  integrations: {},

  endpoints: {
    adminList: {
      method: "GET",
      path: "/api/admin/returns",
      purpose: "Listează cererile de retur existente (admin).",
      audience: ["ADMIN"],
    },
    adminDetail: {
      method: "GET",
      path: "/api/admin/returns/:id",
      purpose: "Detaliile unei cereri de retur.",
      audience: ["ADMIN"],
    },
    adminUpdateStatus: {
      method: "PATCH",
      path: "/api/admin/returns/:id/status",
      purpose: "Schimbă statusul unei cereri de retur.",
      audience: ["ADMIN"],
    },
    adminCreateShipment: {
      method: "POST",
      path: "/api/admin/returns/:id/create-shipment",
      purpose: "Creează AWB-ul de retur (curier) pentru o cerere de retur existentă.",
      audience: ["ADMIN"],
    },
  },

  faq: [
    {
      q: "Cum fac retur?",
      a: "Nu am putut confirma, din cod, un flux funcțional prin care poți iniția singur o cerere de retur din platformă în acest moment. Recomandarea sigură este să contactezi echipa de suport cu numărul comenzii, pentru ca ei să înregistreze/proceseze returul manual.",
    },
  ],

  unavailableFeatures: [
    "Creare self-service a unei cereri de retur (endpoint lipsă/neconfirmat în backend)",
  ],

  notes:
    "Sursă: adminPickupsRoutes.js (singurul fișier din backend care referă modelul ReturnRequest), model Prisma ReturnRequest/ReturnRequestItem, frontend ReturnRequestModal.jsx (apelează POST /api/user/returns - fără corespondent găsit în server.js). Discrepanță de raportat: posibil bug/feature incomplet. Verificat 2026-08-24.",
};
