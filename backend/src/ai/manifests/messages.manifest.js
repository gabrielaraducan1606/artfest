// backend/src/ai/manifests/messages.manifest.js

export const MESSAGES_MANIFEST = {
  id: "messages",

  title: "Mesaje / Inbox",

  audience: ["USER", "VENDOR"],

  available: true,
  status: "ACTIVE",

  description:
    "Mesagerie directă între cumpărători și vânzători.",

  tags: ["mesaje", "inbox", "conversatie", "scrie vanzatorului"],

  aliases: [
    "cum scriu vanzatorului",
    "unde imi vad mesajele",
    "nu am primit raspuns",
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
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: vendorMessageRoutes.js, userMessagesRoutes.js, vendorInboxThreadsRoutes.js. Verificat 2026-08-24.",
};
