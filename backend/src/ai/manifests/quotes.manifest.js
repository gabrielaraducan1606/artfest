// backend/src/ai/manifests/quotes.manifest.js

/*
 * Domeniul "cereri de ofertă" are DOUĂ fluxuri active, distincte,
 * verificate în cod (nu doar unul, cum am presupus inițial):
 *
 * 1. Cereri publice (customerRequestsRoutes.js, montat la
 *    /api/customer-requests) - userul postează public o cerere
 *    ("vreau X personalizat"), mai mulți vânzători pot răspunde
 *    cu oferte. UI: /cereri, /cereri/:id
 *    (CustomerRequestsPage/CustomerRequestDetailsPage - confirmat
 *    wired în App.jsx).
 *
 * 2. Oferte prin AI assistant (assistantQuotesRoutes.js, montat la
 *    /api/assistant/quotes) - flow ghidat de widget-ul de chat,
 *    conversație 1:1 cu mesaje și oferte. UI:
 *    components/AIAssistant/quotes/.
 *
 * Ambele sunt ACTIVE - documentate aici separat, ca să nu se
 * confunde răspunsurile date userului.
 */

export const QUOTES_MANIFEST = {
  id: "quotes",

  title: "Cereri de ofertă / Cer o ofertă personalizată",

  /*
   * BUGFIX (audit): GUEST adăugat la nivel de manifest - endpoint-ul
   * de creare a unei cereri publice de ofertă e deja USER+GUEST (vezi
   * endpoints.createPublicRequest), dar audience-ul de la nivelul
   * manifestului îl excludea pe GUEST din retrieval, deci era
   * invizibil pentru orice vizitator neautentificat care întreabă
   * "Cum cer o ofertă personalizată?".
   */
  audience: ["USER", "VENDOR", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Userul poate cere un produs personalizat în două moduri: (1) postează o cerere publică pe care mai mulți vânzători o pot vedea și oferta, sau (2) cere o ofertă direct printr-o conversație ghidată în asistentul AI.",

  tags: [
    "cerere oferta",
    "comanda personalizata",
    "cer o oferta",
    "produs la comanda",
    "cerere publica",
    "oferta personalizata",
    "link de promovare",
  ],

  aliases: [
    "cum cer o oferta",
    "vreau ceva personalizat",
    "unde imi vad cererile",
    "cum raspund la o cerere de oferta",
    "cerere publica",
    "cerere oferta homepage",
    "primesc oferte de la mai multi",
    "cer oferta unui vanzator",
    "cer oferta pentru produs",
    "oferta personalizata",
    "cererile mele",
    "care e diferenta dintre cerere publica si oferta directa",
  ],

  uiLocations: [
    { audience: "USER", path: "/cereri" },
    { audience: "USER", path: "/cereri/:id" },
    { audience: "USER", path: "widget AI assistant - Cereri ofertă" },
    { audience: "VENDOR", path: "widget AI assistant - Oferte vendor" },
  ],

  capabilities: {
    publicRequestBoard: {
      available: true,
      notes: "customer-requests: cerere publică, mai mulți vânzători pot oferta.",
    },

    assistantGuidedQuote: {
      available: true,
      notes: "assistant/quotes: conversație ghidată 1:1 în chat.",
    },

    offerAcceptReject: { available: true },
    imageModeration: {
      available: true,
      notes: "Imaginile atașate la cererea publică trec prin moderare AI.",
    },
  },

  limitations: [
    "Sunt două fluxuri distincte (cerere publică vs. asistent AI) - nu sunt unificate într-un singur loc.",
  ],

  flows: [
    {
      name: "cerere publică",
      steps: ["creare cerere", "vânzători ofertă", "acceptare/respingere ofertă"],
    },
  ],

  integrations: {},

  endpoints: {
    createPublicRequest: {
      method: "POST",
      path: "/api/customer-requests",
      purpose: "Creează o cerere publică de ofertă.",
      audience: ["USER", "GUEST"],
    },

    listPublicRequests: {
      method: "GET",
      path: "/api/customer-requests",
      purpose: "Listează cererile publice.",
      audience: ["USER", "VENDOR", "GUEST"],
    },

    myAssistantQuotes: {
      method: "GET",
      path: "/api/assistant/quotes/me",
      purpose: "Returnează ofertele/cererile prin asistentul AI ale userului.",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Cum funcționează cererile de ofertă?",
      a: "Există DOUĂ moduri diferite: (1) Cerere publică - o postezi din pagina „Cereri” (buton „Publică o cerere”), o văd mai mulți vânzători, care pot trimite oferte; alegi tu oferta care ți se potrivește. (2) Cerere directă către un vânzător - o pornești din pagina unui produs/magazin sau direct în conversația cu asistentul, e o discuție 1:1 doar cu acel vânzător, ghidată pas cu pas (cantitate, detalii). Nu sunt unificate - alegi unul din cele două, în funcție de ce vrei.",
    },
    {
      q: "Cum cer o ofertă pentru un produs personalizat?",
      a: "Poți posta o cerere publică din pagina „Cereri”, la care mai mulți vânzători pot răspunde cu oferte, sau poți cere direct în chat-ul asistentului AI o ofertă ghidată, de la un singur vânzător (de obicei pornind dintr-o pagină de produs/magazin).",
    },
    {
      q: "Care e diferența dintre o cerere publică și o ofertă directă la un vânzător?",
      a: "Cererea publică e vizibilă tuturor vânzătorilor, care pot trimite oferte independent - alegi tu care ți se potrivește. Oferta directă e o conversație doar cu UN vânzător anume, de obicei pornind de la un produs sau magazin care te-a interesat deja.",
    },
    {
      q: "Cum public o cerere la care pot răspunde mai mulți vânzători?",
      a: "Din pagina „Cereri” (accesibilă și de pe homepage), apeși „Publică o cerere” - completezi ce cauți, iar vânzătorii interesați îți vor trimite oferte.",
    },
    {
      q: "Cum cer ofertă direct unui vânzător?",
      a: "De obicei pornind din pagina unui produs sau a unui magazin care te interesează - asistentul te ghidează prin câteva întrebări (cantitate, detalii) și trimite cererea direct acelui vânzător.",
    },
    {
      q: "Unde îmi văd cererile mele?",
      a: "Din asistent, cerându-i „arată-mi cererile mele”, sau din pagina dedicată din contul tău - vezi cererile trimise, conversațiile cu vânzătorii și ofertele primite. Asta e doar listare, nu creează o cerere nouă.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: customerRequestsRoutes.js (confirmat montat în server.js la /api/customer-requests, consumat de 5 fișiere frontend sub pages/Home/CustomerRequestsSection/, wired în App.jsx la /cereri și /cereri/:id) + assistantRoutes/assistant/assistantQuotesRoutes.js (montat la /api/assistant/quotes) + vendorQuotesRoutes.js. Verificat 2026-08-24 - NU e legacy, e un flow activ separat. BUGFIX (audit 2026-08-26): asistentul confunda cele două concepte în routing (client-side) - reparat cu detectQuoteRequestIntent (assistantQuotes.js), care distinge semantic CREATE_PUBLIC_REQUEST (ghidează spre /cereri, fără flow conversațional de creare - nu există endpoint pentru asta apelat din widget) de REQUEST_VENDOR_QUOTE (flow conversațional existent, createQuoteRequest -> POST /api/assistant/quotes, pornit acum și din text liber, nu doar din butonul dedicat de pe pagina de produs/magazin) și de simpla listare (\"cererile mele\").",
};
