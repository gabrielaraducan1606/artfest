// backend/src/ai/manifests/subscriptionsPlans.manifest.js

export const SUBSCRIPTIONS_PLANS_MANIFEST = {
  id: "subscriptions-plans",

  title: "Abonamente și planuri vânzător",

  audience: ["VENDOR", "ADMIN"],

  knowledgeAudience: ["VENDOR", "ADMIN", "USER", "GUEST"],

  available: true,
  status: "PARTIAL",

  description:
    "Planurile de abonament ale vânzătorilor (determină comisionul aplicat). Administrarea planurilor se face momentan de echipa Artfest (admin); vânzătorul vede efectul (comisionul), dar nu are o pagină proprie „planul meu” pentru auto-administrare. Momentan este activ DOAR planul gratuit (Basic) - planurile plătite (Pro, Premium) există definite în sistem, dar sunt marcate indisponibile (isActive:false) și nu pot fi cumpărate.",

  tags: [
    "abonament",
    "plan",
    "comision",
    "cat costa sa vand",
    "plan gratuit",
    "planuri platite",
  ],

  aliases: [
    "ce plan am",
    "cum imi schimb planul",
    "cat comision platesc",
    "artfest are abonament",
    "cat costa sa vand pe artfest",
    "ce comision platesc daca aduc eu clientul",
    "mai exista planuri platite",
    "exista plan gratuit",

    /*
     * Retrieval instabil pentru comision (audit 2026-09-04) - vezi
     * checkoutPayments.manifest.js pentru mecanismul de plată; aici e
     * procentul exact, care lipsea din rezultate pentru aceste
     * formulări (ajungeau la platform-overview/collections).
     */
    "ce procent ia artfest",
    "procent comision artfest",
    "comisionul se retine automat",
    "trebuie sa platesc manual comisionul",
  ],

  uiLocations: [
    { audience: "ADMIN", path: "/admin (vendor plans)" },
  ],

  capabilities: {
    adminManagesPlans: { available: true, audience: ["ADMIN"] },
    vendorSelfServicePlanChange: {
      available: false,
      status: "PLANNED",
    },

    freePlan: { available: true, status: "ACTIVE" },

    paidPlans: {
      available: false,
      status: "DISABLED",
    },
  },

  limitations: [
    "Vânzătorul nu poate schimba singur planul de abonament - se face de echipa Artfest.",
    "Momentan este disponibil DOAR planul gratuit (Basic) - planurile plătite (Pro, Premium) sunt definite în sistem, dar dezactivate (isActive:false), nu pot fi cumpărate acum.",
    "Nu se știe dacă/când planurile plătite vor deveni din nou disponibile - nu se promite o dată sau o revenire viitoare.",
  ],

  flows: [],
  integrations: {},

  endpoints: {
    adminPlans: {
      method: "GET",
      path: "/api/admin/vendors/plans",
      purpose: "Listează planurile de abonament (admin).",
      audience: ["ADMIN"],
    },
  },

  faq: [
    {
      q: "Cum îmi schimb planul de abonament?",
      a: "Momentan schimbarea planului de abonament se face de echipa Artfest, nu direct de vânzător - contactează suportul pentru asta.",
    },
    {
      q: "Artfest are abonament?",
      a: "Momentan este disponibil doar planul gratuit (Basic) - nu ai niciun cost fix pentru a vinde pe Artfest. Există și planuri plătite definite în sistem (Pro, Premium), dar sunt momentan dezactivate și nu pot fi cumpărate. Nu pot confirma dacă sau când vor deveni din nou disponibile.",
    },
    {
      q: "Cât costă să vând pe Artfest?",
      a: "Nimic fix - planul disponibil momentan (Basic) este gratuit. Artfest percepe un comision din vânzări, nu o taxă fixă lunară.",
    },
    {
      q: "Cât este comisionul pe Artfest?",
      a: "Comisionul standard, pe planul gratuit activ momentan, este 12% din valoarea produselor vândute, fără transport (5% pentru o comandă atribuită unei campanii proprii validate). Se calculează la fiecare comandă, dar NU se scade automat din nicio plată (nici card, nici ramburs) - se adună într-un jurnal intern și Artfest emite periodic o factură cu comisionul datorat, la fel pentru toate comenzile, indiferent de metoda de plată; vezi manifestul checkout-payments pentru mecanismul complet.",
    },
    {
      q: "Ce comision plătesc dacă aduc eu clientul?",
      a: "5% (față de 12% standard) pentru o comandă a cărei atribuire la campania ta proprie a fost validată - vezi manifestul vendor-campaigns pentru detalii complete. E un mecanism complet funcțional, testat end-to-end: clientul trebuie să fi accesat linkul tău de campanie, iar campania să fie activă și în perioada ei de valabilitate la momentul comenzii; comisionul e decis mereu server-side, nu poate fi falsificat.",
    },
    {
      q: "Mai există planuri plătite?",
      a: "Planurile plătite (Pro, Premium) sunt definite în sistem, dar momentan dezactivate - nu pot fi cumpărate. Nu pot confirma dacă vor reveni active în viitor.",
    },
  ],

  unavailableFeatures: [
    "Schimbare plan direct de vânzător",
    "Cumpărarea unui plan plătit (Pro, Premium) - definite în sistem, dar dezactivate momentan",
  ],

  notes:
    "Sursă: subscriptionRoutes.js, adminSubscriptionRoutes.js, billingRoutes.js, prisma/seed-subscription-plans.mjs (commissionBps: 1200 pe planul 'basic', isActive:true; planurile 'pro'/'premium' au isActive:false - verificat direct în seed). Comisionul de 5% pentru comenzi atribuite unei campanii proprii (CAMPAIGN_COMMISSION_BPS=500 în vendorCampaignRoutes.js) e complet implementat și testat end-to-end - vezi manifestul vendor-campaigns pentru mecanismul complet. Nicio pagină „planul meu” găsită sub pages/Vendor/. Verificat 2026-08-26. CORECȚIE 2026-09-04: plata comisionului NU e mereu o deducere automată din payout-ul Stripe al vendorului - vezi checkoutPayments.manifest.js pentru mecanismul complet verificat în cod (adminInvoicesRoutes.js, vendorInvoices.js). NUANȚĂ BATCH 5 (audit regression, 2026-09-06, ISTORIC - vezi corecția de mai jos): la data auditului, pentru comenzile cu cardul comisionul CHIAR se deducea automat din transferul Stripe, cu un risc de dublă facturare identificat. BATCH A / MODEL B (2026-09-07): riscul a fost confirmat și REPARAT prin decizie de business - comisionul NU mai e dedus din niciun transfer (nici card, nici ramburs); `computeVendorPayouts` (marketplaceCalc.js) reține acum doar taxa Stripe. Comisionul se facturează IDENTIC pentru CARD și COD, periodic, manual din admin (implicit pentru luna calendaristică anterioară) - detalii complete în notes din checkoutPayments.manifest.js.",
};
