// backend/src/ai/manifests/vendorStoreProfile.manifest.js

export const VENDOR_STORE_PROFILE_MANIFEST = {
  id: "vendor-store-profile",

  title: "Profil magazin și onboarding vânzător",

  audience: ["VENDOR"],

  /*
   * BUGFIX (generalizare USER/GUEST): "Cum devin vânzător?" trebuie
   * să funcționeze pentru orice vizitator, nu doar pentru cineva
   * deja autentificat ca VENDOR.
   */
  knowledgeAudience: ["VENDOR", "USER", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Crearea și administrarea profilului de vânzător/magazin: date magazin, tipuri de servicii oferite, onboarding inițial. Include și cum devine cineva vânzător pe Artfest (înregistrare cu opțiunea 'Devino partener', urmată de completarea profilului de magazin).",

  tags: [
    "magazin",
    "profil vanzator",
    "onboarding",
    "date magazin",
    "servicii",
    "devin vanzator",
    "inregistrare vanzator",
    "cont vanzator",
    "forma juridica",
    "pfa",
    "srl",
    "creator independent",
    "business verificat",
    "persoana fizica",
  ],

  aliases: [
    "cum imi creez magazinul",
    "cum imi editez profilul de vanzator",
    "cum adaug un serviciu nou",
    "cum devin vanzator",
    "cum ma inregistrez ca vanzator",
    "vreau sa vand pe artfest",
    "cum incep sa vand pe artfest",
    "trebuie sa am firma ca sa vand",
    "pot vinde fara srl",
    "pot vinde fara pfa",
    "pot incepe sa vand ca persoana fizica",
    "ce se intampla daca depasesc 10000 lei",
    "cand trebuie sa imi fac firma",
    "cat pot vinde fara firma",

    /*
     * Gap 2026-09-04 (audit Setări Vendor) - retrieval rata acest
     * manifest pentru formulările exacte de mai jos (ajungea la
     * platform-overview/catalog-imports/auth-account, confidence 1
     * dar pe manifestul greșit). Alias-uri explicite, oglindă a
     * fix-ului aplicat la comision.
     */
    "cum schimb numele magazinului",
    "schimb numele magazinului",
    "vreau sa schimb numele magazinului",
    "cum schimb descrierea magazinului",
    "schimb descrierea",
    "cum schimb adresa magazinului",
    "schimb adresa magazinului",
    "cum schimb logo-ul magazinului",
    "cum schimb poza de profil a magazinului",
    "cum schimb datele de contact",
    "cum schimb telefonul magazinului",
    "cum schimb emailul magazinului",

    /*
     * Gap 2026-09-04 (audit Setări Vendor) - facturare/CUI, complet
     * necunoscute anterior.
     */
    "cum schimb datele de facturare",
    "unde completez cui-ul",
    "unde pun cui-ul",
    "cum schimb adresa de facturare",
    "cum trec de la persoana fizica la firma",
    "cum adaug cui-ul firmei",
    "cum schimb denumirea firmei",
    "cum schimb forma juridica",

    /*
     * Feature 2026-09-04 (audit + implementare "Pauză magazin") -
     * reutilizează mecanismul EXISTENT activate/deactivate per
     * VendorService (vendorRoutes.js), surfacat acum și în
     * /setari?tab=profile. FOARTE IMPORTANT: aceste alias-uri NU
     * trebuie confundate cu ștergerea definitivă de cont (mai jos,
     * capability accountDeletion) - pauza e reversibilă, ștergerea nu.
     */
    "pun magazinul pe pauza",
    "cum pun magazinul pe pauza",
    "dezactivez temporar magazinul",
    "cum dezactivez temporar magazinul",
    "ascund temporar magazinul",
    "cum ascund temporar magazinul",
    "reactivez magazinul",
    "cum reactivez magazinul",
    "pornesc magazinul din nou",
    "cum pornesc magazinul din nou",

    /*
     * Ștergerea definitivă - INTENȚIONAT cu formulări diferite de
     * cele de mai sus, ca retrieval-ul să nu le confunde.
     */
    "sterg contul definitiv",
    "cum sterg contul definitiv",
    "inchid definitiv contul",
    "cum inchid definitiv contul",
  ],

  uiLocations: [
    { audience: "VENDOR", path: "/onboarding" },
    { audience: "VENDOR", path: "/onboarding/details" },

    /*
     * CORECȚIE 2026-09-04: /vendor/store NU e o pagină de editare -
     * StoreRedirect.jsx doar redirecționează către pagina PUBLICĂ a
     * magazinului (/magazin/:slug) sau /onboarding dacă profilul nu
     * există încă. Editarea reală (nume/descriere/logo/adresă/date
     * de contact) se face din /setari?tab=profile (SettingsPage.jsx,
     * tab "profile" -> ProfileTabBoarding).
     */
    { audience: "VENDOR", path: "/setari?tab=profile" },
    { audience: "VENDOR", path: "/setari?tab=billing" },
  ],

  capabilities: {
    createStoreProfile: { available: true },

    editStoreProfile: {
      available: true,
      notes:
        "Nume, descriere (tagline/about), logo, copertă, telefon, email, adresă, oraș, website - toate editabile din /setari?tab=profile (ProfileTabBoarding, PUT /api/vendors/vendor-services/:id/profile). Adresa introdusă aici e cea de PROFIL/publică - distinctă de adresa de retur (vezi shipping-awb) și de adresa de facturare (vezi billingData mai jos).",
    },

    manageServiceTypes: { available: true },

    vendorSelfRegistration: {
      available: true,
      audience: ["GUEST", "USER"],
    },

    /*
     * Gap 2026-09-04 (audit Setări Vendor) - date de facturare/CUI,
     * complet necunoscute anterior. Sursă verificată direct în cod:
     * billingRoutes.js (GET/PUT /api/vendors/me/billing).
     */
    billingData: {
      available: true,
      status: "ACTIVE",
      audience: ["VENDOR"],

      notes:
        "Editabil din /setari?tab=billing (BillingTab.jsx). Câmpuri reale: sellerType ('independent_creator' vs 'verified_business'), pentru business și: legalType (SRL/PFA/II/IF), companyName, cui, regCom, vatStatus; comune ambelor: address (adresă facturare), email, contactPerson, phone. La salvare cu CUI completat, sistemul verifică automat statusul TVA la ANAF (async, verifyCuiAtAnaf) - nu e nevoie de nicio acțiune suplimentară din partea vendorului pentru asta.",
    },

    /*
     * Feature 2026-09-04 (audit + implementare "Pauză magazin") -
     * REVERSIBIL, distinct total de accountDeletion de mai jos.
     * Reutilizează mecanismul EXISTENT (POST /api/vendors/me/
     * services/:id/deactivate și /activate, deja folosit din
     * Desktop.jsx) - surfacat acum și din /setari?tab=profile
     * (secțiunea "Disponibilitatea magazinului"). NU șterge nimic,
     * NU anonimizează nimic, NU afectează contul/parola/email-ul.
     */
    storeAvailabilityPause: {
      available: true,
      status: "ACTIVE",
      audience: ["VENDOR"],

      notes:
        "Din /setari?tab=profile, secțiunea „Disponibilitatea magazinului”: butonul „Pune magazinul pe pauză” dezactivează serviciul de tip 'products' (VendorService.isActive=false, status='INACTIVE') - magazinul (/magazin/:slug) devine indisponibil public (404) și produsele lui dispar din search/homepage (confirmat direct în publicStoreRoutes.js și publicProductRoutes.js, care filtrează după service.isActive/status). NU afectează: comenzile existente (rămân accesibile și administrabile), mesajele (rămân accesibile), Stripe Connect (rămâne conectat), datele de profil/facturare (rămân neatinse). Butonul „Reactivează magazinul” inversează exact starea (isActive=true, status='ACTIVE') - fără re-onboarding, fără pierdere de produse.",
    },

    /*
     * Ștergerea definitivă - mecanism EXISTENT, NEATINS de fix-ul de
     * mai sus. IREVERSIBIL - a nu se confunda cu storeAvailabilityPause.
     */
    accountDeletion: {
      available: true,
      status: "ACTIVE",
      audience: ["VENDOR"],

      notes:
        "Din /setari?tab=danger, butonul „Șterge contul definitiv” (vendorSettingRoutes.js: POST /api/vendor/settings/account/deactivate/request, confirmat prin email, apoi /confirm). IREVERSIBIL: anonimizează datele personale și ale magazinului, blochează contul (user.status=DELETED, emailul e suprascris, parola devine inutilizabilă), dezactivează toate serviciile și ascunde toate produsele. Nu există cale de reactivare după finalizare. Complet diferit de storeAvailabilityPause de mai sus, care e reversibil oricând.",
    },

    /*
     * Regulă de business (nu regulă fiscală/juridică verificată -
     * nicio sursă legală confirmată în cod) - vezi FAQ pentru
     * formularea exactă cerută. Confirmat determinist ca opțiune
     * reală de cont ("sellerType") din billingRoutes.js/
     * BillingTab.jsx: "independent_creator" (🌱 Creator Independent
     * - "Nu am încă PFA/SRL și vreau să testez vânzarea pe
     * platformă") vs "verified_business" (✓ Business Verificat -
     * "Am PFA, SRL, II sau IF"). NU am găsit, în cod, nicio
     * verificare/blocare AUTOMATĂ a pragului de 10.000 lei/an -
     * e o regulă de politică Artfest, aplicată administrativ, nu
     * un mecanism tehnic care oprește automat vânzarea.
     */
    sellFromIndividualAccount: {
      available: true,
      status: "ACTIVE",
      audience: ["GUEST", "USER", "VENDOR"],
    },
  },

  limitations: [
    "Un creator poate începe să vândă pe Artfest fără formă juridică (cont „Creator Independent”) - este o variantă pentru început, nu regula finală.",
    "Dacă vânzările depășesc 10.000 lei într-un an, regula Artfest (nu lege fiscală confirmată în acest sistem) cere trecerea la un cont de vânzător cu formă juridică („Business Verificat” - PFA, SRL, II sau IF), pentru a continua să vândă pe platformă.",
    "Nu există, în cod, o verificare/blocare automată a acestui prag - aplicarea regulii e administrativă, nu tehnică.",
  ],
  flows: [],
  integrations: {},

  endpoints: {
    vendorProfile: {
      method: "GET",
      path: "/api/vendors/me",
      purpose: "Returnează profilul vendorului autentificat.",
      audience: ["VENDOR"],
    },

    updateStoreProfile: {
      method: "PUT",
      path: "/api/vendors/vendor-services/:id/profile",
      purpose: "Actualizează nume, descriere, logo, copertă, telefon, email, adresă, oraș, website ale magazinului.",
      audience: ["VENDOR"],
    },

    getBilling: {
      method: "GET",
      path: "/api/vendors/me/billing",
      purpose: "Returnează datele de facturare curente ale vendorului.",
      audience: ["VENDOR"],
    },

    updateBilling: {
      method: "PUT",
      path: "/api/vendors/me/billing",
      purpose: "Actualizează datele de facturare (tip vânzător, CUI, denumire firmă, adresă facturare, contact).",
      audience: ["VENDOR"],
    },

    pauseStore: {
      method: "POST",
      path: "/api/vendors/me/services/:id/deactivate",
      purpose: "Pune magazinul pe pauză - reversibil, nu afectează comenzi/mesaje/Stripe.",
      audience: ["VENDOR"],
    },

    reactivateStore: {
      method: "POST",
      path: "/api/vendors/me/services/:id/activate",
      purpose: "Reactivează magazinul pus pe pauză.",
      audience: ["VENDOR"],
    },

    deleteAccountRequest: {
      method: "POST",
      path: "/api/vendor/settings/account/deactivate/request",
      purpose: "Cere ștergerea definitivă a contului (ireversibil) - trimite email de confirmare.",
      audience: ["VENDOR"],
    },
  },

  faq: [
    {
      q: "Cum îmi creez magazinul?",
      a: "Prin pașii de onboarding de la prima conectare ca vânzător - completezi datele magazinului și tipul de servicii pe care le oferi.",
    },
    {
      q: "Cum îmi editez profilul de vânzător?",
      a: "Din Setări → Profil magazin (/setari?tab=profile) poți edita oricând datele publice ale magazinului - nume, descriere, logo, copertă, telefon, email, adresă și website.",
    },
    {
      q: "Cum schimb numele magazinului?",
      a: "Din Setări → Profil magazin (/setari?tab=profile) - câmpul cu numele magazinului poate fi editat direct de acolo, salvarea se face automat.",
    },
    {
      q: "Cum schimb descrierea magazinului?",
      a: "Din Setări → Profil magazin (/setari?tab=profile) - ai câmpuri separate pentru descrierea scurtă (tagline) și cea completă (about), ambele editabile direct de acolo.",
    },
    {
      q: "Cum schimb adresa magazinului?",
      a: "Din Setări → Profil magazin (/setari?tab=profile) poți edita adresa publică a magazinului. Atenție: este diferită de adresa de facturare (Setări → Date facturare) și de adresa folosită pentru retururi (Setări → Livrare și retururi) - fiecare se editează separat.",
    },
    {
      q: "Cum schimb logo-ul magazinului?",
      a: "Din Setări → Profil magazin (/setari?tab=profile) poți încărca o imagine nouă pentru logo (și separat, pentru imaginea de copertă).",
    },
    {
      q: "Cum schimb datele de contact ale magazinului?",
      a: "Din Setări → Profil magazin (/setari?tab=profile) poți edita telefonul și emailul publice ale magazinului. Sunt diferite de emailul contului tău de autentificare (pentru acela, vezi secțiunea Securitate din setări).",
    },
    {
      q: "Cum schimb datele de facturare?",
      a: "Din Setări → Date facturare (/setari?tab=billing) poți edita toate datele de facturare: tipul de vânzător (persoană fizică sau firmă), denumirea, CUI-ul, numărul de înregistrare, adresa de facturare și datele de contact pentru facturare.",
    },
    {
      q: "Unde completez CUI-ul?",
      a: "Din Setări → Date facturare (/setari?tab=billing), după ce alegi tipul de vânzător „Business Verificat” (SRL, PFA, II sau IF) - apare câmpul pentru CUI. La salvare, sistemul verifică automat statusul TVA la ANAF.",
    },
    {
      q: "Cum schimb adresa de facturare?",
      a: "Din Setări → Date facturare (/setari?tab=billing) - este un câmp separat de adresa publică a magazinului sau de adresa de retur, editabil direct de acolo.",
    },
    {
      q: "Pot vinde ca persoană fizică sau trebuie firmă?",
      a: "Poți vinde ca persoană fizică, alegând tipul de cont „Creator Independent” din Setări → Date facturare - nu ai nevoie de CUI sau firmă pentru asta. Dacă ai deja PFA, SRL, II sau IF, alegi „Business Verificat” și completezi CUI-ul, care e verificat automat la ANAF.",
    },
    {
      q: "Cum adaug un serviciu nou?",
      a: "Din profilul magazinului, poți adăuga tipuri noi de servicii pe care le oferi clienților.",
    },
    {
      q: "Cum devin vânzător pe Artfest?",
      a: "Te înregistrezi folosind opțiunea „Devino partener” (din pagina principală sau din meniul de autentificare), bifând că vrei cont de vânzător. După înregistrare, magazinul tău e creat, dar inactiv, până completezi pașii de onboarding - datele magazinului și tipurile de servicii pe care le oferi.",
    },
    {
      q: "Trebuie să am firmă ca să vând pe Artfest?",
      a: "Nu, poți începe să vinzi și fără formă juridică, ca „Creator Independent” - e o variantă pentru început. Este o regulă Artfest, nu o lege fiscală: dacă vânzările tale depășesc 10.000 lei într-un an, pentru a continua să vinzi pe platformă trebuie să treci la un cont „Business Verificat”, cu PFA, SRL, II sau IF.",
    },
    {
      q: "Pot vinde fără SRL/PFA?",
      a: "Da, la început poți vinde fără formă juridică, alegând tipul de cont „Creator Independent” la înregistrare. Dacă vânzările depășesc 10.000 lei într-un an, regula Artfest cere trecerea la un cont cu formă juridică pentru a continua să vinzi.",
    },
    {
      q: "Pot începe să vând ca persoană fizică?",
      a: "Da - opțiunea „Creator Independent” e făcută exact pentru asta, ca să poți testa vânzarea pe platformă fără să ai încă PFA sau SRL.",
    },
    {
      q: "Ce se întâmplă dacă depășesc 10.000 lei în vânzări?",
      a: "Conform regulii Artfest (nu e o afirmație de lege fiscală), dacă depășești 10.000 lei în vânzări într-un an ca „Creator Independent”, pentru a continua să vinzi pe platformă trebuie să treci la un cont „Business Verificat”, cu formă juridică (PFA, SRL, II sau IF). Nu am găsit o blocare automată a contului la depășirea pragului - regula se aplică administrativ.",
    },
    {
      q: "Când trebuie să îmi fac firmă?",
      a: "Când vânzările tale pe Artfest, ca „Creator Independent”, depășesc 10.000 lei într-un an - regulă Artfest, nu obligație fiscală confirmată aici. Până atunci poți vinde fără formă juridică.",
    },
    {
      q: "Cum pun magazinul pe pauză?",
      a: "Din Setări → Profil magazin (/setari?tab=profile), secțiunea „Disponibilitatea magazinului” - butonul „Pune magazinul pe pauză”. Magazinul și produsele tale nu vor mai fi vizibile public, dar poți continua să îți administrezi comenzile și mesajele, iar Stripe rămâne conectat. Este complet reversibil - îl poți reactiva oricând, fără să pierzi nimic.",
    },
    {
      q: "Cum reactivez magazinul?",
      a: "Din Setări → Profil magazin (/setari?tab=profile), secțiunea „Disponibilitatea magazinului” - butonul „Reactivează magazinul”, vizibil când magazinul e pe pauză. Magazinul redevine vizibil public imediat, fără re-onboarding și fără pierdere de produse.",
    },
    {
      q: "Cum șterg definitiv contul?",
      a: "Din Setări → Ștergere cont (/setari?tab=danger), butonul „Șterge contul definitiv”. Atenție: este o acțiune IREVERSIBILĂ, diferită de „Pune magazinul pe pauză” - datele personale și ale magazinului sunt anonimizate, contul e blocat definitiv și nu poate fi reactivat. Dacă vrei doar să ascunzi temporar magazinul, folosește „Pune magazinul pe pauză” în loc de asta.",
    },

    /*
     * FINAL BATCH 3 (audit regression, 2026-09-07) - completate STRICT
     * pe fapte deja confirmate în capabilities-urile de mai sus
     * (storeAvailabilityPause/accountDeletion) - nu conținut nou,
     * doar formulările exacte care rateau retrieval-ul înainte de
     * fix-ul sistemic din Batch 1 (faq[].q indexat).
     */
    {
      q: "Pot modifica numele magazinului după ce l-am creat?",
      a: "Da - numele magazinului nu e fixat la creare, îl poți schimba oricând din Setări → Profil magazin (/setari?tab=profile).",
    },
    {
      q: "Pot avea mai multe magazine?",
      a: "Poți avea mai multe SERVICII/magazine asociate contului tău de vânzător - catalogul tău de produse (/vendor/catalog) le afișează pe toate laolaltă, din toate magazinele tale.",
    },
    {
      q: "Cum văd magazinul așa cum îl vede clientul?",
      a: "Accesează pagina publică a magazinului tău (/magazin/:slug) - e exact ce vede orice vizitator, fără datele private (facturare, cont).",
    },
    {
      q: "Unde modific informațiile magazinului?",
      a: "Din Setări → Profil magazin (/setari?tab=profile) editezi datele publice (nume, descriere, logo, copertă, telefon, email, adresă, website). Datele de facturare sunt separat, în Setări → Date facturare, iar cele de retur în Setări → Livrare și retururi.",
    },
    {
      q: "Unde sunt setările magazinului?",
      a: "În /setari, împărțite pe tab-uri: Profil magazin (date publice), Date facturare, Livrare și retururi, Notificări/Marketing, Securitate, Încasări (Stripe) și Ștergere cont.",
    },
    {
      q: "Care este numărul de telefon al vânzătorului?",
      a: "VERIFICAT direct în cod (audit Guest, 2026-09-08): telefonul și emailul de contact ale magazinului SUNT publice, dacă vânzătorul le-a completat - vizibile pe pagina publică a magazinului (/magazin/:slug), pentru orice vizitator, fără cont. Nu există un număr „privat” separat, ascuns - dacă vânzătorul nu le-a completat, pur și simplu nu apar.",
    },
    {
      q: "Pot vedea emailul de contact al vânzătorului?",
      a: "Da, dacă vânzătorul l-a completat - emailul de contact al magazinului e public, pe pagina magazinului (/magazin/:slug), vizibil oricărui vizitator. Diferit de emailul contului lui de autentificare, care nu e niciodată public.",
    },
    {
      q: "Mai pot vedea comenzile dacă magazinul e pe pauză?",
      a: "Da - punerea magazinului pe pauză NU afectează comenzile existente, rămân accesibile și administrabile normal. Doar magazinul și produsele devin invizibile public pentru clienți noi.",
    },
    {
      q: "Mai pot răspunde la mesaje dacă magazinul e pe pauză?",
      a: "Da - mesajele rămân complet accesibile cât timp magazinul e pe pauză, la fel ca înainte. Pauza afectează STRICT vizibilitatea publică a magazinului și produselor, nu mesageria.",
    },
    {
      q: "Stripe rămâne conectat dacă pun magazinul pe pauză?",
      a: "Da - Stripe Connect rămâne conectat exact cum era. Pauza dezactivează doar vizibilitatea publică a magazinului/produselor, nu afectează contul Stripe, comenzile sau mesajele.",
    },
    {
      q: "Produsele reapar după ce reactivez magazinul?",
      a: "Da, imediat și fără pierdere - reactivarea magazinului îl face din nou vizibil public, exact cu produsele care erau active înainte de pauză, fără re-onboarding.",
    },
    {
      q: "Ce se întâmplă dacă șterg contul?",
      a: "Este o acțiune IREVERSIBILĂ: datele personale și ale magazinului sunt anonimizate, contul e blocat definitiv (emailul e suprascris, parola devine inutilizabilă), toate serviciile sunt dezactivate și toate produsele ascunse. Nu există cale de reactivare după finalizare - dacă vrei ceva reversibil, folosește „Pune magazinul pe pauză” în loc.",
    },
    {
      q: "Pot recupera contul după ștergere?",
      a: "Nu - ștergerea definitivă a contului este ireversibilă. Nu există o cale de reactivare după ce procesul s-a finalizat. Dacă vrei o soluție temporară/reversibilă, foloseș „Pune magazinul pe pauză” în loc de ștergere.",
    },
    {
      q: "Ștergerea contului este reversibilă?",
      a: "Nu - este ireversibilă. Datele personale și ale magazinului sunt anonimizate, contul e blocat definitiv, iar reactivarea nu este posibilă. Diferă total de „Pune magazinul pe pauză”, care e complet reversibil.",
    },
    {
      q: "Ce date se păstrează după ștergerea contului?",
      a: "Datele personale și ale magazinului sunt anonimizate la ștergerea definitivă (emailul e suprascris, parola devine inutilizabilă) - contul e blocat, toate serviciile dezactivate și toate produsele ascunse. Nu am detalii mai fine, în cod, despre ce anume rămâne păstrat, la nivel de bază de date, în scop de evidență/audit intern, față de ce se anonimizează complet.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: vendorRoutes.js, vendorStoreRoutes.js, vendorSettingRoutes.js, serviceTypesRoutes.js. Înregistrare vânzător: HeroSection.jsx (link /?auth=register&as=partner), Navbar.jsx (deschide modal Register defaultAsVendor), Register.jsx (câmp asVendor trimis la înregistrare), authRoutes.js (creează Vendor cu isActive:false la asVendor:true). Formă juridică/sellerType: vendorRoutes.js (ALLOWED_SELLER_TYPES=[independent_creator, verified_business]), billingRoutes.js (validare câmpuri per tip), BillingTab.jsx (copy real: 'Creator Independent'/'Business Verificat'). Pragul de 10.000 lei/an e regulă de business primită direct de la echipa Artfest - NU am găsit nicio sursă juridică sau blocare tehnică automată în cod pentru acest prag. Verificat 2026-08-25. FIX 2026-09-04 (audit Setări Vendor): adăugate aliases explicite pentru nume/descriere/adresă/logo/date de contact ale magazinului (retrieval rata acest manifest pentru aceste formulări, ajungea la platform-overview/catalog-imports/auth-account cu confidence 1 pe manifestul greșit) + capability billingData și FAQ pentru facturare/CUI (necunoscute anterior) - sursă verificată direct în cod: SettingsPage.jsx (tab='profile' -> EmbeddedOnboarding -> ProfileTabBoarding; tab='billing' -> BillingTab), billingRoutes.js (GET/PUT /api/vendors/me/billing, verifyCuiAtAnaf async la salvare cu CUI completat). CORECȚIE: uiLocations avea /vendor/store listat ca loc de editare - greșit, StoreRedirect.jsx doar redirecționează la pagina publică (/magazin/:slug) sau la /onboarding; editarea reală e la /setari?tab=profile. IMPLEMENTARE 2026-09-04 (Pauză magazin): adăugate capabilities storeAvailabilityPause/accountDeletion + 3 FAQ noi + aliases, reutilizând STRICT mecanismul existent activate/deactivate per VendorService (vendorRoutes.js: POST /api/vendors/me/services/:id/activate|deactivate, deja folosit din Desktop.jsx) - surfacat acum și din Settings.jsx (secțiune nouă 'Disponibilitatea magazinului', tab 'profile'). Niciun endpoint nou, nicio schimbare Prisma. Verificat direct în cod că pauza (service.isActive=false) e suficientă să ascundă magazinul public (publicStoreRoutes.js: GET /api/public/store/:slug cere service.isActive && status==='ACTIVE' && vendor.isActive) și produsele din search (publicProductRoutes.js: baseWhere cere service.isActive && status==='ACTIVE') - fără să atingă vendor.isActive sau produsele individual. Ștergerea definitivă (accountDeletion) rămâne EXACT mecanismul deja documentat mai sus (vendorSettingRoutes.js) - doar wording-ul din UI a fost schimbat, nu logica.",
};
