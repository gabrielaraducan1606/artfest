// backend/src/ai/manifests/notifications.manifest.js

export const NOTIFICATIONS_MANIFEST = {
  id: "notifications",

  title: "Notificări",

  audience: ["USER", "VENDOR"],

  available: true,
  status: "ACTIVE",

  description:
    "Notificări în platformă despre comenzi, mesaje, oferte și alte evenimente relevante.",

  tags: ["notificari", "alerte"],

  aliases: [
    "unde imi vad notificarile",
    "nu primesc notificari",
  ],

  uiLocations: [
    { audience: "USER", path: "/notificari" },
    { audience: "VENDOR", path: "/vendor/notifications" },
  ],

  capabilities: {
    inAppNotifications: { available: true },
  },

  limitations: [],
  flows: [],
  integrations: {},

  endpoints: {
    myNotifications: {
      method: "GET",
      path: "/api/notifications",
      purpose: "Returnează notificările utilizatorului.",
      audience: ["USER", "VENDOR"],
    },
  },

  faq: [
    {
      q: "Unde îmi văd notificările?",
      a: "În secțiunea de notificări din contul tău - primești acolo alerte despre comenzi, mesaje și alte evenimente relevante.",
    },
    {
      q: "Nu primesc notificări, ce fac?",
      a: "Verifică mai întâi secțiunea de notificări din cont - dacă informația e acolo dar nu ai primit alertă, spune-mi exact ce nu funcționează și te ajut să vedem ce se întâmplă.",
    },
  ],
  unavailableFeatures: [],

  notes:
    "Sursă: userNotificationsRoutes.js, vendorNotificationsRoutes.js. Verificat 2026-08-24.",
};
