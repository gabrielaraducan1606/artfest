// Conținut PUR (fără logică) pentru secțiunea „Ce poate face comunitatea
// ta pe Artfest” din dashboardul influencerului.
//
// Fiecare element de mai jos a fost verificat direct în cod (rută
// frontend reală, endpoint backend real sau fișier `backend/src/ai/
// manifests/*.js` care descrie o capacitate reală a asistentului AI) -
// NU e o listă de intenții sau funcționalități planificate. Sursele
// exacte sunt notate în comentarii, ca oricine să poată reverifica rapid
// dacă o funcționalitate se schimbă.
//
// Text static, actualizat manual la nevoie - NU se calculează din vreun
// API la runtime (secțiunea e strict informativă/comercială).

/* =========================================================
   CLIENȚI (guest + cont User)

   Guest = poate face asta FĂRĂ cont Artfest.
   Cont  = necesită autentificare (email/parolă sau Google).
========================================================= */

export const CLIENT_FEATURE_GROUPS = [
  {
    id: "discovery",
    title: "Descoperire",
    items: [
      {
        icon: "🔎",
        title: "Caută exact ce își doresc",
        text: "După categorie, preț sau cuvinte cheie - simplu și rapid.",
        access: "guest",
        // frontend/src/pages/Products/Products.jsx (+ filtre), rută /produse
      },
      {
        icon: "📸",
        title: "Caută după o fotografie",
        text: "Încarcă o poză, iar asistentul găsește produse asemănătoare.",
        access: "guest",
        // frontend/src/components/AIAssistant/Products/assistantProducts.js (flow "image-search")
      },
      {
        icon: "💬",
        title: "Cere recomandări asistentului AI",
        text: "De exemplu: „Vreau un cadou sub 150 lei”.",
        access: "guest",
        // assistantProducts.js (BUDGET_OPTIONS, flow-uri cadou/ocazie)
      },
    ],
  },
  {
    id: "requests",
    title: "Cereri și personalizare",
    items: [
      {
        icon: "📝",
        title: "Cere o ofertă personalizată",
        text: "Pentru invitații, mărturii sau produse la comandă.",
        access: "guest",
        // rută /cereri (CustomerRequestsPage.jsx), backend/src/routes/customerRequestsRoutes.js
      },
      {
        icon: "💌",
        title: "Primește și compară oferte",
        text: "Discută direct cu creatorul, în Artfest.",
        access: "guest",
        // backend/src/ai/manifests/quotes.manifest.js + messages.manifest.js
      },
    ],
  },
  {
    id: "purchase",
    title: "Cumpărare și comandă",
    items: [
      {
        icon: "🛍️",
        title: "Cumpără fără cont",
        text: "Card sau ramburs, fără înregistrare.",
        access: "guest",
        // rute /checkout, /comanda-guest/:id; backend/src/ai/manifests/checkoutPayments.manifest.js
      },
      {
        icon: "🎟️",
        title: "Descoperă selecții speciale",
        text: "Produsul zilei, Artizanul săptămânii și colecții tematice.",
        access: "guest",
        // rute /colectii/:slug, /selectii/:slug; backend/src/ai/manifests/homepageFeatures.manifest.js
      },
      {
        icon: "📦",
        title: "Urmărește comanda",
        text: "Cu cont Artfest, prin email sau Google.",
        access: "account",
        // rute /comenzile-mele, /comanda/:id, /notificari, /autentificare
      },
    ],
  },
];

/* =========================================================
   CREATORI / VÂNZĂTORI
========================================================= */

export const VENDOR_FEATURE_GROUPS = [
  {
    id: "store",
    title: "Magazin și produse",
    items: [
      {
        icon: "🏪",
        title: "Magazin propriu",
        text: "Produse, variante și disponibilitate - pe stoc, la comandă sau precomandă.",
        // rute /vendor/store, /vendor/catalog; backend/src/ai/manifests/vendorStoreProfile.manifest.js
      },
      {
        icon: "🤖",
        title: "Asistent AI pentru produse",
        text: "Fotografiază produsul, iar AI-ul completează automat detaliile.",
        // backend/src/routes/vendorProductAIRoutes.js (POST .../products/analyze)
      },
      {
        icon: "💰",
        title: "Calculator de preț și profit",
        text: "Află rapid cât câștigă la fiecare produs.",
        // rute /vendor/costs-profit, /vendor/costs-profit/library; backend/src/ai/manifests/costsProfit.manifest.js
      },
      {
        icon: "📥",
        title: "Import/export produse din Excel",
        text: "Adaugă sau actualizează zeci de produse dintr-un fișier.",
        // backend/src/routes/vendorCatalogImportRoutes.js (upload/preview/execute/export/history)
      },
    ],
  },
  {
    id: "orders",
    title: "Comenzi și clienți",
    items: [
      {
        icon: "💬",
        title: "Cereri de ofertă și mesaje",
        text: "Răspunde direct clienților care cer produse personalizate.",
        // rută /mesaje; backend/src/ai/manifests/quotes.manifest.js + messages.manifest.js
      },
      {
        icon: "📦",
        title: "Comenzi și livrare",
        text: "Curier, facturi și plată - card sau ramburs.",
        // rute /vendor/orders, /vendor/orders/planning, /facturi; backend/src/ai/manifests/shippingAwb.manifest.js
      },
    ],
  },
  {
    id: "promotion",
    title: "Promovare",
    items: [
      {
        icon: "🎟️",
        title: "Coduri de reducere și colecții",
        text: "Campanii proprii, ușor de distribuit.",
        // rute /vendor/promovari; backend/src/ai/manifests/vendorCampaigns.manifest.js + collections.manifest.js
      },
      {
        icon: "📊",
        title: "Statistici și vizitatori",
        text: "Vede ce funcționează cel mai bine în magazin.",
        // rută /vendor/visitors; backend/src/ai/manifests/vendorVisitors.manifest.js
      },
    ],
  },
  {
    id: "support",
    title: "Suport",
    items: [
      {
        icon: "🤝",
        title: "Asistent AI + suport dedicat",
        text: "Recomandări zilnice și ajutor rapid când are nevoie.",
        // rute /vendor/support, /support; VendorAIAssistant/VendorAssistant.jsx
      },
    ],
  },
];

/* =========================================================
   IDEI DE CONȚINUT (generale, nu per-funcționalitate - max. 5)
========================================================= */

export const CONTENT_IDEAS = [
  "Arată cum cauți un produs după o fotografie.",
  "Cere-i asistentului un cadou sub un buget anume.",
  "Arată cum trimiți o cerere de ofertă pentru mărturii sau invitații.",
];

/* =========================================================
   CTA-URI (doar rute publice reale, verificate în App.jsx)
========================================================= */

export const CLIENT_CTAS = [
  { label: "Vezi produsele", href: "/produse" },
  { label: "Vezi magazinele", href: "/magazine" },
  { label: "Trimite o cerere de ofertă", href: "/cereri" },
];

export const VENDOR_CTAS = [
  { label: "Vezi cum funcționează pentru creatori", href: "/" },
];
