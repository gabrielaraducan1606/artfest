// backend/src/ai/manifests/shippingAwb.manifest.js

export const SHIPPING_AWB_MANIFEST = {
  id: "shipping-awb",

  title: "Livrare și curier",

  audience: ["VENDOR", "ADMIN"],

  knowledgeAudience: ["VENDOR", "ADMIN", "USER", "GUEST"],

  available: true,
  status: "PARTIAL",

  description:
    "Vânzătorul își organizează SINGUR expedierea/curieratul comenzilor - platforma NU cheamă automat un curier în numele lui. Vânzătorul are un flow propriu, self-service, pentru a programa ridicarea coletului (zi/interval orar + dimensiuni), a descărca eticheta AWB dacă există deja una generată pentru comandă, și a marca expedierea ca predată curierului atunci când chiar se întâmplă.",

  tags: [
    "curier",
    "livrare",
    "expediere",
    "awb",
    "ridicare colet",
    "programare curier",
    "predare curier",
  ],

  aliases: [
    "cum programez curierul",
    "cum trimit o comanda",
    "cum trimit coletul",
    "artfest cheama curierul pentru mine",
    "trebuie sa programez eu curierul",
    "cine vine sa ridice coletul",
    "cum generez awb",
    "cum descarc eticheta awb",
    "cum functioneaza livrarea",
    "cine imi livreaza comanda",
    "cine expediaza comanda mea",
    "cat costa livrarea",
    "cand aflu costul de livrare",
    "ce metode de livrare exista",
    "livrare prin curier sau locker",
    "cat dureaza livrarea",
  ],

  uiLocations: [
    { audience: "VENDOR", path: "/vendor/orders/:id (secțiunea Livrare)" },
    { audience: "ADMIN", path: "/admin (pickups)" },
  ],

  capabilities: {
    vendorSchedulePickup: {
      available: true,
      notes:
        "Vendorul alege ziua (azi/mâine) și intervalul orar, plus dimensiunile coletului - platforma reține programarea, NU declanșează automat o comandă către o firmă de curierat.",
    },

    vendorDownloadLabel: {
      available: true,
      notes:
        "Doar dacă există deja o etichetă AWB generată pentru acea expediere - nu e garantat pentru fiecare comandă.",
    },

    vendorMarkPickedUp: {
      available: true,
      notes:
        "Vendorul confirmă manual, după ce coletul a fost ridicat efectiv - declanșează un email către client cu detaliile.",
    },

    automaticCourierDispatch: {
      available: false,

      notes:
        "Artfest NU trimite automat un curier la vendor - vendorul își organizează singur ridicarea/predarea coletului.",
    },
  },

  limitations: [
    "Vânzătorul este responsabil să organizeze efectiv ridicarea coletului (prin propria relație cu un curier) - programarea din platformă e doar o evidență/notificare, nu o comandă automată către o firmă de curierat.",
    "Eticheta AWB poate fi descărcată doar dacă există deja generată pentru acea expediere.",
  ],

  flows: [
    {
      name: "Livrarea unei comenzi, din perspectiva vendorului",
      steps: [
        "Vendorul programează ridicarea - alege ziua (azi/mâine) și un interval orar, completează dimensiunile/greutatea coletului.",
        "Dacă există deja o etichetă AWB generată pentru acea comandă, o poate descărca din pagina comenzii.",
        "Vendorul predă efectiv coletul curierului (organizat pe cont propriu).",
        "Vendorul marchează expedierea ca predată curierului - clientul primește automat un email cu detaliile.",
      ],
    },
  ],

  integrations: {
    sameday: {
      available: true,
      status: "PARTIAL",

      notes:
        "Folosit pentru date de adresă (județe/localități/coduri poștale/lockere) în checkout - nu confirmat ca declanșând automat o ridicare de curier la programarea vendorului.",
    },
  },

  endpoints: {
    schedulePickup: {
      method: "POST",
      path: "/api/vendor/shipments/:id/schedule-pickup",
      purpose: "Vendorul programează ziua/intervalul de ridicare și dimensiunile coletului.",
      audience: ["VENDOR"],
    },

    downloadLabel: {
      method: "GET",
      path: "/api/vendor/shipments/:id/label",
      purpose: "Descarcă eticheta AWB, dacă există deja generată.",
      audience: ["VENDOR"],
    },

    markPickedUp: {
      method: "POST",
      path: "/api/vendor/shipments/:id/mark-picked-up",
      purpose: "Vendorul confirmă că expedierea a fost predată curierului.",
      audience: ["VENDOR"],
    },

    adminAssignCourier: {
      method: "PATCH",
      path: "/api/admin/pickups/:shipmentId/courier",
      purpose: "Uz intern admin - NU e un flux disponibil vendorului.",
      audience: ["ADMIN"],
    },

    adminGenerateAwb: {
      method: "PATCH",
      path: "/api/admin/pickups/:shipmentId/awb",
      purpose: "Uz intern admin - NU e un flux disponibil vendorului.",
      audience: ["ADMIN"],
    },
  },

  faq: [
    {
      q: "Cum programez curierul?",
      a: "Din pagina comenzii, alegi ziua (azi/mâine) și intervalul orar de ridicare, plus dimensiunile coletului. Ridicarea efectivă rămâne organizată de tine, cu propriul tău curier - platforma doar reține programarea și anunță clientul.",
    },
    {
      q: "Artfest trimite/cheamă curierul pentru mine?",
      a: "Nu. Artfest nu organizează automat curierul - tu îți gestionezi singur expedierea. Platforma te ajută doar să programezi ridicarea, să descarci eticheta (dacă există) și să anunți clientul când ai predat coletul.",
    },
    {
      q: "Cum trimit o comandă?",
      a: "Programezi ridicarea din pagina comenzii (zi + interval orar + dimensiuni colet), predai coletul curierului tău, apoi marchezi comanda ca predată curierului - clientul e notificat automat.",
    },
    {
      q: "Cum funcționează livrarea, din perspectiva cumpărătorului?",
      a: "Fiecare vânzător își organizează singur livrarea produselor lui - Artfest nu are propria flotă de curieri. La checkout alegi metoda de livrare disponibilă (curier sau, unde e cazul, locker), iar costul de livrare e calculat și afișat înainte să confirmi și să plătești comanda, nu ulterior. Dacă ai produse de la mai mulți vânzători într-o comandă, fiecare își expediază separat partea lui, deci pot ajunge în colete diferite, în momente diferite.",
    },
    {
      q: "Cine îmi livrează efectiv comanda?",
      a: "Vânzătorul de la care ai cumpărat produsul, prin propriul curier - nu Artfest. Platforma te ajută să vezi statusul livrării și eticheta AWB (dacă există deja generată), dar predarea coletului o face vânzătorul.",
    },
    {
      q: "Cât durează livrarea?",
      a: "Depinde de fiecare vânzător și de curierul folosit de el - nu există un termen unic, fix, garantat de platformă. Pentru produsele realizate la comandă, se adaugă și timpul de realizare (lead time) afișat pe pagina produsului, înainte de a cumpăra.",
    },
  ],

  unavailableFeatures: [
    "Comandă/dispecerizare automată a unui curier de către platformă",
    "Generare AWB garantată pentru fiecare comandă, disponibilă direct vendorului",
  ],

  notes:
    "Sursă: vendorOrdersRoutes.js (schedule-pickup, label, mark-picked-up - toate vendor-facing, verificate ca reale și funcționale), adminPickupsRoutes.js (curier/AWB - STRICT admin, nu vendor), samedayRoutes.js (doar lookup adrese pentru checkout). Corectat 2026-08-25 după confirmare directă: vendorii își organizează curieratul pe cont propriu, platforma NU cheamă automat un curier. Extins 2026-08-28 (audit GUEST) cu FAQ din perspectiva cumpărătorului - verificat în chekoutRoutes.js: `quote.shipments` (preț + metodă COURIER/LOCKER per vânzător) există deja, cu preț calculat, ÎNAINTE de tx.order.create (deci costul e cunoscut/afișat înainte de confirmarea plății); expediere separată per vânzător confirmată de bucla `for (const s of quote.shipments) tx.shipment.create({ vendorId: s.vendorId, ... })`. Nu există în cod un termen de livrare fix/garantat de platformă (distinct de leadTimeDays, care e timpul de REALIZARE al produsului, nu de transport).",
};
