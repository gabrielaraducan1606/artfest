// backend/src/ai/manifests/invoices.manifest.js

export const INVOICES_MANIFEST = {
  id: "invoices",

  title: "Facturi",

  audience: ["USER", "VENDOR", "ADMIN"],

  /*
   * ADĂUGAT (audit Guest, 2026-09-08) - GUEST extins DOAR la
   * knowledgeAudience (poate CITI despre concept), nu la audience
   * (nu poate EXECUTA - GET /api/users/me/invoices e strict USER,
   * deci un guest nu poate vedea propriile facturi fără cont).
   * Motiv: întrebarea "Cine emite factura pentru produs?" e una
   * legitimă și pentru un vizitator neautentificat, înainte de
   * cumpărare - era complet invizibilă pentru el în retrieval.
   */
  knowledgeAudience: ["USER", "VENDOR", "ADMIN", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Facturile emise pentru comenzi (cumpărător) și facturile vendorului pentru comisioane/abonament.",

  tags: ["factura", "facturi", "facturile mele", "factura comision"],

  aliases: [
    "unde gasesc factura",
    "cum descarc factura",
    "cum vad facturile mele",
    "vreau sa vad facturile",
    "unde vad facturile",
    "unde vad factura de comision",
    "cum schimb datele de facturare",
    "unde completez cui-ul",
    "cum schimb adresa de facturare",
  ],

  uiLocations: [
    { audience: "USER", path: "/facturi" },
    { audience: "VENDOR", path: "/vendor/invoices" },
  ],

  capabilities: {
    viewInvoices: { available: true },
    downloadInvoices: { available: true },

    vendorCommissionInvoices: {
      available: true,
      audience: ["VENDOR"],
      notes:
        "Facturile de comision ale vendorului (mecanism, procent, termen de plată, plata online) sunt documentate în detaliu în manifestul checkout-payments, ca să nu se dubleze textul aici - acest manifest e doar punctul de intrare „unde le găsesc”.",
    },
  },

  limitations: [],
  flows: [],
  integrations: {},

  endpoints: {
    myInvoices: {
      method: "GET",
      path: "/api/users/me/invoices",
      purpose: "Returnează facturile utilizatorului.",
      audience: ["USER"],
    },

    vendorInvoices: {
      method: "GET",
      path: "/api/vendors/me/invoices",
      purpose: "Returnează facturile vendorului (inclusiv comision) - vezi checkout-payments pentru mecanismul complet.",
      audience: ["VENDOR"],
    },
  },

  faq: [
    {
      q: "Unde găsesc factura?",
      a: "Facturile tale sunt disponibile în secțiunea „Facturi” din contul tău (cumpărător) sau din panoul de vânzător (/vendor/invoices).",
    },
    {
      q: "Unde văd facturile?",
      a: "Ca cumpărător: /facturi, în contul tău. Ca vânzător: /vendor/invoices - acolo vezi și facturile de comision (mecanismul lor complet e explicat separat, întreabă „Cum plătesc comisionul?”).",
    },
    {
      q: "Cum schimb datele de facturare?",
      a: "Din Setări → Date de facturare, în contul tău de vânzător - acolo completezi/modifici CUI-ul, adresa, tipul de vânzător (persoană fizică/firmă) și restul datelor folosite pe facturi.",
    },
    {
      q: "Cine emite factura pentru un produs cumpărat?",
      a: "Vânzătorul, nu Artfest - Artfest este marketplace-ul, nu vânzătorul produsului (modelul de facturare din platformă are explicit o direcție separată „vânzător către client”, distinctă de factura de comision „vânzător către Artfest”). Dacă ai nevoie de factură pentru o comandă, cere-i-o direct vânzătorului. Pentru a-ți vedea propriile facturi în contul de cumpărător (/facturi) trebuie să ai cont - un vizitator fără cont nu are acces la această secțiune; pentru o comandă plasată ca guest, orice document de facturare trebuie cerut direct vânzătorului sau suportului, cu numărul comenzii.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: userInvoicesRoutes.js, vendorInvoices.js, adminInvoicesRoutes.js. Verificat 2026-08-24. Extins BATCH 5 (audit regression, 2026-09-06) - responsabilitate clară: acest manifest răspunde la „unde găsesc/cum schimb datele”, mecanismul complet de comision/Stripe rămâne STRICT în checkoutPayments.manifest.js, ca să nu apară text contradictoriu duplicat în două locuri. Datele de facturare (CUI, adresă, tip vânzător persoană fizică/firmă) sunt deja acoperite în detaliu de vendorStoreProfile.manifest.js (verificat PASS în auditul inițial) - FAQ-ul de-aici e doar un pointer scurt, nu o duplicare.",
};
