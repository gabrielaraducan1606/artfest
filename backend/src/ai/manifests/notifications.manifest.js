// backend/src/ai/manifests/notifications.manifest.js

export const NOTIFICATIONS_MANIFEST = {
  id: "notifications",

  title: "Notificări",

  audience: ["USER", "VENDOR"],

  /*
   * Fix 2026-09-04 (audit Setări Vendor, retest) - fără acest câmp,
   * knowledgeRetrieval.js cade pe `audience` (USER/VENDOR), ceea ce
   * face manifestul invizibil pentru un apel GUEST/neautentificat -
   * exact ce a cauzat FAIL-ul inițial la "Cum dezactivez notificările
   * pe email?" în testul live. Același pattern deja aplicat în
   * vendor-store-profile și shipping-awb.
   */
  knowledgeAudience: ["USER", "VENDOR", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Notificări în platformă despre comenzi, mesaje, oferte și alte evenimente relevante.",

  tags: ["notificari", "alerte"],

  aliases: [
    "unde imi vad notificarile",
    "nu primesc notificari",

    /*
     * Gap 2026-09-04 (audit Setări Vendor) - singurul toggle real de
     * notificări (emailOnNewOrder) nu era documentat deloc.
     */
    "cum dezactivez notificarile pe email",
    "cum opresc emailurile de comanda noua",
    "nu mai vreau email la comanda noua",
    "cum dezactivez emailul de comanda noua",

    /*
     * BATCH E (audit regression, 2026-09-07).
     */
    "cate notificari necitite am",
    "am notificari necitite",
    "ce notificari noi am",
    "primesc email la recenzie noua",
  ],

  uiLocations: [
    { audience: "USER", path: "/notificari" },
    { audience: "VENDOR", path: "/vendor/notifications" },

    /*
     * Locația reală a SINGURULUI toggle de notificări editabil -
     * verificat direct în cod. Contraintuitiv: checkbox-ul e în tab-ul
     * "Marketing" al paginii de setări, NU în tab-ul "Notificări" (care
     * e doar informativ, fără niciun control real) - vezi capability
     * emailOnNewOrderToggle mai jos.
     */
    { audience: "VENDOR", path: "/setari?tab=marketing" },
  ],

  capabilities: {
    inAppNotifications: { available: true },

    /*
     * BATCH E (audit regression, 2026-09-07) - tipuri reale confirmate
     * în cod (services/notifications.js, createVendorNotification):
     * review (recenzie/comentariu nou), follow (urmăritor nou),
     * shipping (evenimente de livrare), system (general/platformă),
     * plus message/quote (documentate separat în messages.manifest.js/
     * quotes.manifest.js - nu duplicate aici). TOATE sunt STRICT
     * in-app - niciun tip de notificare nouă (în afară de comanda nouă,
     * vezi emailOnNewOrderToggle) nu are și un email corespunzător.
     */
    notificationTypes: {
      available: true,
      notes:
        "Tipuri reale: recenzie/comentariu nou, urmăritor nou, evenimente de livrare, notificări generale de platformă, plus mesaj nou și ofertă nouă (documentate separat). Toate sunt doar in-app, fără email, cu excepția comenzii noi.",
    },

    unreadCount: {
      available: true,
      notes:
        "O notificare necitită are câmpul readAt gol; numărul de necitite se vede live, în timp real, nu e o valoare statică.",
    },

    /*
     * Gap 2026-09-04 (audit Setări Vendor). NU inventa alte toggle-uri
     * - acesta e SINGURUL control real găsit în cod pentru preferințe
     * de notificare (GET/PATCH /api/vendor/settings/notifications).
     * Tab-ul "Notificări" din /setari e doar informativ (SettingsPage.jsx:
     * "Notificările sunt informative... nu e nevoie să le configurezi") -
     * niciun toggle acolo. Checkbox-ul chiar editabil e sub tab-ul
     * "Marketing", secțiunea "Preferințe email vendor".
     */
    emailOnNewOrderToggle: {
      available: true,
      status: "ACTIVE",
      audience: ["VENDOR"],

      notes:
        "Checkbox 'Email comandă nouă' - controlează DOAR emailul trimis când un client plasează o comandă nouă. Se găsește în /setari?tab=marketing (nu în tab-ul 'Notificări', deși numele ar sugera asta). Emailurile esențiale (plăți, securitate) nu sunt afectate de acest toggle - rămân trimise indiferent de setare.",
    },
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

    getEmailPrefs: {
      method: "GET",
      path: "/api/vendor/settings/notifications",
      purpose: "Returnează preferința curentă emailOnNewOrder.",
      audience: ["VENDOR"],
    },

    updateEmailPrefs: {
      method: "PATCH",
      path: "/api/vendor/settings/notifications",
      purpose: "Activează/dezactivează emailul de comandă nouă.",
      audience: ["VENDOR"],
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
    {
      q: "Cum dezactivez notificările pe email?",
      a: "Singurul toggle real este pentru emailul de comandă nouă - îl găsești în Setări → Marketing (/setari?tab=marketing), la „Preferințe email vendor” → bifa „Email comandă nouă”. Emailurile esențiale (plăți, securitate) nu pot fi dezactivate și continuă să fie trimise indiferent de această setare.",
    },
    {
      q: "Cum schimb notificările?",
      a: "Notificările din platformă (in-app) nu au setări de configurare - sunt mereu active. Singurul control real e pentru EMAIL, și doar pentru comanda nouă: Setări → Marketing (/setari?tab=marketing), bifa „Email comandă nouă”. Contraintuitiv, nu e sub tab-ul „Notificări” (acela e strict informativ).",
    },
    {
      q: "Cum văd notificările necitite?",
      a: "În secțiunea de notificări din contul tău (/vendor/notifications) - cele necitite se văd live, în timp real. Poți întreba și direct asistentul „Câte notificări necitite am?” pentru numărul exact chiar acum.",
    },
    {
      q: "Ce notificări primesc?",
      a: "Notificări în platformă (nu email, cu excepția comenzii noi) la: recenzie sau comentariu nou primit, urmăritor nou, evenimente de livrare, mesaj nou, ofertă nouă la o cerere, plus notificări generale de platformă.",
    },
    {
      q: "Primesc email când primesc o recenzie nouă?",
      a: "Nu - recenziile noi generează doar o notificare în platformă, fără email. Singurul eveniment cu email este comanda nouă (și acela poate fi dezactivat separat).",
    },
  ],
  unavailableFeatures: [],

  notes:
    "Sursă: userNotificationsRoutes.js, vendorNotificationsRoutes.js. Verificat 2026-08-24. FIX 2026-09-04 (audit Setări Vendor): adăugat capability emailOnNewOrderToggle + FAQ - singurul toggle real găsit în cod (vendorSettingRoutes.js: GET/PATCH /api/vendor/settings/notifications), localizat contraintuitiv sub tab-ul 'Marketing' din SettingsPage.jsx, nu sub tab-ul 'Notificări' (acela e strict informativ). Nu există alte toggle-uri de notificări în cod - nu s-a inventat niciunul.\n\nBATCH E (audit regression Vendor Assistant, 2026-09-07): confirmat modelul Notification (schema.prisma:1825-1845) - readAt (null=necitit), archived, type (NotificationType, default system). Tipuri reale confirmate prin grep pe createVendorNotification (services/notifications.js): review, follow, shipping, system (plus message/quote, documentate în manifestele lor proprii). Confirmat prin grep pe mailer.js - NICIUN tip de notificare (în afară de comanda nouă) nu are și un email corespunzător - doar in-app. LIVE DATA (câte notificări necitite am): conectat prin vendorAssistantReviews.js (Batch E), reutilizează exact query-ul din GET /api/vendor/notifications/unread-count (vendorNotificationsRoutes.js:119, {vendorId, readAt:null, archived:false}).",
};
