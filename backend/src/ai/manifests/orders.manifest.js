// backend/src/ai/manifests/orders.manifest.js

export const ORDERS_MANIFEST = {
  id: "orders",

  title: "Comenzi",

  audience: ["USER", "VENDOR", "ADMIN", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Plasarea, urmărirea și administrarea comenzilor - atât pentru cumpărători (comenzile mele), cât și pentru vânzători (gestionare comenzi primite), inclusiv comenzi ca guest (fără cont).",

  tags: [
    "comanda",
    "comenzile mele",
    "status comanda",
    "statusul comenzii",
    "urmarire comanda",
    "avans",
    "plata la livrare",
    "cod",
    "am primit o comanda",
    "ce fac cu o comanda noua",
    "anulare comanda",
    "anulez comanda",
  ],

  aliases: [
    "unde imi vad comenzile",
    "comanda nu apare",
    "cum urmaresc comanda",
    "ce inseamna avansul",
    "pot plati ramburs",
    "ce inseamna statusul asta",
    "ce inseamna statusurile comenzilor",
    "am primit o comanda ce trebuie sa fac acum",
    "ce fac dupa ce primesc o comanda",
    "cand marchez comanda ca expediata",
    "ce inseamna confirmata",
    "ce inseamna finalizata",
    "cum anulez o comanda",
    "pot anula o comanda",
    "vreau sa anulez comanda",
    "ce se intampla daca clientul refuza coletul",
    "clientul a refuzat coletul",
    "colet refuzat",
    "du-ma la comenzi",
    "deschide comenzile",
    "arata-mi comenzile",
    "vezi comenzile",
    "mergi la comenzi",
  ],

  uiLocations: [
    { audience: "USER", path: "/comenzile-mele" },
    { audience: "USER", path: "/comanda/:id" },
    { audience: "VENDOR", path: "/vendor/orders" },
    { audience: "VENDOR", path: "/vendor/orders/:id" },
    { audience: "VENDOR", path: "/vendor/orders/planning" },
    { audience: "GUEST", path: "guest order tracking" },
  ],

  capabilities: {
    userOrderHistory: { available: true },
    vendorOrderManagement: { available: true },
    guestOrderTracking: { available: true },
    deposit: {
      available: true,

      notes:
        "Avans opțional, doar pe comenzi ramburs, la cererea vendorului - vezi manifestul checkout-payments pentru detalii.",
    },
    cod: { available: true, notes: "Plată ramburs la livrare." },

    userCancelOwnOrder: {
      available: true,
      status: "ACTIVE",
      audience: ["USER"],

      notes:
        "Clientul își poate anula singur comanda, cât timp e în starea 'în așteptare' sau 'în procesare' și niciun colet nu a intrat deja în pregătire/expediere.",
    },
  },

  limitations: [
    "Pentru comenzile plătite online (card), vendorul NU poate avansa statusul (În pregătire/Confirmată/Predată/Finalizată) până când plata clientului nu este confirmată - blocaj automat, de siguranță.",
    "Clientul poate anula singur o comandă DOAR cât timp e 'în așteptare' sau 'în procesare' - odată ce vendorul a început pregătirea/expedierea, clientul nu mai poate anula singur, trebuie să contacteze suportul sau vendorul.",
  ],

  flows: [
    {
      name: "Statusurile unei comenzi (parte vendor)",
      steps: [
        "Nouă - comanda a fost plasată, vendorul nu a început încă procesarea.",
        "În pregătire - vendorul a început să pregătească comanda.",
        "Confirmată (gata de predare) - comanda e gata, așteaptă predarea către curier.",
        "Predată curierului - coletul a fost predat curierului (expediat).",
        "Finalizată - comanda a fost livrată/încheiată.",
        "Anulată - comanda a fost anulată (de vendor sau client).",
      ],
    },

    {
      name: "Ce faci după ce primești o comandă (ghid practic, vendor)",
      steps: [
        "Verifică detaliile comenzii (produse, cantități, adresă de livrare, opțiuni/personalizare cerute de client).",
        "Marchează comanda „În pregătire” și pregătește produsul/produsele.",
        "Când produsul e gata, marchează comanda „Confirmată (gata de predare)”.",
        "Programează ridicarea coletului (zi + interval orar) din pagina comenzii - vezi manifestul shipping-awb.",
        "După ce predai efectiv coletul curierului, marchează comanda „Predată curierului” - clientul e notificat automat.",
        "Când livrarea e confirmată, marchează comanda „Finalizată”.",
      ],
    },
  ],

  integrations: {},

  endpoints: {
    myOrders: {
      method: "GET",
      path: "/api/user/orders",
      purpose: "Returnează comenzile utilizatorului autentificat.",
      audience: ["USER"],
    },

    vendorOrders: {
      method: "GET",
      path: "/api/vendor/orders",
      purpose: "Returnează comenzile primite de vendor.",
      audience: ["VENDOR"],
    },

    updateOrderStatus: {
      method: "PATCH",
      path: "/api/vendor/orders/:id/status",
      purpose: "Vendorul schimbă statusul comenzii (în pregătire/confirmată/predată/finalizată/anulată).",
      audience: ["VENDOR"],
    },

    cancelOwnOrder: {
      method: "POST",
      path: "/api/user/orders/:id/cancel",
      purpose: "Clientul își anulează singur propria comandă, dacă e încă în starea 'în așteptare'/'în procesare'.",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Comanda nu apare în lista mea.",
      a: "Verifică dacă ai plasat comanda ca guest (fără cont) - în acest caz, comanda nu apare automat în „Comenzile mele”, ci poate fi urmărită separat prin linkul primit pe email.",
    },
    {
      q: "Ce înseamnă statusul unei comenzi?",
      a: "Pentru vânzător: Nouă (nepreluată încă) → În pregătire → Confirmată (gata de predare) → Predată curierului → Finalizată. O comandă poate fi și Anulată, în orice etapă înainte de finalizare.",
    },
    {
      q: "Am primit o comandă, ce trebuie să fac acum?",
      a: "Verifică detaliile comenzii, marchează-o „În pregătire” și pregătește produsul. Când e gata, marchează-o „Confirmată”, programează ridicarea coletului, iar după ce îl predai efectiv curierului, marchează comanda „Predată curierului” - clientul e notificat automat. Când livrarea e confirmată, marchezi comanda „Finalizată”.",
    },
    {
      q: "Când marchez comanda ca expediată?",
      a: "Abia după ce ai predat efectiv coletul curierului - marchezi „Predată curierului”, moment în care clientul primește automat un email cu detaliile.",
    },
    {
      q: "Ce înseamnă „confirmată”?",
      a: "Comanda e gata de predare - ai terminat de pregătit produsul și urmează doar să-l predai curierului.",
    },
    {
      q: "Ce înseamnă „finalizată”?",
      a: "Comanda a fost livrată clientului - ultimul pas al ciclului normal al unei comenzi.",
    },
    {
      q: "Cum anulez o comandă?",
      a: "Poți anula singur o comandă direct din contul tău, cât timp e încă „în așteptare” sau „în procesare” - înainte ca vânzătorul să înceapă pregătirea/expedierea. Odată ce comanda a avansat mai departe, nu mai poți anula singur - contactează suportul sau vânzătorul.",
    },
    {
      q: "Ce se întâmplă dacă clientul refuză coletul?",
      a: "Din pagina comenzii, vânzătorul marchează livrarea ca refuzată/anulată. Acțiunea inversează automat înregistrarea financiară din contul vânzătorului (comisionul și suma reținută pentru acea comandă se anulează prin efectul opus, ca și cum vânzarea nu ar fi avut loc), astfel încât evidența să rămână corectă. Nu există momentan o marcare automată separată de curier - vânzătorul e cel care actualizează statusul când află de refuz.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: userOrdersRoutes.js, vendorOrdersRoutes.js (PATCH /orders/:id/status - mapping UI→enum verificat direct în cod, plus blocajul de plată card neconfirmată), adminOrdersRoutes.js, guestOrderRoutes.js, STATUS_OPTIONS din frontend/src/pages/Vendor/Orders/Orders.jsx. Deposit/COD confirmate ca active, embedded în flow, nu module separate. Adăugat ghid operațional 2026-08-25, verificat din cod, nu inventat. Anulare de către client: POST /api/user/orders/:id/cancel (userOrdersRoutes.js, cancelOwnOrder) - condiție reală verificată în cod: uiStatus în PENDING/PROCESSING ȘI isOrderCancellable() (niciun shipment trecut de PENDING) - corectează o afirmație greșită găsită anterior (că doar vendorul poate anula), care nu era susținută de niciun manifest. Verificat 2026-08-26.",
};
