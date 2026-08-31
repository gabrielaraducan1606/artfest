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
    "cum functioneaza avansul",
    "pot cere avans",
    "cat este avansul",
    "cum primesc avansul",
    "clientul poate plati doar avans",
    "pot adauga produse in cos fara cont",
    "pot cumpara fara sa ma inregistrez",
    "trebuie cont ca sa adaug in cos",
    "cosul de cumparaturi fara autentificare",
    "pot cumpara de la mai multi vanzatori intr-o singura comanda",
    "o comanda cu produse de la mai multi vanzatori",
    "cos cu produse din magazine diferite",
    "fiecare vanzator imi trimite coletul separat",
  ],

  uiLocations: [
    { audience: "USER", path: "/cos" },
    { audience: "USER", path: "/checkout" },
    { audience: "USER", path: "/multumim" },
  ],

  capabilities: {
    cardPayment: { available: true },
    netopiaCheckout: { available: true },
    stripeConnectPayout: { available: true, audience: ["VENDOR"] },

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
      q: "Pot adăuga produse în coș fără cont?",
      a: "Da. Coșul unui vizitator neautentificat se ține local, în browser - poți adăuga produse, schimba cantitatea sau elimina un produs fără niciun cont. Ai nevoie de cont abia când plasezi efectiv comanda, la checkout.",
    },
    {
      q: "Pot cumpăra de la mai mulți vânzători într-o singură comandă?",
      a: "Da. Dacă ai în coș produse de la vânzători diferiți, la finalizare se creează o singură comandă, dar fiecare vânzător primește propria expediere - își pregătește și expediază doar produsele lui, separat de ceilalți.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: chekoutRoutes.js, checkoutNetopiaRoutes.js, cartRoutes.js, stripeWebhookRoutes.js, vendors.stripeConnect.js, billingRoutes.js. Comisionul e din SubscriptionPlan.commissionBps, fără endpoint dedicat separat. Avans: vendorOrdersRoutes.js (request-deposit - condiții exacte verificate direct în cod: doar COD, doar status PENDING, Stripe Connect activ, 15% fix, expiră în 24h) + userOrdersRoutes.js (pay-deposit, serializeShipmentDeposit). Adăugat/corectat 2026-08-25. Extins 2026-08-28 (audit GUEST): guestCart.js (100% localStorage - getGuestCart/saveGuestCart/addToGuestCart, fără niciun apel de rețea, deci fără cont) pentru guestCart; chekoutRoutes.js (creare comandă - un singur tx.order.create, apoi `for (const s of quote.shipments) { tx.shipment.create({ vendorId: s.vendorId, ... }) }`, câte un Shipment per vânzător din quote) pentru multiVendorCartAndCheckout.",
};
