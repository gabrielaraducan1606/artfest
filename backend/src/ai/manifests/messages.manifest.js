// backend/src/ai/manifests/messages.manifest.js

export const MESSAGES_MANIFEST = {
  id: "messages",

  title: "Mesaje / Inbox",

  audience: ["USER", "VENDOR"],

  /*
   * BUGFIX (audit GUEST, 2026-08-28): mesageria directă (sendMessage)
   * chiar necesită cont (audience rămâne USER/VENDOR pentru CINE
   * poate SCRIE un mesaj) - dar un GUEST care întreabă "Cum contactez
   * vânzătorul?" trebuie să primească un răspuns corect, nu "nu am
   * informații" (manifestul era complet invizibil pentru el în
   * retrieval). knowledgeAudience extinde DOAR cine poate GĂSI/CITI
   * despre mecanism, la fel cum se face deja în products.manifest.js.
   */
  knowledgeAudience: ["USER", "VENDOR", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Mesagerie directă între cumpărători și vânzători.",

  tags: [
    "mesaje",
    "inbox",
    "conversatie",
    "scrie vanzatorului",
    "contactez vanzatorul",
    "vorbesc cu vanzatorul",
  ],

  aliases: [
    "cum scriu vanzatorului",
    "unde imi vad mesajele",
    "nu am primit raspuns",
    "cum contactez vanzatorul",
    "cum iau legatura cu vanzatorul",
    "pot vorbi cu vanzatorul inainte sa comand",
    "pot intreba vanzatorul ceva inainte de comanda",
    "cum trimit un mesaj vanzatorului fara cont",
  ],

  uiLocations: [
    { audience: "USER", path: "/cont/mesaje" },
    { audience: "VENDOR", path: "/mesaje" },
  ],

  capabilities: {
    sendMessage: { available: true },
    threadedConversations: { available: true },
  },

  limitations: [],
  flows: [],
  integrations: {},

  endpoints: {
    myThreads: {
      method: "GET",
      path: "/api/user-inbox",
      purpose: "Returnează firele de mesaje ale utilizatorului.",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Cum scriu vânzătorului?",
      a: "Din pagina produsului/magazinului, sau direct dintr-o comandă, poți deschide o conversație cu vânzătorul.",
    },
    {
      q: "Unde îmi văd mesajele?",
      a: "În secțiunea de mesaje/inbox din contul tău - acolo vezi toate conversațiile, atât ca și cumpărător cât și ca vânzător.",
    },
    {
      q: "Cum contactez vânzătorul?",
      a: "Ai nevoie de un cont pentru a scrie direct unui vânzător - odată autentificat, poți deschide o conversație din pagina produsului/magazinului, dintr-o cerere de ofertă directă către el, sau dintr-o comandă plasată. Dacă nu ai încă un cont, poți totuși posta o cerere publică (vizibilă tuturor vânzătorilor) fără cont, la care pot răspunde cu oferte.",
    },
    {
      q: "Pot vorbi cu vânzătorul înainte să comand?",
      a: "Da - poți cere o ofertă direct acelui vânzător (necesită cont) și discuta detalii înainte de a cumpăra, de obicei pornind din pagina produsului sau a magazinului lui. Fără cont, poți în schimb posta o cerere publică, vizibilă tuturor vânzătorilor, la care pot răspunde cu oferte.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: vendorMessageRoutes.js, userMessagesRoutes.js, vendorInboxThreadsRoutes.js. Verificat 2026-08-24. Extins 2026-08-28 (audit GUEST): knowledgeAudience + FAQ contact-vânzător, verificat direct în cod - assistantQuotesRoutes.js montează `router.use(authRequired, enforceTokenVersion)` la nivel de router, cu comentariu explicit \"Pentru cereri de ofertă cerem cont autentificat. Guest poate cumpăra direct în continuare, dar nu poate crea cereri de ofertă.\" (cerere directă la un vânzător = necesită cont); customerRequestsRoutes.js/quotes.manifest.js (createPublicRequest, audience USER+GUEST) confirmă că cererea publică rămâne posibilă fără cont.",
};
