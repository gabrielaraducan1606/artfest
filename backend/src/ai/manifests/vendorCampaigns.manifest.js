// src/ai/manifests/vendorCampaigns.manifest.js

export const VENDOR_CAMPAIGNS_MANIFEST = {
  id: "vendor-campaigns",

  title:
    "Campanii proprii ale vânzătorilor",

  audience: [
    "VENDOR",
    "ADMIN",
  ],

  knowledgeAudience: ["VENDOR", "ADMIN", "USER", "GUEST"],

  available: true,

  /*
   * UPDATE (2026-08-26): fluxul complet a fost implementat și
   * testat end-to-end (token de atribuire semnat server-side,
   * pagină publică /c/:slug, discount aplicat prin engine-ul de
   * preț comun, Shipment.campaignId/campaignCommissionBps scrise
   * la checkout, comision 500 bps citit corect atât pe COD cât și
   * pe CARD). "PARTIAL" anterior descria corect starea de atunci -
   * nu mai e cazul acum. Singura limitare reală rămasă: comenzile
   * din ofertă/quote acceptată nu beneficiază de comisionul redus
   * (Shipment-ul creat acolo nu setează câmpurile de campanie) -
   * decizie de business neconfirmată încă, nu bug.
   */
  status: "ACTIVE",

  tags: [
    "campanie",
    "campanii",
    "link propriu",
    "reducere",
    "comision redus",
    "link de promovare",
    "comision campanie",
  ],

  aliases: [
    "cum fac o campanie",
    "cum am comision mai mic",
    "link de campanie",
    "cum functioneaza campaniile",
    "ce sunt campaniile",
    "cum creez o campanie",
    "cum fac un link de campanie",
    "cum fac un link de promovare",
    "cum aduc clienti prin campania mea",
    "ce comision am prin campanie",
    "campanii pentru vanzatori",
    "client venit din campania mea",
    "ce comision platesc daca aduc eu clientul",
    "clientul a intrat prin linkul meu ce comision platesc",
    "diferenta dintre campanie si produsul zilei",
    "daca intra prin campania mea si cumpara alt produs ce comision am",
    "daca produsul nu are reducerea campaniei mai am comision",
    "daca collection castiga reducerea ce comision am",
    "daca colectia castiga reducerea ce comision am",
    "ce comision am daca clientul cumpara doua produse de ale mele",
    "ce comision am daca cumpara si de la alt vanzator",
    "comisionul de campanie e legat de produsul din campanie sau de tot magazinul",
  ],

  uiLocations: [
    {
      audience: "VENDOR",
      path: "/vendor/catalog (tab Campanii)",
    },
  ],

  capabilities: {
    createEditCampaign: { available: true, status: "ACTIVE" },

    /*
     * UPDATE (2026-08-26): pagina publică /c/:slug există și
     * funcționează (PublicCampaignPage.jsx, rută în App.jsx),
     * afișează corect produsele campaniei cu preț redus (aceeași
     * sursă de preț ca restul platformei) și permite adăugarea în
     * coș. Testat end-to-end.
     */
    customPublicLink: { available: true, status: "ACTIVE" },

    campaignDiscount: { available: true, status: "ACTIVE" },

    /*
     * UPDATE (2026-08-26): mecanismul de atribuire există și
     * funcționează complet - la accesarea /c/:slug, backend-ul
     * emite un token de atribuire semnat (dovadă că vizitatorul a
     * accesat chiar acel link), păstrat per-vendor de browser. La
     * checkout, tokenul e revalidat mereu server-side (campanie
     * activă, neexpirată, vendor activ) înainte să scrie
     * Shipment.campaignId/campaignCommissionBps=500/
     * campaignDiscountPercent - niciodată doar pe baza a ce
     * pretinde clientul. Testat end-to-end: guest, user
     * autentificat, coș cu produse de la mai mulți vendori (fiecare
     * evaluat independent), COD și CARD, discount câștigat corect
     * față de alte promoții existente (fără cumul).
     */
    reducedCommission: { available: true, status: "ACTIVE" },

    /*
     * UPDATE (2026-08-26): endpoint-ul /:slug e acum apelat real de
     * pagina publică, deci 'visits' se incrementează efectiv la
     * fiecare accesare.
     */
    campaignAnalytics: { available: true, status: "ACTIVE" },

    aiCreativeGeneration: { available: false, status: "PLANNED" },
  },

  limitations: [
    "Generarea automată de materiale promoționale cu AI nu este disponibilă încă.",
    "Comenzile create dintr-o ofertă/cerere de ofertă acceptată (nu din coș normal) nu beneficiază de comisionul redus de campanie - shipment-ul acelei comenzi nu setează câmpurile de campanie. E o decizie de business neconfirmată încă, nu un bug de implementare.",
    "Profilul public al magazinului (/magazin/:slug) NU e loc de descoperire pentru campanii - nu arată \"toate campaniile active\" ale vendorului către orice vizitator. Arată doar campania pentru care vizitatorul curent are o atribuire validă (a accesat linkul ei anterior); altfel, nu apare nicio campanie acolo.",
  ],

  unavailableFeatures: [
    "Generare automată de creative promoționale cu AI",
    "Comision redus de campanie pentru comenzi din ofertă/cerere de ofertă acceptată",
  ],

  faq: [
    {
      q: "Cum funcționează campaniile?",
      a: "O campanie e un link propriu (/c/...), cu un nume ales de tine, opțional cu o reducere pentru client (0/5/10/15%) pentru toate produsele tale sau doar pentru câteva selectate. Poți crea, edita, activa/dezactiva și șterge oricâte campanii vrei, din contul tău. Cineva care intră prin linkul tău vede o pagină publică cu produsele campaniei la preț redus; dacă apoi cumpără (chiar și mai târziu, în fereastra de atribuire de 7 zile), comanda ta primește comision Artfest redus la 5% în loc de 12%.",
    },
    {
      q: "Ce sunt campaniile?",
      a: "Un instrument prin care tu, ca vânzător, creezi un link propriu de promovare, cu o reducere opțională pentru clienți, care îți reduce comisionul Artfest la comenzile aduse prin acel link.",
    },
    {
      q: "Cum creez o campanie?",
      a: "Din contul tău de vânzător, secțiunea Catalog, tab-ul Campanii - alegi un nume, opțional o reducere și dacă se aplică la toate produsele sau doar la unele selectate.",
    },
    {
      q: "Cum fac un link de campanie / de promovare?",
      a: "Se generează automat când creezi o campanie - îl găsești și îl poți copia din tab-ul Campanii, din contul tău.",
    },
    {
      q: "Cum aduc clienți prin campania mea?",
      a: "Distribui linkul campaniei (Instagram, Facebook, TikTok, WhatsApp etc.). Cine îl accesează vede o pagină cu produsele tale la prețul cu reducere; dacă cumpără (inclusiv la o revenire ulterioară, în fereastra de 7 zile), comanda beneficiază de comisionul tău redus.",
    },
    {
      q: "Ce comision am prin campanie?",
      a: "5% (față de 12% comisionul standard) pentru o comandă a cărei atribuire la campania ta a fost validată - clientul chiar a accesat linkul tău, iar campania era activă și în perioada ei de valabilitate la momentul comenzii.",
    },
    {
      q: "Clientul a intrat prin linkul meu. Ce comision plătesc?",
      a: "5% în loc de 12%, atâta timp cât atribuirea e validă (link accesat, campanie activă, comandă în fereastra de 7 zile). Comisionul e decis mereu server-side, nu poate fi falsificat de client. Dacă vezi un comision neașteptat pe o comandă anume, contactează suportul Artfest cu numărul comenzii.",
    },
    {
      q: "Care e diferența dintre o campanie și produsul zilei / artizanul săptămânii?",
      a: "Campania e inițiată și controlată de TINE, oricând, prin propriul link - o creezi când vrei. Produsul zilei/Artizanul săptămânii sunt selecții făcute de PLATFORMĂ (automat, prin rotație, sau manual de echipa Artfest) - nu poți aplica sau cere să fii ales, doar poți accepta opțional o reducere suplimentară dacă ești selectat. Dacă un produs are ambele active simultan, câștigă discountul mai mare, fără să se cumuleze. Vezi manifestul homepage-features pentru detalii despre Produsul zilei/Artizanul săptămânii.",
    },
    {
      q: "De ce nu văd campania mea în profilul public al magazinului?",
      a: "Profilul magazinului nu listează toate campaniile tale active tuturor vizitatorilor - arată o campanie doar vizitatorului care a intrat anterior prin linkul ei. Dacă tu (sau altcineva) accesezi direct /magazin/... fără să fi trecut prin /c/..., nu apare nicio campanie acolo - e comportamentul așteptat, nu o eroare.",
    },
    {
      q: "Dacă intră prin campania mea și cumpără alt produs de-al meu (nu cel din campanie), ce comision am?",
      a: "Tot 5%. Atribuirea de campanie e legată de VIZITATOR + TINE ca vânzător, nu de un produs anume - dacă atribuirea e validă (a intrat prin linkul tău, campania era activă, comanda e în fereastra de atribuire), TOATE produsele tale cumpărate de acel client în acea comandă primesc comisionul redus de 5%, indiferent dacă produsul cumpărat e inclus explicit în campanie sau nu.",
    },
    {
      q: "Dacă produsul cumpărat nu are reducerea campaniei (nu e inclus, campanie cu produse selectate), mai am comision 5%?",
      a: "Da. Includerea unui produs în campanie (scope 'doar produse selectate') decide DOAR dacă acel produs primește reducerea de preț pentru client - nu are legătură cu comisionul. Comisionul redus de 5% se aplică la nivel de comandă/vânzător, pe baza atribuirii valide, indiferent ce produs anume a cumpărat clientul.",
    },
    {
      q: "Dacă altă reducere (Colecție, Produsul zilei, Artizanul săptămânii) câștigă discountul afișat clientului, mai am comision de campanie 5%?",
      a: "Da - prețul afișat clientului și comisionul tău sunt DOUĂ lucruri complet separate. Prețul folosește mereu reducerea cea mai mare dintre Colecție/Produsul zilei/Artizanul săptămânii/Campanie, fără cumul - poate câștiga oricare dintre ele. Comisionul de 5% depinde STRICT de atribuirea de campanie validă (a intrat prin linkul tău), nu de care reducere a câștigat la preț. Chiar dacă clientul vede reducerea de la Colecție, tu tot ai comision 5% dacă atribuirea de campanie e validă.",
    },
    {
      q: "Dacă clientul cumpără două produse de-ale mele într-o singură comandă, prin campania mea, ce comision am?",
      a: "5% pentru toată comanda ta (ambele produse) - comisionul redus se aplică la nivelul livrării tale (shipment-ul tău din acea comandă), nu produs cu produs.",
    },
    {
      q: "Dacă clientul cumpără și de la alt vânzător în aceeași comandă, ce comision am eu față de celălalt vânzător?",
      a: "Fiecare vânzător e evaluat independent. Tu ai 5% dacă atribuirea prin campania TA e validă pentru acel client. Celălalt vânzător are propriul comision standard (de obicei 12%), decât dacă și clientul a intrat separat prin campania LUI - comisioanele nu se amestecă între vânzători într-o comandă cu produse de la mai mulți.",
    },
  ],

  notes:
    "Sursă: vendorCampaignRoutes.js (CAMPAIGN_COMMISSION_BPS=500, ALLOWED_DISCOUNTS=[0,5,10,15], DEFAULT_ATTRIBUTION_WINDOW_HOURS=168), publicCampaignRoutes.js (GET /:slug - pagină publică + attributionToken + 'visits'; GET /store/:storeSlug - campania contextuală vizibilă în profil, revalidată server-side), campaignAttributionToken.js (semnare/verificare JWT), campaignAttribution.js (resolveVendorCampaignAttributions - revalidare fresh din DB la checkout), chekoutRoutes.js/cartRoutes.js (scriu Shipment.campaignId/campaignCommissionBps/campaignDiscountPercent/campaignAttributedAt, citite corect ulterior de marketplaceCalc.js și vendorOrdersRoutes.js pentru comisionul efectiv). Testat end-to-end 2026-08-26: guest, user autentificat, ALL_PRODUCTS, SELECTED_PRODUCTS, produs cu promoție existentă (câștigă cel mai mare, fără cumul), campanie expirată/dezactivată (fail-open, comandă normală), coș multi-vendor (fiecare vendor evaluat independent), COD și CARD, retry/webhook duplicat (fără dublare de comision). Limitare confirmată: comenzile din ofertă/quote acceptată nu ating acest mecanism.",

  basePath:
    "/api/vendor/campaigns",

  description:
    "Permite vânzătorilor să creeze campanii proprii (nume, reducere opțională, produse incluse) cu un link unic (/c/:slug) - creare, administrare, pagină publică și atribuire de comision redus funcționează complet, testat end-to-end. Un client venit prin link vede produsele la preț redus și, dacă cumpără (inclusiv la o revenire ulterioară), comanda primește comision Artfest 5% în loc de 12% standard.",

  features: {
    createCampaign: true,
    listCampaigns: true,
    editCampaign: true,
    deleteCampaign: true,
    activateCampaign: true,
    deactivateCampaign: true,

    allProductsScope: true,
    selectedProductsScope: true,

    customPublicLink: true,
    campaignDiscount: true,
    reducedArtfestCommission: true,

    campaignAnalytics: true,

    promotionalCreatives: true,
    aiCreativeGeneration: false,
  },

  rules: {
    commissionControlledByPlatform: true,

    /*
     * BUGFIX (audit): era 600 (6%) - greșit. Verificat direct în
     * cod: CAMPAIGN_COMMISSION_BPS = 500 în vendorCampaignRoutes.js,
     * cu comentariu explicit "500 = 5%".
     */
    defaultCommissionBps:
      500,

    standardCommissionBps:
      1200,

    allowedDiscountPercents: [
      0,
      5,
      10,
      15,
    ],

    defaultAttributionWindowHours:
      168,
  },

  endpoints: {
    list: {
      method:
        "GET",

      path:
        "/",

      purpose:
        "Returnează campaniile vendorului autentificat.",
    },

    create: {
      method:
        "POST",

      path:
        "/",

      purpose:
        "Creează o campanie nouă pentru vendor.",
    },

    detail: {
      method:
        "GET",

      path:
        "/:campaignId",

      purpose:
        "Returnează detaliile unei campanii.",
    },

    update: {
      method:
        "PATCH",

      path:
        "/:campaignId",

      purpose:
        "Modifică numele, reducerea, scope-ul sau perioada unei campanii.",
    },

    status: {
      method:
        "PATCH",

      path:
        "/:campaignId/status",

      purpose:
        "Activează sau dezactivează campania.",
    },

    delete: {
      method:
        "DELETE",

      path:
        "/:campaignId",

      purpose:
        "Șterge campania vendorului.",
    },

    products: {
      method:
        "PUT",

      path:
        "/:campaignId/products",

      purpose:
        "Setează produsele incluse într-o campanie de tip SELECTED_PRODUCTS.",
    },

    creatives: {
      method:
        "GET",

      path:
        "/:campaignId/creatives",

      purpose:
        "Returnează materialele promoționale asociate campaniei.",
    },

    generateCreatives: {
      method:
        "POST",

      path:
        "/:campaignId/creatives/generate",

      purpose:
        "Generează materiale promoționale pentru campanie.",

      available:
        false,

      status:
        "PLANNED",
    },
  },
};

export function getVendorCampaignRoute(
  key
) {
  const endpoint =
    VENDOR_CAMPAIGNS_MANIFEST
      .endpoints[key];

  if (!endpoint) {
    throw new Error(
      `Unknown vendor campaign route: ${key}`
    );
  }

  return endpoint.path;
}