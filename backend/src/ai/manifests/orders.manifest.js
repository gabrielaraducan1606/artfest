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
    "comanda guest",
    "anulare comanda guest",
    "modific adresa comanda guest",
    "schimb telefon comanda guest",
    "pot anula comanda daca nu am cont",
    "pot anula comanda fara cont",
    "pot modifica telefonul dupa comanda",
    "pot schimba telefonul dupa comanda",
    "pot modifica adresa dupa comanda",
    "pot modifica personalizarea dupa comanda",
    "pot modifica personalizarea unei comenzi deja plasate",
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

    /*
     * BATCH 4 (audit regression, 2026-09-06) - perspectiva vendorului,
     * vocabular real de statusuri (verificat direct în cod) și
     * distincții care lipseau (anulare vs ștergere, avans real 15%).
     */
    "cum accept o comanda",
    "cum pregatesc o comanda",
    "cum marchez o comanda ca livrata",
    "ce inseamna pending",
    "ce inseamna processing",
    "ce inseamna shipped",
    "ce inseamna delivered",
    "ce inseamna canceled",
    "ce inseamna returned",
    "ce fac daca nu pot onora o comanda",
    "ce fac daca clientul nu raspunde",
    "cum vad detaliile unei comenzi",
    "cum vad metoda de plata",
    "cum vad daca s-a platit comanda",
    "cum cer avans",
    "ce inseamna avansul de 10 la suta",
    "pot cere plata integrala",
    "pot avea comanda ramburs",
    "ce fac cu o comanda ramburs",
    "cum sterg o comanda",
    "pot sterge o comanda",
    "cum vad comenzile plasate ca guest",
    "cate comenzi am",
    "ce comenzi noi am",
    "ce comenzi am in lucru",
    "ce comenzi asteapta expedierea",
    "ce comenzi sunt livrate",
    "ce comenzi sunt anulate",
    "ce comenzi sunt platite",
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
        "Avans FIX 15% din valoarea produselor (fără transport), opțional, doar pe comenzi ramburs (COD), la cererea vendorului - vezi manifestul checkout-payments pentru detalii complete.",
    },
    cod: { available: true, notes: "Plată ramburs la livrare." },

    userCancelOwnOrder: {
      available: true,
      status: "ACTIVE",
      audience: ["USER"],

      notes:
        "Clientul își poate anula singur comanda, cât timp e în starea 'în așteptare' sau 'în procesare' și niciun colet nu a intrat deja în pregătire/expediere.",
    },

    /*
     * Confirmat în cod (BATCH 4, audit 2026-09-06):
     * vendorOrdersRoutes.js, PATCH /orders/:id/status.
     */
    vendorCancelOwnOrder: {
      available: true,
      audience: ["VENDOR"],
      notes:
        "Vendorul poate anula o comandă DOAR cât timp shipment-ul e încă nouă/în pregătire/gata de predare (nu a fost încă predat curierului). Motiv opțional dintr-o listă fixă (client nu răspunde, client a cerut anularea, stoc epuizat, adresă incompletă, problemă de plată, alt motiv). Stocul rezervat e restaurat automat.",
    },

    vendorDeleteOrder: {
      available: false,
      notes:
        "Nu există nicio funcție de ȘTERGERE a unei comenzi, pentru niciun rol - nici pentru vendor, nici pentru admin (verificat: niciun endpoint DELETE pe comenzi/shipment-uri în cod). Singura acțiune posibilă e ANULAREA (comanda rămâne, doar schimbă statusul).",
    },

    postShipmentRefusalOrReturn: {
      available: true,
      audience: ["ADMIN"],
      notes:
        "STALE_KNOWLEDGE CORECTAT (audit 2026-09-06): după ce coletul a fost deja predat curierului, marcarea lui ca refuzat de client sau returnat NU se face de vendor, ci strict de echipa Artfest (admin), pe baza informației primite de la curier. Vendorul primește notificare live (SSE) când se întâmplă, iar reversarea comisionului/decontului se face automat, fără nicio acțiune din partea lui.",
    },

    guestOrderVisibility: {
      available: true,
      notes:
        "O comandă plasată fără cont (guest) e marcată ca atare (isGuestOrder) direct pe comandă - vizibilă în aceleași detalii ca orice altă comandă, nu există o secțiune separată pentru comenzile guest.",
    },

    paymentMethodVisibility: {
      available: true,
      notes:
        "Metoda de plată (card sau ramburs) și statusul plății (plătită/în așteptare) sunt afișate direct pe fiecare comandă din lista de comenzi a vendorului, fără click suplimentar.",
    },
  },

  limitations: [
    "Pentru comenzile plătite online (card), vendorul NU poate avansa statusul (În pregătire/Confirmată/Predată/Finalizată) până când plata clientului nu este confirmată - blocaj automat, de siguranță. Anularea rămâne posibilă oricând.",
    "Dacă vendorul a cerut avans pe o comandă ramburs, nu poate trece comanda „În pregătire” până când avansul nu e plătit de client.",
    "Clientul poate anula singur o comandă DOAR cât timp e 'în așteptare' sau 'în procesare' - odată ce vendorul a început pregătirea/expedierea, clientul nu mai poate anula singur, trebuie să contacteze suportul sau vendorul.",
    "Vendorul poate anula o comandă DOAR înainte ca ea să fie predată curierului - după acel moment, un refuz/retur se gestionează strict de admin (Artfest), nu de vendor.",
    "Nu există opțiune de ȘTERGERE a unei comenzi - doar anulare (comanda rămâne în istoric, cu status Anulată).",
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

    /*
     * BATCH 4 (audit regression, 2026-09-06) - CINCI concepte de
     * status DISTINCTE, verificate direct în cod, care nu trebuie
     * amestecate:
     * A. status intern comandă (Order.status): PENDING/PAID/FULFILLED/
     *    CANCELLED - grosier, la nivel de comandă întreagă.
     * B. status shipment (Shipment.status, granularitatea REALĂ pe
     *    care vendorul o vede și o schimbă): PENDING/PREPARING/
     *    READY_FOR_PICKUP/PICKUP_SCHEDULED/AWB/IN_TRANSIT/DELIVERED/
     *    REFUSED/RETURNED (userOrdersRoutes.js computeUiStatus,
     *    vendorOrdersRoutes.js PATCH /orders/:id/status).
     * C. status afișat CLIENTULUI (computeUiStatus - simplificat,
     *    userOrdersRoutes.js): PENDING/PROCESSING/SHIPPED/DELIVERED/
     *    CANCELED/RETURNED - vezi flow dedicat mai jos.
     * D. status plată (computeOrderPaymentState): paymentMethod
     *    (CARD/COD) + paymentStatus (PAID/PENDING/COD).
     * E. status avans/depozit (Shipment.depositStatus): NOT_REQUESTED/
     *    PENDING/PAID - independent de B-D, doar pe comenzi COD.
     */
    {
      name: "Statusul afișat clientului (C - simplificat, computeUiStatus)",
      steps: [
        "PENDING - comanda e nouă, plătită ramburs sau cu cardul încă neplătit; vendorul nu a pornit procesarea.",
        "PROCESSING - fie vendorul a început pregătirea (indiferent dacă a ajuns la 'gata de predare'), fie plata cu cardul a fost confirmată dar procesarea nu a pornit încă.",
        "SHIPPED - coletul a fost predat curierului (AWB emis sau în tranzit).",
        "DELIVERED - toate coletele comenzii au fost livrate.",
        "CANCELED - comanda a fost anulată de vendor sau de client, înainte de expediere.",
        "RETURNED - coletul a fost returnat expeditorului DUPĂ ce a ajuns la curier - se marchează STRICT de admin (Artfest), nu de vendor.",
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

    /*
     * BATCH 4 (audit regression, 2026-09-06) - confirmate direct în
     * vendorOrdersRoutes.js / adminPickupsRoutes.js.
     */
    requestDeposit: {
      method: "POST",
      path: "/api/vendor/shipments/:id/request-deposit",
      purpose: "Vendorul cere avans (fix 15%) pe o comandă ramburs, înainte de a începe procesarea.",
      audience: ["VENDOR"],
    },

    markRefusedPostShipment: {
      method: "PATCH",
      path: "/api/admin/pickups/:shipmentId/refused",
      purpose: "Marchează un colet deja predat curierului ca refuzat de client - STRICT admin, nu vendor.",
      audience: ["ADMIN"],
    },

    markReturned: {
      method: "PATCH",
      path: "/api/admin/pickups/:shipmentId/returned",
      purpose: "Marchează un colet ca returnat expeditorului - STRICT admin, nu vendor.",
      audience: ["ADMIN"],
    },

    /*
     * LIVE - conectat la Vendor Assistant (vezi
     * vendorAssistantOrders.js): câte comenzi am / noi / în lucru /
     * așteaptă expedierea / livrate / anulate / plătite.
     */
    countOrdersByStatus: {
      method: "GET",
      path: "/api/vendor/orders",
      purpose: "Numărul/lista de comenzi ale vendorului, filtrabile după status.",
      audience: ["VENDOR"],
      connectedToAssistant: true,
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
      q: "Cum anulez o comandă (ca vânzător)?",
      a: "Poți anula o comandă DOAR cât timp e încă Nouă, În pregătire sau Confirmată (gata de predare) - nu mai poți anula după ce ai predat-o curierului. Alegi opțional un motiv (clientul nu răspunde, clientul a cerut anularea, stoc epuizat, adresă incompletă, problemă de plată sau alt motiv). Stocul rezervat pentru acea comandă e restaurat automat.",
    },
    {
      q: "Ce fac dacă nu pot onora o comandă?",
      a: "O anulezi din pagina comenzii (cât timp nu a fost încă predată curierului), alegând motivul potrivit - de exemplu „stoc epuizat” sau „alt motiv”. Comanda rămâne în istoric cu statusul Anulată, nu dispare.",
    },
    {
      q: "Ce fac dacă clientul nu răspunde?",
      a: "Dacă nu poți finaliza comanda din cauza asta, o poți anula alegând motivul „Clientul nu răspunde la telefon” - vizibil apoi pe comandă, ca notă de anulare.",
    },
    {
      q: "Ce se întâmplă dacă clientul refuză coletul?",
      a: "STALE_KNOWLEDGE CORECTAT: dacă refuzul are loc ÎNAINTE ca tu să predai coletul curierului, îl anulezi tu, normal. Dacă refuzul are loc DUPĂ ce coletul a ajuns deja la curier (curierul raportează refuzul la livrare), NU tu marchezi asta - o face echipa Artfest (admin), pe baza informației de la curier. Tu primești automat o notificare când se întâmplă, iar comisionul/suma reținută pentru acea comandă se anulează automat, fără nicio acțiune din partea ta.",
    },
    {
      q: "Ce se întâmplă dacă o comandă este refuzată?",
      a: "Dacă refuzul e înainte de predarea către curier, comanda devine Anulată prin acțiunea ta. Dacă e după predare, statusul devine Anulată/Returnată prin acțiunea echipei Artfest, nu a ta - tu doar ești notificat, iar stocul și evidența financiară se ajustează automat.",
    },
    {
      q: "Cum șterg o comandă?",
      a: "Nu poți - nu există o opțiune de ștergere a comenzilor, pentru niciun rol. Singura acțiune posibilă este anularea, care schimbă statusul comenzii, dar o păstrează în istoric.",
    },
    {
      q: "Pot șterge o comandă?",
      a: "Nu. Poți doar anula o comandă (cât timp nu a fost predată curierului) - nu există nicio funcție care să șteargă definitiv o comandă din sistem.",
    },
    {
      q: "Ce înseamnă PENDING?",
      a: "Comanda e nouă - fie plătește ramburs și încă nu ai început procesarea, fie a fost plătită cu cardul dar plata nu s-a confirmat încă. Nu poți avansa procesarea unei comenzi cu cardul neplătit.",
    },
    {
      q: "Ce înseamnă PROCESSING?",
      a: "Ai început să procesezi comanda (ai marcat-o „În pregătire” sau ai ajuns la „Confirmată, gata de predare”) - sau, pentru plata cu cardul, plata a fost confirmată chiar dacă tu nu ai apucat încă să pornești pregătirea.",
    },
    {
      q: "Ce înseamnă SHIPPED?",
      a: "Coletul a fost predat curierului - fie are deja AWB emis, fie e în tranzit spre client.",
    },
    {
      q: "Ce înseamnă DELIVERED?",
      a: "Comanda a fost livrată cu succes - toate coletele ei au fost confirmate ca livrate.",
    },
    {
      q: "Ce înseamnă CANCELED?",
      a: "Comanda a fost anulată - fie de tine (înainte de predarea către curier), fie de client (cât timp era încă nouă/în procesare), fie coletul a fost refuzat de client la livrare.",
    },
    {
      q: "Ce înseamnă RETURNED?",
      a: "Coletul a fost returnat expeditorului, DUPĂ ce ajunsese deja la curier. Acest status se setează strict de echipa Artfest, nu de tine - tu ești doar notificat.",
    },
    {
      q: "Cum văd detaliile unei comenzi?",
      a: "Din lista de comenzi, deschide comanda respectivă - acolo vezi toate detaliile (produse, cantități, adresă, personalizări/poze trimise de client, metodă de plată, status).",
    },
    {
      q: "Cum văd metoda de plată a unei comenzi?",
      a: "E afișată direct pe comandă, în lista de comenzi - card sau ramburs (COD), fără să fie nevoie să deschizi un ecran separat.",
    },
    {
      q: "Cum văd dacă s-a plătit o comandă?",
      a: "Statusul plății e afișat direct pe comandă. Pentru plata cu cardul vezi dacă e „plătită” sau „în așteptare”; comenzile ramburs nu au o plată online de urmărit (se încasează la livrare), cu excepția unui eventual avans cerut de tine.",
    },
    {
      q: "Cum cer avans pentru o comandă?",
      a: "Doar pe comenzi cu plată ramburs (COD), înainte de a începe procesarea - din pagina comenzii soliciți avansul. Clientul primește un email cu link de plată și are 24 de ore să achite; suma se scade apoi din ramburs. Nu poți începe pregătirea comenzii până când avansul cerut nu e plătit.",
    },
    {
      q: "Ce înseamnă avansul de 10%?",
      a: "De fapt avansul este fix 15%, nu 10% - procentul nu e configurabil per comandă. Reprezintă 15% din valoarea produselor (fără transport) și se aplică doar pe comenzi ramburs, la cererea ta.",
    },
    {
      q: "Pot cere plata integrală în avans?",
      a: "Nu - avansul e fix la 15% din valoarea produselor, nu poți cere un procent mai mare sau plata integrală înainte de livrare pe o comandă ramburs.",
    },
    {
      q: "Pot avea comandă cu plată ramburs?",
      a: "Da - ramburs (COD) e o metodă de plată disponibilă pe platformă, alături de plata cu cardul. Clientul plătește la livrare, curierului.",
    },
    {
      q: "Ce fac cu o comandă ramburs?",
      a: "O procesezi la fel ca orice altă comandă (pregătire → confirmată → predare curier → livrată). Singura diferență e că poți opțional cere un avans de 15% înainte să începi pregătirea, ca să reduci riscul unui refuz la livrare.",
    },
    {
      q: "Cum văd comenzile plasate ca guest (fără cont) - din perspectiva vânzătorului?",
      a: "Ca vânzător, nu există o secțiune separată pentru comenzile guest - o comandă plasată fără cont e marcată ca atare direct pe comandă (isGuestOrder) și apare în aceeași listă de comenzi primite ca oricare alta, alături de comenzile clienților cu cont.",
    },
    {
      q: "Pot vedea toate comenzile mele plasate ca guest, într-o listă?",
      a: "CORECTAT (audit Guest, 2026-09-08): Nu - un vizitator fără cont NU are o pagină „comenzile mele”. Fiecare comandă guest se accesează SEPARAT, prin linkul/tokenul primit pe email la plasarea acelei comenzi anume - nu există niciun mecanism care să le adune pe toate într-un singur loc. Dacă vrei să vezi toate comenzile tale într-o singură listă, trebuie să îți faci cont (ideal cu același email folosit la comenzile guest).",
    },
    {
      q: "Ce fac dacă pierd linkul unei comenzi guest?",
      a: "Nu există un mod self-service de a-l recupera (nu poți cere să ți se retrimită prin platformă) - contactează suportul Artfest, cu emailul folosit la comandă și, dacă îl ai, numărul comenzii.",
    },
    {
      q: "Pot anula o comandă plasată ca guest (fără cont)?",
      a: "Nu există o acțiune self-service de anulare pentru o comandă guest (pagina de comandă guest permite doar vizualizare și, dacă e cazul, plată/avans - nu anulare). Contactează suportul Artfest cu numărul comenzii; ei pot anula manual comanda, dacă starea ei mai permite asta.",
    },
    {
      q: "Pot modifica adresa unei comenzi plasate ca guest?",
      a: "Nu există o acțiune self-service pentru asta - pagina de comandă guest e doar de vizualizare/plată. Contactează suportul Artfest cu numărul comenzii; nu îți pot garanta că adresa mai poate fi schimbată în orice etapă a comenzii.",
    },
    {
      q: "Pot schimba telefonul unei comenzi plasate ca guest?",
      a: "Nu există o acțiune self-service pentru asta - contactează suportul Artfest cu numărul comenzii, la fel ca pentru schimbarea adresei.",
    },
    {
      q: "Pot modifica personalizarea unei comenzi deja plasate, ca guest?",
      a: "Nu există o acțiune self-service pentru a modifica personalizarea (text, poză, opțiuni) a unei comenzi DUPĂ ce a fost plasată - asta e diferit de completarea personalizării ÎNAINTE de a cumpăra, care se face normal pe pagina produsului. Contactează suportul Artfest cu numărul comenzii, cât mai rapid posibil - vânzătorul poate fi deja în curs de pregătire.",
    },
    {
      q: "Pot modifica telefonul după comandă?",
      a: "Nu există o acțiune self-service pentru a schimba telefonul unei comenzi deja plasate (indiferent dacă ai cont sau ai comandat ca guest) - contactează suportul Artfest cu numărul comenzii.",
    },
    {
      q: "Pot modifica personalizarea după comandă?",
      a: "Nu - odată plasată comanda, nu există o acțiune self-service de a schimba personalizarea (text, poză, opțiuni) ei. Diferit de a completa personalizarea ÎNAINTE de a cumpăra (asta se face normal pe pagina produsului). Contactează suportul Artfest cu numărul comenzii, cât mai rapid - vânzătorul poate fi deja în curs de pregătire.",
    },
    {
      q: "Pot să îmi creez cont după ce am comandat ca guest?",
      a: "Da, oricând - crearea contului nu are nicio legătură cu comenzile plasate anterior ca guest.",
    },
    {
      q: "Se leagă comanda plasată ca guest de contul meu, după ce îmi fac cont?",
      a: "VERIFICAT direct în cod (audit Guest, 2026-09-08): NU - nu există niciun mecanism automat care să lege o comandă guest existentă (userId=null) de un cont nou creat, nici după autentificare, nici după înregistrare cu același email. Comanda guest rămâne accesibilă STRICT prin linkul/tokenul ei, indiferent dacă îți faci cont ulterior sau nu. (Diferit de tichetele de suport, care SE leagă automat de un cont cu același email - nu confunda cele două.)",
    },
  ],

  unavailableFeatures: [
    "Ștergerea unei comenzi (există doar anulare, care păstrează comanda în istoric).",
    "Marcarea de către vendor a unui colet ca refuzat/returnat DUPĂ ce a fost predat curierului (asta e strict acțiune de admin).",
    "Un procent de avans configurabil - e fix 15%, la fel pentru toți vânzătorii și toate comenzile ramburs.",
  ],

  notes:
    "Sursă: userOrdersRoutes.js, vendorOrdersRoutes.js (PATCH /orders/:id/status - mapping UI→enum verificat direct în cod, plus blocajul de plată card neconfirmată), adminOrdersRoutes.js, guestOrderRoutes.js, STATUS_OPTIONS din frontend/src/pages/Vendor/Orders/Orders.jsx. Deposit/COD confirmate ca active, embedded în flow, nu module separate. Adăugat ghid operațional 2026-08-25, verificat din cod, nu inventat. Anulare de către client: POST /api/user/orders/:id/cancel (userOrdersRoutes.js, cancelOwnOrder) - condiție reală verificată în cod: uiStatus în PENDING/PROCESSING ȘI isOrderCancellable() (niciun shipment trecut de PENDING) - corectează o afirmație greșită găsită anterior (că doar vendorul poate anula), care nu era susținută de niciun manifest. Verificat 2026-08-26.\n\nBATCH 4 (audit regression Vendor Assistant, 2026-09-06) - CINCI concepte de status separate explicit (A-E, vezi flow dedicat): (A) Order.status intern - PENDING/PAID/FULFILLED/CANCELLED; (B) Shipment.status - granularitatea reală pe care vendorul o vede/schimbă (PENDING/PREPARING/READY_FOR_PICKUP/PICKUP_SCHEDULED/AWB/IN_TRANSIT/DELIVERED/REFUSED/RETURNED); (C) status afișat clientului - computeUiStatus (userOrdersRoutes.js:23-201): PENDING/PROCESSING/SHIPPED/DELIVERED/CANCELED/RETURNED; (D) status plată - computeOrderPaymentState (userOrdersRoutes.js:282-343) / computeVendorOrderPaymentState (vendorOrdersRoutes.js, folosit la PATCH /orders/:id/status ~L3708); (E) status avans - Shipment.depositStatus (NOT_REQUESTED/PENDING/PAID), complet independent de A-D. STALE_KNOWLEDGE CORECTAT: avansul e FIX 15%, confirmat direct la sursă (`const depositPercent = 15;`, vendorOrdersRoutes.js:3134-3135, cu expirare 24h la linia 3164-3171) - nu 10% și nu configurabil; dacă userul afirmă un alt procent, răspunsul trebuie să corecteze explicit premisa, nu doar să confirme. STALE_KNOWLEDGE CORECTAT: \"vânzătorul marchează coletul refuzat/returnat\" era greșit pentru refuzul POST-expediere - confirmat în cod că `PATCH /api/admin/pickups/:shipmentId/refused` și `.../returned` (adminPickupsRoutes.js:591-646, 651-690) au `requireAdmin`, NU sunt accesibile vendorului; vendorul e doar notificat live (sseBroadcastToVendor, linia 632) și reversarea financiară (ensureRefundLedgerEntry/ensureInfluencerRefundLedgerEntry) e automată. Rămâne corect că vendorul poate anula PRE-expediere (PATCH /api/vendor/orders/:id/status, nextUi=\"cancelled\" -> shipment.status=\"REFUSED\", vendorOrdersRoutes.js:3807-3832, permis doar din PENDING/PREPARING/READY_FOR_PICKUP, cu restaurare automată de stoc - restoreShipmentStockAfterStatusChange). Ștergere comandă: confirmat prin listarea completă a rutelor din vendorOrdersRoutes.js (grep router.get/post/patch/delete) că NU EXISTĂ niciun endpoint DELETE pe comenzi/shipment-uri, pentru niciun rol - singura acțiune posibilă e anularea (schimbare de status, comanda rămâne în istoric). Comenzi guest: `order.isGuestOrder` (vendorOrdersRoutes.js ~L898, ~L1565) expus direct în serializarea comenzii către vendor, fără secțiune separată. Motive de anulare reale (UI vendor): client_no_answer/client_request/stock_issue/address_issue/payment_issue/other (frontend/src/pages/Vendor/Orders/Orders.jsx:124-131, CANCEL_REASONS). Personalizare/poză trimisă de client: NU e documentată aici - rămâne acoperită de manifestul `products` (deja verificat corect în audit, cazul id71 PASS) - lista completă de items cu personalizări e disponibilă doar în Order Details, exclusă intenționat din lean-select-ul listei (vendorOrdersRoutes.js ~L1438-1446). LIVE DATA: numărul de comenzi pe status conectat la Vendor Assistant printr-un serviciu subțire nou, backend/src/services/vendorAssistantOrders.js (reutilizează exact Shipment.status/Order.paymentMethod, fără duplicare de logică de business), apelat din copilotRouter.js STRICT pentru audience VENDOR, înlănțuit după verificările de Statistici (Batch 2) și Cereri ofertă (Batch 3) - câștiguri/stoc de produs rămân neatinse, alte batch-uri. E2E prin chat real NEVERIFICAT încă (cotă OpenAI epuizată la data auditului) - verificat doar static (node --check) și direct pe date reale din DB (fără LLM).",
};
