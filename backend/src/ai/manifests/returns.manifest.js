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

  tags: [
    "retur",
    "returnare",
    "retur produs",
    "retur comanda",
    "retururi",
    "drept de retragere",
    "retur comanda guest",
  ],

  aliases: [
    "cum fac retur",
    "vreau sa returnez un produs",
    "politica de retur",
    "pot returna daca am comandat fara cont",
    "retur comanda guest",
    "cate zile am la dispozitie pentru retur",
    "conditii de retur",
  ],

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
      a: "Nu am putut confirma, din cod, un flux funcțional prin care poți iniția singur o cerere de retur din platformă în acest moment. Condițiile de retur (termene, ce e eligibil) sunt descrise în pagina Politica de retur - pentru a chiar INIȚIA un retur, recomandarea sigură este să contactezi echipa de suport cu numărul comenzii, ca să-l înregistreze/proceseze manual.",
    },

    {
      q: "Unde găsesc condițiile de retur (termene, ce e eligibil)?",
      a: "În pagina Politica de retur, accesibilă din site (document legal static) - acolo sunt descrise condițiile. Fluxul PRACTIC de a iniția un retur, în schimb, nu e confirmat ca fiind self-service - contactează suportul.",
    },

    {
      q: "Pot face retur dacă am comandat fără cont (ca guest)?",
      a: "Nu am o confirmare separată din cod pentru acest caz, dar nu există niciun motiv să fie diferit - contactează suportul cu numărul comenzii (îl ai din emailul de confirmare), la fel ca un cumpărător cu cont.",
    },
    {
      q: "Cine aprobă/gestionează efectiv un retur?",
      a: "Echipa Artfest (admin) - confirmat direct în cod, procesarea retururilor existente (listare, schimbare status, creare AWB de retur) e strict o acțiune de admin, nu există nicio acțiune de retur pentru vânzător. Practic, orice retur trece prin support, nu direct prin vânzător.",
    },
    {
      q: "Produsele personalizate pot fi returnate?",
      a: "Nu am o confirmare tehnică sau legală separată în cod pentru acest caz - condițiile exacte (inclusiv eventuale excepții pentru produse personalizate) sunt descrise în pagina Politica de retur. Nu pot afirma cu certitudine dacă produsele personalizate sunt sau nu excluse - verifică acea pagină sau întreabă direct suportul.",
    },
    {
      q: "Cine plătește transportul de retur?",
      a: "Nu am găsit, în cod, o regulă tehnică care să stabilească asta (nu există un flux de retur self-service care să calculeze costul) - condițiile exacte sunt descrise în pagina Politica de retur. Cel mai sigur pas e să întrebi suportul, cu numărul comenzii, înainte să trimiți produsul înapoi.",
    },
    {
      q: "Unde trimit produsul pentru retur? Care e adresa de retur?",
      a: "Nu există o adresă de retur unică, generică - contactează suportul Artfest cu numărul comenzii; ei te vor îndruma spre vânzător sau spre adresa corectă. Nu trimite produsul înapoi din proprie inițiativă, fără să confirmi întâi adresa.",
    },
    {
      q: "Cum primesc banii înapoi dacă fac retur?",
      a: "Nu există în cod un termen fix confirmat pentru rambursare - condițiile sunt descrise în pagina Politica de retur. Contactează suportul cu numărul comenzii pentru a iniția procesul; nu pot confirma un interval exact de timp.",
    },
    {
      q: "Pot refuza coletul la livrare?",
      a: "Da, poți refuza un colet la livrare. Ce se întâmplă după: dacă refuzul are loc înainte ca vânzătorul să predea coletul curierului, comanda e anulată de vânzător; dacă refuzul are loc DUPĂ ce coletul a ajuns deja la curier (adică refuzi direct la curier, la ușă), statusul de anulare/retur e setat de echipa Artfest (admin), pe baza informației primite de la curier - vânzătorul e doar notificat, nu acționează el.",
    },
  ],

  unavailableFeatures: [
    "Creare self-service a unei cereri de retur (endpoint lipsă/neconfirmat în backend)",
  ],

  notes:
    "Sursă: adminPickupsRoutes.js (singurul fișier din backend care referă modelul ReturnRequest), model Prisma ReturnRequest/ReturnRequestItem, frontend ReturnRequestModal.jsx (apelează POST /api/user/returns - fără corespondent găsit în server.js). Discrepanță de raportat: posibil bug/feature incomplet. Verificat 2026-08-24. Extins 2026-08-28 (audit GUEST): pagina statică /politica-retur (vezi legalPrivacy.manifest.js, uiLocations) e sursa pentru CONDIȚIILE de retur (document legal, nu cod funcțional) - distinctă de acest manifest, care documentează FLUXUL (neconfirmat ca fiind self-service). Niciun tratament diferit confirmat pentru comenzi guest vs cont - nu există în cod vreo restricție care să lege returul de existența unui cont.",
};
