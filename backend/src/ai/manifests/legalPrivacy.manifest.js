// backend/src/ai/manifests/legalPrivacy.manifest.js

export const LEGAL_PRIVACY_MANIFEST = {
  id: "legal-privacy",

  title: "Legal, confidențialitate și cookies",

  audience: ["USER", "VENDOR", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Documente legale: termeni și condiții, politică de confidențialitate, politică de retur, acord vânzători, politică cookies.",

  tags: ["legal", "confidentialitate", "cookies", "termeni", "gdpr"],

  aliases: [
    "unde gasesc termenii si conditiile",
    "politica de confidentialitate",
    "politica de retur",
    "cum imi schimb preferintele de cookies",

    /*
     * BATCH G (audit regression Vendor Assistant, 2026-09-07).
     */
    "unde e acordul pentru vanzatori",
    "ce date colecteaza artfest",
    "cine emite factura pentru client",
    "cine imi trimite factura ca si client",
    "ce date sunt publice despre magazinul meu",
    "cum imi sterg datele",
    "vanzatorul vede toate datele mele",
    "cine are acces la conversatiile mele",

    /*
     * USER BATCH 3 (audit 2026-09-08) - "Ce date vede vânzătorul?"
     * (fără alte cuvinte) potrivea deja organic pe alias-ul de mai sus,
     * dar fraza mai naturală/completă "Ce date personale vede
     * vânzătorul despre mine?" NU potrivea NIMIC (topicId=null,
     * fallback generic) - cuvintele suplimentare ("personale", "despre
     * mine") diluau suficient overlap-ul cât să pice sub scorul minim.
     * Alias STRICT pe formularea completă, nu doar pe cuvinte izolate.
     */
    "ce date personale vede vanzatorul despre mine",
    "ce date vede vanzatorul despre mine",
    "cum imi sterg contul",
    "pot vinde fara firma",
    "trebuie sa am firma pentru a vinde",
  ],

  uiLocations: [
    { audience: "GUEST", path: "/confidentialitate" },
    { audience: "GUEST", path: "/termenii-si-conditiile" },
    { audience: "GUEST", path: "/acord-vanzatori" },
    { audience: "GUEST", path: "/politica-retur" },
    { audience: "GUEST", path: "/politica-cookie" },
    { audience: "GUEST", path: "/preferinte-cookie" },
  ],

  capabilities: {
    staticLegalPages: { available: true },
    cookiePreferences: { available: true },
  },

  limitations: [],
  flows: [],
  integrations: {},

  endpoints: {},

  faq: [
    {
      q: "Unde găsesc termenii și condițiile?",
      a: "La /termenii-si-conditiile - document legal static, valabil pentru toți utilizatorii platformei.",
    },
    {
      q: "Unde găsesc politica de confidențialitate?",
      a: "La /confidentialitate - acolo găsești ce date colectează Artfest și cum le folosește. Conținutul exact al politicii e un document legal static, nu ceva ce pot rezuma eu aici cu certitudine - citește pagina direct pentru detalii complete.",
    },
    {
      q: "Unde găsesc acordul pentru vânzători?",
      a: "La /acord-vanzatori - documentul legal specific pentru cei care vând pe Artfest, distinct de termenii generali de utilizare.",
    },
    {
      q: "Cine emite factura pentru client, la o comandă?",
      a: "Vânzătorul, nu Artfest - facturile pentru comenzi au direcția „de la vânzător către client” (VENDOR_TO_CLIENT), separat de facturile de comision pe care Artfest le emite vânzătorului (PLATFORM_TO_VENDOR).",
    },
    {
      q: "Ce date despre magazinul meu sunt publice?",
      a: "Detaliile publice de profil (nume magazin, descriere, logo, oraș, contact public) - vezi manifestul vendor-store-profile pentru lista completă și distincția față de datele private de facturare.",
    },
    {
      q: "Cum îmi șterg datele sau contul?",
      a: "Din contul tău de vânzător, secțiunea de setări - procesul de ștergere a contului (ireversibil, ce se păstrează/anonimizează) e documentat complet în manifestul vendor-store-profile.",
    },
    {
      q: "Pot vinde fără firmă, ca persoană fizică?",
      a: "Da - regulile exacte (prag de venit, tip de vânzător) sunt documentate în manifestele checkout-payments și vendor-store-profile, nu le repet aici ca să nu apară informație duplicată/contradictorie.",
    },
    {
      q: "Cum funcționează politica de retur?",
      a: "Condițiile de retur (termene, ce e eligibil) sunt în pagina Politica de retur (/politica-retur, document legal static). Fluxul practic de inițiere a unui retur e documentat separat, în manifestul returns.",
    },

    /*
     * FINAL BATCH 3 (audit regression, 2026-09-07) - completate STRICT
     * pe fapte verificate direct în cod (VendorAcceptance/VendorDoc,
     * authRoutes.js) - NU interpretare juridică proprie, doar ce
     * confirmă codul.
     */
    {
      q: "Ce termeni trebuie să accept ca vânzător?",
      a: "La înregistrarea ca vânzător accepți acordul pentru vânzători (VENDOR_TERMS, /acord-vanzatori) - acceptarea e înregistrată cu versiunea documentului la acel moment (model VendorAcceptance). Termenii generali (/termenii-si-conditiile) se aplică tuturor utilizatorilor, indiferent de rol.",
    },
    {
      q: "Ce se întâmplă dacă termenii se schimbă?",
      a: "Nu am găsit, în cod, un mecanism automat care să-ți solicite re-acceptarea când documentele legale (termeni, acord vânzători) se actualizează - acceptarea ta e înregistrată o singură dată, la momentul respectiv, cu versiunea documentului din acel moment. Recomand verificarea periodică a paginilor legale direct, dacă vrei să fii sigur că ești la curent cu ultima versiune.",
    },
    {
      q: "Cine răspunde pentru produs, vânzătorul sau Artfest?",
      a: "Structura de facturare confirmă că vânzătorul vinde direct clientului - facturile pentru comenzi au direcția „de la vânzător către client” (VENDOR_TO_CLIENT), nu de la Artfest. Nu pot detalia dincolo de acest fapt confirmat în cod - pentru întrebări juridice exacte despre răspundere, consultă acordul pentru vânzători (/acord-vanzatori) sau contactează suportul.",
    },
    {
      q: "Ce date personale ale mele vede clientul?",
      a: "Doar datele publice de profil ale magazinului tău (nume, descriere, logo, oraș, contact public) - vezi manifestul vendor-store-profile pentru lista completă. Datele de facturare (CUI, adresă de facturare) și cele de cont NU sunt vizibile clientului.",
    },
    {
      q: "Ce se întâmplă cu datele mele dacă șterg contul?",
      a: "Datele personale și ale magazinului sunt anonimizate (emailul e suprascris, parola devine inutilizabilă), contul e blocat definitiv, toate serviciile dezactivate și produsele ascunse - acțiune ireversibilă. Detalii complete în manifestul vendor-store-profile.",
    },
    {
      q: "Vânzătorul vede toate datele mele, ca cumpărător?",
      a: "Nu, doar ce e strict necesar pentru comanda ta: nume, adresa de livrare, telefon și opțional email, vizibile abia DUPĂ ce plasezi o comandă la el. Nu are acces la contul tău, la parola ta, la datele cardului sau la alte comenzi ale tale de la alți vânzători.",
    },
    {
      q: "Cine are acces la conversațiile mele?",
      a: "Conversația e vizibilă participanților ei (tu și vânzătorul cu care discuți) - echipa Artfest poate avea acces în măsura în care e nevoie pentru moderare sau pentru rezolvarea unui tichet de suport legat de acea conversație. Nu există acces public sau al altor clienți.",
    },
  ],
  unavailableFeatures: [],

  notes:
    "Sursă: legalRoutes.js, cookiesRoutes.js, agreementsRoutes.js. Pagini statice (conținutul lor legal e HTML servit separat - frontend/App.jsx, LegalHtmlRoute -> /legal/tos.html, /legal/vendor_terms.html, /legal/returns_policy_ack.html - text NEDISPONIBIL în codul JS, deci FAQ-ul de-aici direcționează spre pagini, nu rezumă conținutul legal exact). Verificat 2026-08-24.\n\nBATCH G (audit regression Vendor Assistant, 2026-09-07): manifestul avea faq:[] complet gol - confirmat direct, nu presupus din auditul inițial. Adăugat FAQ real, STRICT pe fapte verificabile în cod sau pe direcționare către pagini (fără să inventez conținut legal specific - termene, clauze, procente - care există doar ca text HTML static, nu în cod). Verificat exact enum InvoiceDirection (schema.prisma:2257-2262): VENDOR_TO_PLATFORM/PLATFORM_TO_CLIENT/PLATFORM_TO_VENDOR/VENDOR_TO_CLIENT - grep pe VENDOR_TO_CLIENT confirmă creare în vendorOrdersRoutes.js:4532/4705/4730 (vendorul emite factura comenzii către clientul lui) și userInvoicesRoutes.js (clientul o vede) - distinct de PLATFORM_TO_VENDOR (facturile de comision Artfest->vendor, Batch A/Faza 2). Ce date publice / ștergere cont / vânzare fără firmă: doar REFERITE către vendorStoreProfile.manifest.js/checkoutPayments.manifest.js (deja documentate corect acolo, verificat în audituri anterioare din conversație) - NU duplicat conținutul aici. returns.manifest.js verificat separat: deja complet și onest (status PARTIAL, documentează clar că fluxul self-service de retur NU e confirmat funcțional în backend) - nu necesita nicio corecție de conținut, FAIL-urile din auditul inițial pe acest subiect par să fi fost strict de retrieval/clasificare, nu de conținut lipsă - neatins.",
};
