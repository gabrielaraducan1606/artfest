// backend/src/ai/manifests/support.manifest.js

export const SUPPORT_MANIFEST = {
  id: "support",

  title: "Suport / Tichete",

  audience: ["USER", "VENDOR", "GUEST", "ADMIN"],

  available: true,
  status: "ACTIVE",

  description:
    "Suportul Artfest: asistentul AI încearcă întâi să ajute (răspunsuri, pași de verificare) și DOAR dacă nu reușește propune deschiderea unui tichet, cu confirmarea explicită a userului/vendorului. Există și un formular de contact suport separat, pentru deschidere directă a unui tichet, plus o pagină cu tichetele proprii și mesajele pe fiecare tichet.",

  tags: [
    "suport",
    "tichet",
    "ticket",
    "help",
    "problema",
    "eroare",
    "contact suport",
    "vorbesc cu cineva",
  ],

  aliases: [
    "vreau sa vorbesc cu suportul",
    "vreau sa vorbesc cu cineva",
    "am o problema",
    "imi da eroare",
    "nu merge",
    "unde imi vad tichetele",
    "cum contactez suportul",
    "cum deschid un tichet",
  ],

  uiLocations: [
    { audience: "GUEST", path: "/support" },
    { audience: "USER", path: "/account/support" },
    { audience: "USER", path: "/account/support/tickets/:ticketId" },
    { audience: "VENDOR", path: "/support (vendor)" },
    { audience: "ADMIN", path: "/admin (support)" },
  ],

  capabilities: {
    createTicket: { available: true },
    ticketMessages: { available: true },
    ticketStatus: { available: true },
    faq: { available: true },

    aiTriesFirst: {
      available: true,

      notes:
        "Când scrii o problemă direct în asistent, acesta încearcă întâi să te ajute (pași de verificare, informații relevante) - propune tichet DOAR dacă nu reușește să rezolve.",
    },

    confirmBeforeTicketCreate: {
      available: true,

      notes:
        "Tichetul propus de asistent NU se creează automat - ți se arată un rezumat și trebuie să confirmi explicit (buton sau răspuns 'da') înainte să fie trimis.",
    },
  },

  limitations: [
    "Tichetul are prioritate LOW/MEDIUM/HIGH - nu există nivel URGENT momentan.",
    "Tichetul nu are câmpuri structurate pentru orderId/productId/domeniu - doar categorie text liberă și mesaj (contextul relevant e inclus în textul mesajului).",
  ],

  flows: [
    {
      name: "Prin formularul de contact suport (direct)",
      steps: ["subiect", "categorie", "mesaj", "prioritate", "trimitere (creează imediat)"],
    },

    {
      name: "Prin asistentul AI (încearcă să ajute întâi)",
      steps: [
        "Descrii problema în chat.",
        "Asistentul încearcă să te ajute direct sau cere maxim 1-2 clarificări.",
        "Dacă nu reușește să rezolve, propune un tichet și îți arată un rezumat.",
        "Tichetul se creează DOAR după ce confirmi explicit.",
      ],
    },
  ],

  integrations: {},

  endpoints: {
    createTicketGuest: {
      method: "POST",
      path: "/api/public/support/tickets",
      purpose: "Creează un tichet nou (accesibil și fără autentificare).",
      audience: ["GUEST"],
    },

    myTicketsUser: {
      method: "GET",
      path: "/api/support/me/tickets",
      purpose: "Returnează tichetele utilizatorului autentificat.",
      audience: ["USER"],
    },

    myTicketsVendor: {
      method: "GET",
      path: "/api/vendor/support/me/tickets",
      purpose: "Returnează tichetele vendorului autentificat.",
      audience: ["VENDOR"],
    },

    createTicketVendor: {
      method: "POST",
      path: "/api/vendor/support/tickets",
      purpose: "Vendorul deschide direct un tichet, din formular.",
      audience: ["VENDOR"],
    },

    faqs: {
      method: "GET",
      path: "/api/public/support/faqs",
      purpose: "Returnează întrebările frecvente.",
      audience: ["USER", "VENDOR", "GUEST"],
    },
  },

  faq: [
    {
      q: "Cum contactez suportul?",
      a: "Poți scrie direct problema ta aici, în asistent - încerc întâi să te ajut. Dacă nu reușesc, îți propun un tichet către echipa de suport, pe care îl trimit doar dacă confirmi. Poți deschide un tichet și direct, din pagina de contact suport.",
    },

    {
      q: "Vreau să vorbesc cu cineva",
      a: "Îți pot deschide un tichet către echipa de suport - spune-mi pe scurt despre ce e vorba și îți arăt un rezumat înainte să-l trimit.",
    },

    {
      q: "Unde văd tichetele mele?",
      a: "În secțiunea de suport din contul tău - acolo vezi toate tichetele deschise, statusul lor și poți continua conversația pe fiecare.",
    },

    {
      q: "Cum deschid un tichet?",
      a: "Fie direct din pagina de contact suport (completezi subiect, categorie și mesaj), fie prin asistent - descrii problema, iar dacă asistentul nu o poate rezolva, îți propune un tichet pe care îl confirmi înainte să fie trimis.",
    },
  ],

  unavailableFeatures: [
    "Prioritate URGENT pe tichete",
    "Legare structurată a tichetului de o comandă/produs anume (rămâne text liber în mesaj)",
  ],

  notes:
    "Sursă: prisma.SupportTicket (status OPEN/PENDING/CLOSED, priority LOW/MEDIUM/HIGH, audience USER/VENDOR/GUEST), guestSupportRoutes.js, publicSupportRoutes.js, userSupportRoutes.js, vendorSupportRoutes.js (me/tickets, tickets - confirmate reale), adminSupportRoutes.js, supportEscalationService.js/copilotRouter.js (fluxul AI încearcă-întâi-apoi-propune-tichet, deja implementat și activ). Corectat 2026-08-25: manifestul era scris ÎNAINTE de implementarea confirmării explicite la tichet (FAZA 8-10) și nu fusese actualizat - confirmBeforeTicketCreate era greșit marcat indisponibil.",
};
