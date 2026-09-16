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

    /*
     * Gap 2026-09-04 (audit Setări Vendor) - "Cum schimb costul
     * transportului?" ajungea, cu confidence 1, la manifestul
     * costs-profit (biblioteca de costuri pentru calculul prețului
     * produsului) - mecanism COMPLET diferit de setarea reală de
     * mai jos (vendorShippingCostSettings). Alias-uri explicite ca
     * să nu se mai suprapună cu costs-profit.
     */
    "cost transport",
    "cum schimb costul transportului",
    "cum modific costul de transport",
    "cost livrare",
    "cum schimb costul de livrare",
    "transport gratuit",
    "cum setez transport gratuit",
    "prag transport gratuit",
    "de la ce suma e transport gratuit",
    "taxa livrare",
    "cum schimb taxa de livrare",

    /*
     * Gap 2026-09-04 (audit Setări Vendor) - "Cum schimb datele
     * pentru retur?" nu avea răspuns (asistentul spunea că politica
     * de retur nu poate fi schimbată, ignorând complet datele reale
     * de retur pe care vendorul le editează).
     */
    "cum schimb datele pentru retur",
    "cum schimb adresa de retur",
    "cum schimb telefonul de retur",
    "cum schimb emailul de retur",
    "unde completez datele de retur",

    /*
     * BATCH C (audit regression Vendor Assistant, 2026-09-07) - 2
     * goluri reale rămase din auditul inițial (chunk4): "cine
     * plătește transportul" (id140) și "colet neridicat de curier"
     * (id148) nu aveau FAQ dedicat, deși restul manifestului era deja
     * corectat solid (2026-08-25/08-28/09-04, dinainte de această
     * sesiune).
     */
    "cine plateste transportul",
    "clientul plateste transportul",
    "eu platesc transportul ca vanzator",
    "curierul nu a ridicat coletul",
    "curierul nu vine sa ridice coletul",
    "ce fac daca curierul nu ridica coletul",
    "probleme cu awb",
    "probleme cu curierul",
  ],

  uiLocations: [
    { audience: "VENDOR", path: "/vendor/orders/:id (secțiunea Livrare)" },
    { audience: "VENDOR", path: "/setari?tab=shipping" },
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

    /*
     * Gap 2026-09-04 (audit Setări Vendor) - setare reală, distinctă
     * de calculul de profitabilitate (costs-profit) și de logistica
     * per-comandă de mai sus (schedulePickup/label/markPickedUp).
     * Sursă: SettingsPage.jsx (tab "shipping" -> ShippingSettings),
     * PATCH /api/vendors/me/services/:id.
     */
    vendorShippingCostSettings: {
      available: true,
      status: "ACTIVE",
      audience: ["VENDOR"],

      notes:
        "Costul de livrare afișat clientului la checkout (estimatedShippingFeeCents) și pragul de la care livrarea devine gratuită (freeShippingThresholdCents) se editează din Setări → Livrare și retururi (/setari?tab=shipping) - NU din Costuri & Profit (acolo se calculează profitabilitatea internă a produsului, nu costul afișat clientului). Există și un câmp liber de mențiuni livrare (shippingNotes).",
    },

    /*
     * Gap 2026-09-04 (audit Setări Vendor) - datele de retur SUNT
     * editabile, contrar răspunsului anterior care sugera că nimic
     * legat de retur nu poate fi schimbat.
     */
    vendorReturnContactData: {
      available: true,
      status: "ACTIVE",
      audience: ["VENDOR"],

      notes:
        "Adresa, telefonul și emailul folosite pentru retururi se editează din Setări → Livrare și retururi (/setari?tab=shipping) - distincte de datele de profil ale magazinului (publice) și de cele de facturare. Adresa de retur NU este afișată public (comentariu explicit în cod). Politica GENERALĂ de retur (/politica-retur) rămâne un document static, needitabil per vendor - doar datele de CONTACT pentru retur sunt configurabile.",
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

    updateShippingSettings: {
      method: "PATCH",
      path: "/api/vendors/me/services/:id",
      purpose: "Actualizează costul de livrare estimat, pragul de transport gratuit și mențiunile de livrare.",
      audience: ["VENDOR"],
    },

    updateReturnContactData: {
      method: "PUT",
      path: "/api/vendors/vendor-services/:id/profile",
      purpose: "Actualizează adresa, telefonul și emailul folosite pentru retururi.",
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
    {
      q: "Cum schimb costul transportului?",
      a: "Din Setări → Livrare și retururi (/setari?tab=shipping) - acolo găsești costul estimativ de livrare (suma pe care o vede clientul la checkout) și, opțional, un prag de la care livrarea devine gratuită. NU se schimbă din Costuri & Profit - acolo se calculează profitabilitatea produsului, nu costul afișat clientului.",
    },
    {
      q: "Cum setez transport gratuit de la o anumită sumă?",
      a: "Din Setări → Livrare și retururi (/setari?tab=shipping), completează câmpul „Transport gratuit de la (lei)”. Dacă îl lași gol, nu se aplică transport gratuit.",
    },
    {
      q: "Cine plătește transportul?",
      a: "Clientul - costul de livrare e afișat și adăugat la total încă din checkout, înainte de plată. Ca vânzător primești acea sumă odată cu plata comenzii (face parte din încasarea ta pentru comandă), dar tu ești cel care organizează și plătește efectiv relația cu propriul curier - platforma nu decontează separat cursele de curierat.",
    },
    {
      q: "Ce fac dacă curierul nu ridică coletul?",
      a: "Poți reprograma ridicarea din pagina comenzii (aceeași opțiune folosită și prima dată - alegi din nou o zi și un interval orar). Nu există încă un buton dedicat de \"raportează problemă cu curierul\" - dacă situația se repetă sau clientul e afectat, cel mai sigur e să contactezi suportul Artfest direct din asistent.",
    },
    {
      q: "Cum schimb datele pentru retur?",
      a: "Din Setări → Livrare și retururi (/setari?tab=shipping) poți edita adresa, telefonul și emailul folosite pentru retururi - sunt diferite de datele publice ale magazinului. Politica generală de retur (documentul de pe site) rămâne aceeași pentru toți vânzătorii, dar datele de CONTACT pentru retur sunt ale tale și le poți schimba oricând.",
    },

    /*
     * FINAL BATCH 3 (audit regression, 2026-09-07) - completate STRICT
     * pe fapte deja confirmate în cod (vezi endpoints/capabilities de
     * mai sus și notele existente ale acestui manifest) - IMPORTANT:
     * unde funcția NU există (alegere curier, generare AWB de vendor),
     * răspunsul o spune clar, nu inventează o funcționalitate.
     */
    {
      q: "Cum adaug mențiuni despre livrare?",
      a: "Din Setări → Livrare și retururi (/setari?tab=shipping), câmpul liber „Mențiuni livrare” (shippingNotes) - text afișat clientului alături de costul de livrare.",
    },
    {
      q: "Cum fac AWB?",
      a: "Nu generezi tu AWB-ul - generarea etichetei AWB e strict o acțiune internă (admin/curier), nu un flux disponibil vendorului. Tu doar programezi ridicarea coletului din pagina comenzii; dacă există deja o etichetă AWB generată pentru acea expediere, o poți descărca de acolo.",
    },
    {
      q: "Cum adaug AWB la comandă?",
      a: "Nu poți adăuga tu un AWB - nu există această acțiune pentru vendor. Dacă a fost deja generat (intern, de admin/curier), apare automat disponibil pentru descărcare pe pagina comenzii.",
    },
    {
      q: "Cum văd AWB-ul unei comenzi?",
      a: "Din pagina comenzii respective - dacă există deja o etichetă AWB generată pentru acea expediere, ai acolo opțiunea de descărcare. Nu e garantat că există pentru fiecare comandă.",
    },
    {
      q: "Pot alege curierul cu care lucrez?",
      a: "Nu există o selecție de curier în platformă - tu îți organizezi livrarea cu propriul curier, în afara Artfest. Platforma nu îți oferă o listă de curieri din care să alegi, doar te ajută să programezi ridicarea și să anunți clientul.",
    },
    {
      q: "Pot alege eu, ca cumpărător, curierul care îmi livrează comanda?",
      a: "Nu - fiecare vânzător își organizează livrarea cu propriul curier, ales de el, nu de tine. Nu poți selecta un curier la checkout; poți vedea metoda de livrare (curier sau, unde e cazul, locker) doar după ce vânzătorul o configurează pentru magazinul lui.",
    },
    {
      q: "Ce fac dacă îmi întârzie coletul?",
      a: "Nu există în platformă un buton dedicat de „raportează întârziere” pentru cumpărător. Cel mai sigur pas e să contactezi suportul Artfest, cu numărul comenzii - echipa poate verifica statusul și, dacă e nevoie, contacta vânzătorul.",
    },
    {
      q: "Ce fac dacă nu am primit coletul deloc?",
      a: "Contactează suportul Artfest cu numărul comenzii - nu există un flux self-service pentru acest caz în platformă. Nu confirma din propria inițiativă că ai primit comanda dacă nu e adevărat.",
    },
    {
      q: "Ce fac dacă statusul arată livrat, dar eu nu am primit coletul?",
      a: "Contactează suportul Artfest imediat, cu numărul comenzii - statusul „livrat” vine de la curier/vânzător, dar nu există în platformă un flux self-service de contestare a acestui status pentru cumpărător.",
    },
    {
      q: "Ce fac dacă linkul/AWB-ul de urmărire nu funcționează?",
      a: "Contactează suportul Artfest cu numărul comenzii - generarea și corectitudinea AWB-ului sunt gestionate de vânzător/echipa Artfest, nu există o acțiune pe care cumpărătorul o poate face singur pentru a repara un link de urmărire nefuncțional.",
    },
    {
      q: "Ce curieri sunt disponibili?",
      a: "Niciunul prestabilit de platformă - Artfest nu are o listă de curieri parteneri din care alegi. Tu folosești propriul curier (relația ta, în afara platformei); Artfest te ajută doar să programezi ridicarea și să notifici clientul.",
    },
    {
      q: "Cum schimb curierul?",
      a: "Nu e o setare din platformă - curierul nu e „ales” în Artfest, e relația ta proprie, externă, cu o firmă de curierat. Dacă vrei să folosești alt curier, pur și simplu predai coletul acelei firme - nu trebuie să schimbi nimic în cont.",
    },
    {
      q: "Pot oferi transport gratuit doar la anumite comenzi?",
      a: "Nu manual, per comandă - pragul de transport gratuit (Setări → Livrare și retururi) e o valoare unică, la nivel de magazin: comenzile care trec de acel total în lei primesc automat transport gratuit, restul nu. Nu poți alege manual comenzi individuale pentru transport gratuit.",
    },
    {
      q: "Ce fac dacă AWB-ul nu se generează?",
      a: "Generarea AWB nu e o acțiune a vendorului (e internă, admin/curier), deci nu ai un buton de „regenerare”. Dacă o comandă are nevoie de AWB și nu apare, cel mai sigur e să contactezi suportul Artfest direct din asistent, cu numărul comenzii - diferit de cazul „curierul nu ridică coletul” (acela ai unde să-l reprogramezi tu, din pagina comenzii).",
    },
    {
      q: "Unde sunt setările de livrare?",
      a: "Setări → Livrare și retururi (/setari?tab=shipping) - acolo găsești costul de livrare, pragul de transport gratuit, mențiunile de livrare și datele de contact pentru retur.",
    },
  ],

  unavailableFeatures: [
    "Comandă/dispecerizare automată a unui curier de către platformă",
    "Generare AWB garantată pentru fiecare comandă, disponibilă direct vendorului",
  ],

  notes:
    "Sursă: vendorOrdersRoutes.js (schedule-pickup, label, mark-picked-up - toate vendor-facing, verificate ca reale și funcționale), adminPickupsRoutes.js (curier/AWB - STRICT admin, nu vendor), samedayRoutes.js (doar lookup adrese pentru checkout). Corectat 2026-08-25 după confirmare directă: vendorii își organizează curieratul pe cont propriu, platforma NU cheamă automat un curier. Extins 2026-08-28 (audit GUEST) cu FAQ din perspectiva cumpărătorului - verificat în chekoutRoutes.js: `quote.shipments` (preț + metodă COURIER/LOCKER per vânzător) există deja, cu preț calculat, ÎNAINTE de tx.order.create (deci costul e cunoscut/afișat înainte de confirmarea plății); expediere separată per vânzător confirmată de bucla `for (const s of quote.shipments) tx.shipment.create({ vendorId: s.vendorId, ... })`. Nu există în cod un termen de livrare fix/garantat de platformă (distinct de leadTimeDays, care e timpul de REALIZARE al produsului, nu de transport). FIX 2026-09-04 (audit Setări Vendor): adăugate capabilities vendorShippingCostSettings/vendorReturnContactData + FAQ - „Cum schimb costul transportului?” răspundea anterior, cu confidence 1, cu manifestul greșit (costs-profit, care e despre calculul profitabilității produsului, nu costul afișat clientului); „Cum schimb datele pentru retur?” nu avea deloc răspuns. Sursă verificată direct în cod: SettingsPage.jsx (ShippingSettings component, tab='shipping'), PATCH /api/vendors/me/services/:id (estimatedShippingFeeCents, freeShippingThresholdCents, shippingNotes), PUT /api/vendors/vendor-services/:id/profile (address/phone/email pentru retur, cu mirrorVendor:true).\n\nBATCH C (audit regression Vendor Assistant, 2026-09-07): manifestul era deja solid (corectat 2026-08-25/08-28/09-04, înainte de această sesiune) - adăugate doar cele 2 goluri reale rămase din auditul inițial (chunk4, 12 FAIL): FAQ \"Cine plătește transportul?\" (clientul, la checkout; vendorul organizează/plătește propriul curier) și \"Ce fac dacă curierul nu ridică coletul?\" (reprogramare din aceeași rută schedule-pickup, vendorOrdersRoutes.js:4300 - nu există flux dedicat de raportare problemă, verificat prin grep, nu inventat). Nu s-a construit tool LIVE nou pentru status pickup/AWB specific - deja acoperit de vendorAssistantOrders.js (Batch 4, topic AWAITING_SHIP -> READY_FOR_PICKUP/PICKUP_SCHEDULED), fără duplicare.",
};
