// backend/src/ai/manifests/checkoutPayments.manifest.js

export const CHECKOUT_PAYMENTS_MANIFEST = {
  id: "checkout-payments",

  title: "Checkout și plăți",

  audience: ["USER", "VENDOR", "GUEST", "ADMIN"],

  available: true,
  status: "ACTIVE",

  description:
    "Coșul de cumpărături, procesul de checkout, plata online (card, Netopia), încasările vânzătorilor (Stripe Connect, planuri de comision) și avansul opțional pe comenzile ramburs.",

  tags: [
    "checkout",
    "cos",
    "plata",
    "card",
    "stripe",
    "netopia",
    "comision",
    "avans",
    "avans comanda",
    "plata partiala",
    "ramburs",
    "cos fara cont",
    "cumpar fara cont",
    "mai multi vanzatori intr-o comanda",
  ],

  aliases: [
    "nu imi merge plata",
    "cum platesc",
    "de ce nu apare comisionul",
    "cum imi conectez contul stripe",
    "cum conectez stripe",
    "cum activez stripe",
    "unde conectez stripe",
    "cum functioneaza avansul",
    "pot cere avans",
    "cat este avansul",
    "cum primesc avansul",
    "clientul poate plati doar avans",
    "pot adauga produse in cos fara cont",
    "pot cumpara fara sa ma inregistrez",
    "artfest salveaza numarul cardului",
    "unde vad istoricul platilor",
    "pot schimba metoda de plata dupa comanda",
    "pot plati cu alt card",
    "pot plati din alt cont bancar",
    "trebuie cont ca sa adaug in cos",
    "cosul de cumparaturi fara autentificare",
    "pot cumpara de la mai multi vanzatori intr-o singura comanda",
    "o comanda cu produse de la mai multi vanzatori",
    "cos cu produse din magazine diferite",
    "fiecare vanzator imi trimite coletul separat",

    /*
     * Retrieval instabil pentru întrebări despre comision (audit
     * 2026-09-04) - "Cum plătesc comisionul?"/variante ajungeau la
     * manifeste nerelevante (orders, auth-account, platform-overview,
     * confidence 0). Alias-uri explicite pentru formulările testate.
     */
    "cum platesc comisionul",
    "cum achit comisionul",
    "cand se plateste comisionul",
    "comision automat",
    "retinere comision",
    "unde vad comisionul",
    "cat comision datorez",
    "ce procent ia artfest",
    "procent comision artfest",
    "transfer stripe comision",

    /*
     * Corecție 2026-09-04 - factura de comision (nu deducere automată).
     */
    "cand se emite factura de comision",
    "unde vad factura de comision",
    "trebuie sa platesc manual comisionul",
    "comisionul se retine automat",

    /*
     * Gap 2026-09-04 - "O să primesc factură?" (și variante) nu găsea
     * răspuns. Alias-uri explicite pt. formulările testate.
     */
    "o sa primesc factura",
    "primesc factura pentru comision",
    "cand primesc factura",
    "cand se emite factura",
    "factura comision",
    "factura artfest",
    "factura lunara",
    "unde vad factura",
    "trebuie sa primesc factura",
    "imi vine factura pe email",
    "factura pe 1 ale lunii",
    "factura pentru luna anterioara",

    /*
     * BATCH 5 (audit regression, 2026-09-06) - Stripe Connect, taxa
     * Stripe, cum ajung banii, ramburs vs card.
     */
    "ce inseamna stripe connect",
    "trebuie sa am stripe",
    "trebuie sa am stripe connect",
    "ce se intampla daca nu am stripe connect",
    "cine plateste taxa stripe",
    "cum ajung banii la mine",
    "cand primesc banii",
    "de ce nu am primit banii",
    "pot primi bani ramburs",
    "pot primi bani direct in cont",
    "unde vad incasarile",
    "unde vad castigurile",
    "cat am castigat luna asta",
    "cat am castigat luna trecuta",
    "ce comenzi mi-au adus castig",
    "care este suma mea de incasat",
    "ce comision am platit luna trecuta",
    "ce facturi sunt neachitate",
    "ce se intampla daca nu platesc factura",
    "cand se calculeaza comisionul",
  ],

  uiLocations: [
    { audience: "USER", path: "/cos" },
    { audience: "USER", path: "/checkout" },
    { audience: "USER", path: "/multumim" },
    { audience: "VENDOR", path: "/vendor/invoices" },
    { audience: "VENDOR", path: "/setari?tab=payouts" },
  ],

  capabilities: {
    cardPayment: { available: true },
    netopiaCheckout: { available: true },
    stripeConnectPayout: {
      available: true,
      audience: ["VENDOR"],

      notes:
        "Payout-ul (banii primiți din vânzări) și factura de comision (ce datorează vendorul către Artfest) sunt DOUĂ fluxuri separate - comisionul NU se scade din payout, se facturează distinct (vezi FAQ 'Cum plătesc comisionul?').",
    },

    guestCart: {
      available: true,
      audience: ["GUEST"],

      notes:
        "Coșul unui vizitator neautentificat e păstrat local, în browser (localStorage), fără niciun cont - poate adăuga produse, schimba cantități și le poate elimina la fel ca un cumpărător autentificat. Contul e cerut abia la checkout (plasarea comenzii propriu-zise).",
    },

    multiVendorCartAndCheckout: {
      available: true,

      notes:
        "Coșul poate conține produse de la mai mulți vânzători simultan. La checkout se creează O SINGURĂ comandă (Order), dar cu câte o expediere (Shipment) separată per vânzător - fiecare vânzător își pregătește și expediază doar produsele lui, independent de ceilalți.",
    },

    orderDeposit: {
      available: true,
      audience: ["VENDOR"],

      notes:
        "Opțional, la cererea vendorului, DOAR pentru comenzi ramburs (COD), înainte ca vendorul să înceapă procesarea comenzii.",
    },
  },

  limitations: [
    "Avansul poate fi solicitat DOAR pentru comenzi cu plată ramburs (COD) - nu există pentru comenzi plătite integral online cu cardul.",
    "Avansul poate fi solicitat DOAR cât timp comanda e încă în starea inițială (nouă/PENDING) - nu mai poate fi cerut după ce vendorul a început procesarea.",
    "Vendorul trebuie să aibă Stripe Connect complet activat (plăți și încasări active, date completate) înainte de a putea solicita avans.",
    "Procentul de avans este fix (15% din valoarea produselor, fără transport) - nu este configurabil per comandă.",
  ],

  flows: [
    {
      name: "checkout",
      steps: ["coș", "date livrare", "plată", "confirmare comandă"],
    },

    {
      name: "Avans pe comandă ramburs (din perspectiva vendorului)",
      steps: [
        "Vendorul solicită avans pe o comandă ramburs (COD), înainte de a începe procesarea ei.",
        "Sistemul calculează automat avansul: 15% din valoarea produselor (fără transport).",
        "Clientul primește un email cu un link de plată (Stripe) și are 24 de ore să plătească avansul.",
        "Dacă plătește, avansul e scăzut din suma de ramburs rămasă de încasat la livrare.",
        "Dacă nu plătește în 24 de ore, solicitarea expiră și poate fi cerută din nou.",
      ],
    },
  ],

  integrations: {
    netopia: { available: true, status: "ACTIVE" },
    stripe: { available: true, status: "ACTIVE" },
  },

  endpoints: {
    checkout: {
      method: "POST",
      path: "/api/checkout",
      purpose: "Inițiază procesul de checkout.",
      audience: ["USER", "GUEST"],
    },

    requestDeposit: {
      method: "POST",
      path: "/api/vendor/orders/:id/request-deposit",
      purpose: "Vendorul solicită avans (15%) pe o comandă ramburs, înainte de procesare.",
      audience: ["VENDOR"],
    },

    payDeposit: {
      method: "POST",
      path: "/api/user/orders/:orderId/shipments/:shipmentId/pay-deposit",
      purpose: "Clientul plătește avansul solicitat (Stripe).",
      audience: ["USER"],
    },

    vendorInvoicesList: {
      method: "GET",
      path: "/api/vendors/me/invoices",
      purpose: "Vendorul își vede facturile (inclusiv cele de comision).",
      audience: ["VENDOR"],
    },

    payVendorInvoice: {
      method: "GET",
      path: "/api/vendors/me/invoices/:id/pay",
      purpose: "Pornește o sesiune Stripe Checkout pentru plata unei facturi (inclusiv comision) neachitate.",
      audience: ["VENDOR"],
    },

    stripeFinance: {
      method: "GET",
      path: "/api/vendor/stripe/finance",
      purpose: "Soldul Stripe Connect (disponibil/în așteptare) și istoricul transferurilor (payout) către contul bancar.",
      audience: ["VENDOR"],
    },
  },

  faq: [
    {
      q: "Cum funcționează avansul?",
      a: "Avansul e opțional, la cererea ta, doar pe comenzi ramburs (COD), înainte să începi procesarea comenzii. Reprezintă 15% din valoarea produselor (fără transport). Clientul primește un email cu link de plată (Stripe) și are 24 de ore să plătească - dacă plătește, suma se scade din ramburs; dacă nu, solicitarea expiră.",
    },

    {
      q: "Pot cere avans?",
      a: "Da, dar doar pentru comenzi ramburs (COD), doar cât timp comanda e încă nouă (înainte să începi procesarea), și doar dacă ai Stripe Connect complet activat (plăți și încasări active).",
    },

    {
      q: "Clientul poate plăti doar avans?",
      a: "Nu - avansul e o plată PARȚIALĂ, doar pentru a reduce riscul de refuz la livrare. Restul rămâne de încasat ramburs, la livrare.",
    },

    {
      q: "Cât este avansul?",
      a: "15% din valoarea produselor din comandă, fără a include transportul - procent fix, nu poți alege alt procent.",
    },

    {
      q: "Cum primește clientul solicitarea de avans?",
      a: "Primește un email cu un link de plată (Stripe), valabil 24 de ore. Poate vedea statusul avansului și direct în contul lui, la comanda respectivă.",
    },

    {
      q: "De ce nu apare comisionul corect?",
      a: "Comisionul depinde de planul de abonament activ al vânzătorului (procent din preț) - dacă pare greșit, verifică planul curent din Costuri & Profit sau contactează suportul dacă suspectezi o eroare.",
    },
    {
      q: "Cum plătesc comisionul?",
      a: "La fel, indiferent de metoda de plată a comenzii (card sau ramburs): comisionul NU se scade automat din nicio plată - se adună într-un jurnal intern și Artfest emite periodic (manual, din admin, de obicei pentru luna calendaristică anterioară) o factură cu comisionul datorat pe toate tranzacțiile tale nefacturate, cu termen de plată 7 zile de la emitere. Factura o vezi în contul tău de vânzător, la Facturi (/vendor/invoices) - o poți plăti direct din platformă, cu cardul (Stripe), sau descărca în format PDF.",
    },
    {
      q: "Comisionul se reține automat?",
      a: "Nu, pentru nicio metodă de plată. Nici la comenzile cu cardul, nici la cele ramburs (COD) comisionul Artfest nu se scade automat din nimic - rămâne doar înregistrat, iar tu primești banii (din card: gross minus DOAR taxa Stripe; din ramburs: cash integral de la curier) fără nicio deducere de comision. Comisionul se facturează separat, periodic - vezi „Cum plătesc comisionul?”.",
    },
    {
      q: "Când se calculează comisionul?",
      a: "În momentul în care comanda e finalizată/plătită - pe baza valorii nete a produselor (fără transport, fără TVA), la procentul tău curent (12% standard sau 5% dacă vine dintr-o campanie proprie validată). Transportul nu intră niciodată în baza de calcul a comisionului. Calculat imediat, dar facturat abia periodic (vezi mai sus) - nu e scăzut din nicio plată în acel moment.",
    },
    {
      q: "O să primesc factură pentru comision?",
      a: "Da, pentru tot comisionul acumulat, indiferent de metoda de plată a comenzilor (card + ramburs, la fel). O primești pe email (cu PDF-ul atașat) și o găsești oricând în contul tău de vânzător, la Facturi (/vendor/invoices) - termen de plată 7 zile, plătibilă direct din platformă cu cardul (Stripe) sau descărcabilă separat ca PDF.",
    },
    {
      q: "Pentru ce perioadă e factura de comision?",
      a: "Implicit, pentru luna calendaristică anterioară (de exemplu, o factură emisă în octombrie acoperă tranzacțiile din septembrie). Emiterea e manuală, făcută de echipa Artfest din panoul de admin - nu există încă o dată fixă automată de emitere.",
    },
    {
      q: "Când se emite factura de comision?",
      a: "Manual, din panoul de admin Artfest - nu există un program automat fix (de exemplu \"pe data de 1\"). Implicit, când se emite, acoperă luna calendaristică anterioară momentului emiterii.",
    },
    {
      q: "Ce se întâmplă dacă nu plătesc factura de comision?",
      a: "Nu există în platformă un mecanism automat de penalizare sau suspendare pentru facturi neplătite la termen - factura rămâne pur și simplu neachitată în contul tău, vizibilă la Facturi, până o plătești.",
    },
    {
      q: "Cine plătește taxa Stripe?",
      a: "Tu, ca vânzător - taxa Stripe se scade din suma pe care o primești, proporțional cu valoarea ta din comandă (dacă sunt mai mulți vânzători în aceeași comandă). Se aplică doar la plățile cu cardul (integrale sau avans) - comenzile 100% ramburs nu implică nicio taxă Stripe, pentru că nu trece nicio sumă prin Stripe.",
    },
    {
      q: "Ce înseamnă Stripe Connect?",
      a: "Este contul prin care primești efectiv banii din vânzările plătite cu cardul - fără el, platforma nu are unde să-ți transfere banii, deci plata cu cardul nu este disponibilă pentru produsele tale (clienții pot alege doar ramburs). Nu este necesar pentru comenzi ramburs.",
    },
    {
      q: "Trebuie să am Stripe Connect?",
      a: "Doar dacă vrei să poți primi plăți cu cardul. Fără el poți vinde în continuare, dar exclusiv cu plata ramburs (COD) - clienții nu vor putea alege cardul pentru produsele tale.",
    },
    {
      q: "Ce se întâmplă dacă nu am Stripe Connect activ?",
      a: "Plata cu cardul e blocată pentru produsele tale - dacă un client are în coș produse de la tine și de la alt vânzător cu Stripe activ, întreaga comandă trece automat pe plată ramburs. Nu îți afectează vânzarea, doar metoda de plată disponibilă clientului.",
    },
    {
      q: "De ce nu apare plata cu cardul la checkout, doar ramburs?",
      a: "Metoda de plată depinde de vânzător(i), nu de tine, ca cumpărător - cardul e disponibil doar dacă vânzătorul are Stripe Connect complet activat. Dacă în coș ai produse de la mai mulți vânzători și cel puțin unul NU are Stripe activ, întreaga comandă trece automat pe plată ramburs (COD), nu doar partea acelui vânzător. Ramburs e disponibil implicit, indiferent de Stripe.",
    },
    {
      q: "Pot folosi un cod de reducere la checkout?",
      a: "Da - există un câmp real de introducere a unui cod de reducere la checkout (confirmat direct în cod: validare + aplicare a codului). E distinct de link-urile de campanie ale vânzătorilor (vezi manifestul vendor-campaigns) - un cod se introduce manual, un link de campanie se aplică automat la accesarea lui, fără cod.",
    },
    {
      q: "Există coduri de reducere pe Artfest?",
      a: "Da - de exemplu, codurile create de influenceri/ambasadori (până la 5%, suportate integral de Artfest, nu de vânzător), aplicabile fie pe toate produsele eligibile, fie doar pe o colecție. Un cod poate fi procentual sau o sumă fixă, eventual cu un plafon maxim.",
    },
    {
      q: "Care este reducerea maximă pe care o pot obține cu un cod?",
      a: "Depinde de codul folosit - nu există un procent unic garantat pentru toate codurile. Codurile de influencer/ambasador sunt limitate la maximum 5%; alte coduri pot avea reguli proprii (procent sau sumă fixă, eventual plafonată).",
    },
    {
      q: "Pot cumula mai multe coduri de reducere pe aceeași comandă?",
      a: "Nu am găsit, în cod, o confirmare a cumulării mai multor coduri pe aceeași comandă - tratează cu prudență presupunerea că poți folosi mai multe simultan.",
    },
    {
      q: "Artfest salvează numărul cardului meu?",
      a: "Nu - plata cu cardul e procesată de Stripe, procesatorul de plăți; Artfest nu stochează datele complete ale cardului tău. Confirmat prin arhitectura de plată (Stripe Connect), nu printr-o politică documentată separat.",
    },
    {
      q: "Unde văd istoricul plăților mele?",
      a: "Detaliile de plată ale fiecărei comenzi (metodă, status) se văd pe pagina comenzii respective, în „Comenzile mele” - nu am găsit, în cod, o pagină separată de „istoric plăți”, distinctă de lista de comenzi.",
    },
    {
      q: "Pot schimba metoda de plată după ce am plasat comanda?",
      a: "Nu am găsit, în cod, o acțiune self-service pentru asta - metoda de plată se alege la checkout, înainte de finalizare. Pentru o comandă deja plasată, contactează suportul Artfest cu numărul comenzii.",
    },
    {
      q: "Pot plăti cu alt card decât al meu?",
      a: "Nu am găsit, în cod, o restricție tehnică legată de proprietarul cardului folosit la plată - Stripe procesează orice card valid introdus la checkout.",
    },
    {
      q: "Pot plăti dintr-un alt cont bancar decât al meu?",
      a: "Nu am găsit, în cod, o verificare a proprietarului contului/cardului folosit la plată - decizia rămâne a ta, dar nu pot confirma o politică explicită pentru acest caz.",
    },
    {
      q: "Cum ajung banii la mine?",
      a: "Pentru comenzi cu cardul: automat, printr-un transfer către contul tău Stripe Connect, imediat ce plata clientului e confirmată (minus DOAR taxa Stripe - comisionul Artfest NU se scade din acest transfer, se facturează separat, periodic) - de acolo, Stripe îi trimite mai departe către contul tău bancar, conform programului de plată standard Stripe (vezi /vendor/stripe/finance pentru sold și istoricul transferurilor). Pentru comenzi ramburs: direct, cash sau card la curier, fără să treacă prin platformă.",
    },
    {
      q: "Când primesc banii?",
      a: "Pentru cardul: transferul către contul tău Stripe se face automat la confirmarea plății; de acolo, Stripe îi trimite spre banca ta conform programului lui de plată (poți vedea programul exact în /vendor/stripe/finance). Pentru ramburs: la livrare, direct de la curier/client.",
    },
    {
      q: "De ce nu am primit banii?",
      a: "Verifică întâi dacă ai Stripe Connect complet activat (/vendor/stripe/finance) - fără el, niciun transfer nu poate ajunge la tine pentru plățile cu cardul. Dacă ai Stripe activ, verifică soldul și istoricul de payout-uri din aceeași pagină; pentru ramburs, banii vin direct de la curier/client, nu prin platformă.",
    },
    {
      q: "Pot primi bani ramburs?",
      a: "Da - ramburs (COD) este disponibil implicit, indiferent dacă ai sau nu Stripe Connect conectat. Banii ajung direct de la client, prin curier.",
    },
    {
      q: "Pot primi bani direct în cont?",
      a: "Da, prin Stripe Connect - odată activat, banii din comenzile cu cardul ajung automat în contul tău Stripe, iar de acolo Stripe îi transferă mai departe către contul tău bancar, conform programului său standard de plată.",
    },
    {
      q: "Unde văd încasările?",
      a: "În /vendor/stripe/finance vezi soldul și istoricul transferurilor Stripe (pentru cardul); situația comisioanelor și facturile le vezi separat, la Facturi (/vendor/invoices).",
    },
    {
      q: "Unde văd câștigurile?",
      a: "Vendor Assistant îți poate spune direct cât ai câștigat (net, după comision) într-o perioadă, la cerere - de exemplu „Cât am câștigat luna asta?”. Detaliat, pe fiecare comandă, vezi în situația lunară de comision din Facturi (/vendor/invoices).",
    },
    {
      q: "Pot adăuga produse în coș fără cont?",
      a: "Da. Coșul unui vizitator neautentificat se ține local, în browser - poți adăuga produse, schimba cantitatea sau elimina un produs fără niciun cont. Ai nevoie de cont abia când plasezi efectiv comanda, la checkout.",
    },
    {
      q: "Pot cumpăra de la mai mulți vânzători într-o singură comandă?",
      a: "Da. Dacă ai în coș produse de la vânzători diferiți, la finalizare se creează o singură comandă, dar fiecare vânzător primește propria expediere - își pregătește și expediază doar produsele lui, separat de ceilalți.",
    },
    {
      q: "Cum conectez Stripe?",
      a: "Din Setări → Încasări (/setari?tab=payouts) - urmează pașii de acolo pentru a-ți conecta contul Stripe și a începe să primești banii din vânzări direct în cont.",
    },
    {
      q: "Unde sunt setările Stripe?",
      a: "Setări → Încasări (/setari?tab=payouts) - acolo conectezi Stripe Connect și vezi soldul/istoricul transferurilor către contul tău bancar.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: chekoutRoutes.js, checkoutNetopiaRoutes.js, cartRoutes.js, stripeWebhookRoutes.js, vendors.stripeConnect.js, billingRoutes.js. Comisionul e din SubscriptionPlan.commissionBps, fără endpoint dedicat separat. Avans: vendorOrdersRoutes.js (request-deposit - condiții exacte verificate direct în cod: doar COD, doar status PENDING, Stripe Connect activ, 15% fix, expiră în 24h) + userOrdersRoutes.js (pay-deposit, serializeShipmentDeposit). Adăugat/corectat 2026-08-25. Extins 2026-08-28 (audit GUEST): guestCart.js (100% localStorage - getGuestCart/saveGuestCart/addToGuestCart, fără niciun apel de rețea, deci fără cont) pentru guestCart; chekoutRoutes.js (creare comandă - un singur tx.order.create, apoi `for (const s of quote.shipments) { tx.shipment.create({ vendorId: s.vendorId, ... }) }`, câte un Shipment per vânzător din quote) pentru multiVendorCartAndCheckout. CORECȚIE 2026-09-04 (audit): nota anterioară de-aici afirma greșit că \"vendorPayoutNet = gross - commissionNet - stripeFeeAllocated\" (marketplaceCalc.js) înseamnă reținere automată a comisionului din transferul Stripe - acel calcul EXISTĂ în cod, dar comisionul e de fapt FACTURAT separat, nu dedus din acel transfer. Sursa reală de adevăr: model Invoice (Prisma, type COMMISSION, direction PLATFORM_TO_VENDOR), generat prin POST /api/admin/billing/create-vendor-commission-invoice (adminInvoicesRoutes.js - admin-triggered, NU am găsit niciun cron/scheduler automat în server.js care să ruleze asta pe 1 ale lunii; doar 2 job-uri programate există, ambele nelegate de facturare) din VendorEarningEntry-urile neinvoiced (payoutId:null), prin SmartBill; dueDate = issueDate + 7 zile (fix, verificat direct în cod). Vendorul vede/plătește factura prin vendorInvoices.js: GET /api/vendors/me/invoices (listă, cu paymentUrl doar dacă status UNPAID/OVERDUE), GET /api/vendors/me/invoices/:id/pay (Stripe Checkout Session, plată activă cu cardul, cu opțiune de autopay pe cont propriu), GET /api/vendors/me/invoices/:id/pdf (descărcare PDF). Pagina frontend: /vendor/invoices (InvoicePage.jsx, target existent VENDOR_INVOICES în assistantActionRegistry.js). Adăugat 2026-09-04: la creare, vendorul primește și un email automat (sendVendorCommissionInvoiceEmail, lib/mailer.js, cu PDF-ul facturii atașat - verificat direct în adminInvoicesRoutes.js) - n-am găsit nicio notificare in-app separată pentru asta în aceeași rută, doar emailul. FIX 2026-09-04 (audit Setări Vendor): adăugat FAQ „Cum conectez Stripe?” - trimite direct la /setari?tab=payouts (ConnectPayoutsTab.jsx), fără detalii tehnice suplimentare, conform cerinței. BATCH 5 (audit regression Vendor Assistant, 2026-09-06) - NUANȚĂ IMPORTANTĂ, corectează parțial nota CORECȚIE 2026-09-04 de mai sus (care afirma, prea generalizat, că \"comisionul e facturat separat, nu dedus din transfer\"): verificat cu citare exactă, comisionul CHIAR se deduce automat, dar STRICT pentru comenzile plătite integral cu cardul - stripeWebhookRoutes.js, handleOrderPaymentIntentSucceeded (linia ~1049), face `stripe.transfers.create({ amount: payout.vendorPayoutNet * 100, destination: vendor.stripeAccountId, ... })` (linia ~1420), unde vendorPayoutNet = gross - commissionNet - stripeFeeAllocated (marketplaceCalc.js, computeVendorPayouts, ~L1093-1157) - deci comisionul ȘI taxa Stripe sunt deja scăzute din suma primită de vendor pentru ACEA comandă. Pentru comenzi ramburs (COD) și pentru avansul plătit cu cardul pe o comandă ramburs (createDepositPaymentForShipment/handleDepositPaymentIntentSucceeded), transferul e doar `paidAmount - stripeFeeNet` (linia ~608-617) - comisionul NU e dedus acolo, rămâne de facturat separat. RISC DE VERIFICAT DE ECHIPĂ (nu business logic, doar observație de audit, NU am modificat nimic): la crearea VendorEarningEntry pentru transferul de comandă cu cardul (stripeWebhookRoutes.js ~L1492-1534), `payoutId` rămâne null (nesetat) - exact același câmp pe care create-vendor-commission-invoice (adminInvoicesRoutes.js) îl folosește ca filtru \"payoutId: null\" pentru a decide ce intrări sunt \"nefacturate\" și le include în următoarea factură de comision. N-am găsit (grep pe stripeTransferId în tot backend/src) niciun filtru care să EXCLUDĂ din factura lunară intrările deja \"decontate\" prin transfer direct - deci comisionul unei comenzi plătite integral cu cardul ar putea fi scăzut din transfer ȘI facturat din nou lunar, dublu. Nu am verificat exhaustiv (posibil există o reconciliere în altă parte, ex. la nivelul sumei nete facturate, pe care nu am găsit-o) - semnalat explicit ca ipoteză de verificat, NU ca fapt confirmat 100%, conform cerinței de a nu afirma cu certitudine ce n-am verificat complet. Serviciul nou vendorAssistantPayments.js (LIVE DATA - cât am câștigat/comision datorat/facturi neachitate) folosește strict commissionNet din intrările payoutId:null, deci moștenește aceeași ambiguitate dacă ea există real - numerele arătate sunt corecte FAȚĂ DE definiția actuală din cod, indiferent de acest risc.\n\nBATCH A (2026-09-07) - MODEL B IMPLEMENTAT, notele de mai sus despre reținerea automată la CARD sunt acum ISTORIC, nu mai reflectă codul curent. Riscul de dublă facturare semnalat în nota BATCH 5 a fost confirmat (nu doar ipoteză) și REPARAT prin schimbare de business: `computeVendorPayouts` (marketplaceCalc.js) NU mai scade `commissionNet` din `vendorPayoutNet` - formula actuală e `vendorPayoutNet = gross - stripeFeeAllocated` (doar taxa Stripe). Comisionul rămâne calculat și salvat pe `VendorEarningEntry.commissionNet` (neschimbat), dar acum se facturează IDENTIC pentru CARD și COD, periodic, manual din admin - vezi și FAZA 2 (2026-09-07): `POST /billing/create-vendor-commission-invoice` acceptă acum `periodFrom`/`periodTo` explicit, cu default determinist = luna calendaristică anterioară în Europe/Bucharest (`getPreviousBucharestMonthBoundaries`, `vendorCommissionInvoiceService.js`) - NU mai derivă perioada din min/max al entry-urilor nefacturate. Idempotency: constrângerea unică `vendor_monthly_invoice_unique` (schema.prisma, deja existentă) devine efectivă cu perioada fixă - a doua încercare pentru aceeași lună/vendor întoarce 409 `already_invoiced_for_period`, fără duplicat. Emiterea rămâne STRICT manuală - nu există (și nu s-a adăugat) niciun scheduler/cron automat.",
};
