// backend/src/ai/manifests/products.manifest.js

export const PRODUCTS_MANIFEST = {
  id: "products",

  title: "Administrare produs individual",

  /*
   * BUGFIX (audit): manifestul avea audience doar VENDOR/ADMIN, deși
   * conține și concepte relevante pentru CLIENȚI (variante,
   * personalizare, diferența cumpără-direct vs cere-ofertă) - un
   * client (USER/GUEST) care întreabă "Cum funcționează produsele
   * personalizabile?" primea "nu am informații", pentru că
   * manifestul era complet invizibil pentru audience-ul lui în
   * retrieval (filtrare hard pe audience, vezi knowledgeRetrieval.js).
   * Adăugat USER/GUEST - promptul de generare a răspunsului
   * primește oricum audience-ul curent și adaptează tonul/conținutul
   * (nu arată capabilities/endpoints VENDOR unui client).
   */
  audience: ["VENDOR", "ADMIN", "USER", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Crearea, editarea și publicarea unui produs: titlu, descriere, preț, imagini, categorie, disponibilitate, stoc, mod de comandă (cumpărare directă / opțiuni-personalizare / cerere ofertă), variante și câmpuri de personalizare completate de client. Poate fi făcută și conversațional, prin Vendor Assistant (schimbă prețul, stocul, descrierea, disponibilitatea, ascunde/arată produsul etc.).",

  tags: [
    "produs",
    "pret",
    "stoc",
    "descriere",
    "categorie",
    "disponibilitate",
    "ascunde produs",
    "personalizare",
    "optiuni produs",
    "variante produs",
    "culori produs",
    "marimi produs",
    "cerere oferta",
    "cumparare directa",
    "lead time",
    "timp de realizare",
  ],

  aliases: [
    "cum adaug un produs",
    "cum schimb pretul unui produs",
    "cum schimb stocul",
    "cum modific descrierea produsului",
    "cum ascund un produs",
    "cum activez un produs",
    "personalizare produs",
    "cum functioneaza variantele de produs",
    "pot avea culori diferite la acelasi produs",
    "cum cer clientului text pentru personalizare",
    "cum functioneaza produsele personalizabile",
    "diferenta dintre cumpara direct si cere oferta",
    "cum functioneaza timpul de realizare",
    "ce inseamna produs doar la cerere de oferta",
    "ce inseamna produs quote only",
    "ma poti ajuta sa adaug un produs cu variante",
    "vreau sa adaug un produs cu variante",
    "cum adaug un produs cu variante",
    "cum listez un produs nou",
    "diferenta dintre varianta si personalizare",
    "ce inseamna varianta la un produs",
    "pot cere clientului sa incarce o fotografie",
    "cum cer clientului o poza pentru personalizare",
    "clientul poate atasa imagine la comanda",
    "cum primesc poza clientului",
    "ce se intampla daca uit sa completez o varianta obligatorie",
    "camp obligatoriu la produs",
    "adauga in cos este blocat",
    "ce mesaj vede clientul daca nu completeaza o varianta",
    "cum aflu daca produsul este disponibil",
    "produsul e pe stoc",
    "produsul e epuizat",
    "ce inseamna produs la comanda",
    "ce inseamna made to order",
    "ce se intampla daca produsul e realizat la comanda",
    "trebuie sa fiu logat ca sa vad daca e la comanda",
    "pot modifica personalizarea dupa ce adaug in cos",
    "pot schimba optiunile din cos",
    "editez personalizarea din cos",
    "am gresit personalizarea in cos",
    "ce fac daca produsul nu are optiunea de personalizare",
    "produsul nu se poate personaliza",
    "produsul nu are varianta pe care o vreau",
    "nu gasesc culoarea pe care o vreau la produs",
    "pot cere produsul in alta culoare sau marime",
    "pot intreba vanzatorul daca poate face alta varianta",
    "vanzatorul poate face produsul altfel decat in poza",
    "produs pentru mai multe persoane",
    "set personalizat pentru mai multi invitati",
    "trebuie cont ca sa completez personalizarea",
    "produs doar la cerere de oferta necesita cont",
  ],

  uiLocations: [
    { audience: "VENDOR", path: "/produse" },
    { audience: "VENDOR", path: "/produs/:id" },
  ],

  capabilities: {
    createProduct: { available: true },
    editProduct: { available: true },
    conversationalEdit: {
      available: true,
      notes:
        "Prin Vendor Assistant: preț, stoc, descriere, disponibilitate, vizibilitate, categorie, material, tehnică, dimensiuni etc.",
    },

    directPurchaseMode: {
      available: true,
      notes: "Clientul cumpără direct, fără pași suplimentari.",
    },

    optionsPersonalizationMode: {
      available: true,

      notes:
        "Variante selectabile (culoare/mărime/material etc.) și/sau câmpuri completate de client (nume, mesaj, poză, instrucțiuni) - configurate din editarea produsului, nu conversațional.",
    },

    quoteOnlyMode: {
      available: true,

      notes:
        "Clientul completează un formular și cere o ofertă personalizată, în loc să cumpere direct - vezi manifestul quotes pentru fluxul de ofertă.",
    },

    archiveProduct: { available: false },
  },

  limitations: [
    "Configurarea variantelor/câmpurilor de personalizare (optionsSchema/customSchema) se face din editarea produsului, nu conversațional prin Vendor Assistant.",
    "Nu există un status distinct de 'arhivat' - un produs poate fi doar dezactivat (isActive) sau ascuns (isHidden), nu arhivat separat.",
  ],

  flows: [
    {
      name: "Cele 3 moduri de comandă ale unui produs",
      steps: [
        "Cumpărare directă - clientul adaugă în coș și cumpără fără pași suplimentari.",
        "Opțiuni/personalizare - clientul alege variante (ex. culoare, mărime) și/sau completează câmpuri (nume, mesaj, poză, instrucțiuni) înainte de a cumpăra.",
        "Cerere ofertă - clientul NU cumpără direct, completează un formular și vendorul trimite o ofertă personalizată (preț, termen) pe care clientul o poate accepta.",
      ],
    },
  ],

  integrations: {},

  endpoints: {
    updateOwnProduct: {
      method: "PUT",
      path: "/api/vendors/products/:id",
      purpose: "Actualizează un produs al vendorului autentificat.",
      audience: ["VENDOR"],
    },
  },

  faq: [
    {
      q: "Cum schimb prețul unui produs?",
      a: "Poți edita produsul din pagina lui de administrare, sau poți spune direct asistentului vendor, de exemplu „Schimbă prețul produsului X la 50 lei” - îți va arăta o confirmare înainte să salveze.",
    },

    {
      q: "Cum funcționează variantele de produs?",
      a: "Când setezi modul de comandă al produsului la „Opțiuni”, poți defini variante pe care clientul le alege înainte de cumpărare (de exemplu culoare, mărime, material) - se configurează din editarea produsului.",
    },

    {
      q: "Pot avea culori diferite la același produs?",
      a: "Da - setezi produsul pe modul „Opțiuni” și adaugi culoarea ca variantă selectabilă; clientul alege varianta dorită înainte de a cumpăra.",
    },

    {
      q: "Cum cer clientului text pentru personalizare?",
      a: "Tot pe modul „Opțiuni”, poți adăuga câmpuri completate de client - nume, mesaj, instrucțiuni sau chiar o poză - pe care le vezi în comandă.",
    },

    {
      q: "Care e diferența dintre cumpără direct și cere ofertă?",
      a: "„Cumpărare directă” înseamnă că produsul are un preț fix și clientul cumpără imediat. „Cerere ofertă” înseamnă că nu există un preț fix afișat - clientul completează un formular cu ce își dorește, iar tu trimiți înapoi o ofertă personalizată pe care o poate accepta.",
    },

    {
      q: "Cum funcționează timpul de realizare (lead time)?",
      a: "Pentru produsele care nu sunt gata imediat (\"la comandă\"/\"precomandă\"), poți seta un timp de realizare estimat, afișat clientului înainte de a cumpăra.",
    },

    {
      q: "Care e diferența dintre variantă și personalizare?",
      a: "Variantă = clientul ALEGE dintre opțiuni pe care le-ai definit tu, de exemplu Culoare: Alb/Roz/Verde sau Mărime: S/M/L - un simplu selector, fără text liber. Personalizare = clientul INTRODUCE informația proprie - nume, dată, mesaj, instrucțiuni sau chiar o fotografie. Ambele se configurează la editarea produsului, pe modul de comandă „Opțiuni” (câmpurile de variantă și cele de personalizare pot coexista pe același produs).",
    },

    {
      q: "Pot cere clientului să încarce o fotografie pentru personalizare?",
      a: "Da. La editarea produsului, pe modul „Opțiuni”, poți adăuga un câmp de personalizare de tip „Poză” (preset gata pregătit, cheie 'poza'). Clientul vede pe pagina produsului, înainte de a adăuga în coș, un buton real de încărcare imagine - fișierul se urcă imediat, iar tu vezi link-ul poza încărcate direct în detaliile comenzii, alături de celelalte răspunsuri de personalizare ale clientului.",
    },

    {
      q: "Ce se întâmplă dacă clientul uită să completeze o variantă sau un câmp obligatoriu?",
      a: "„Adaugă în coș” este blocat automat - clientul primește un mesaj clar sub câmpul respectiv („Alege {opțiune}.” pentru o variantă, „Completează {câmp}.” pentru personalizare), câmpul se marchează vizual cu eroare, iar pagina derulează automat până la primul câmp incomplet. Doar câmpurile marcate explicit „obligatoriu” la configurare blochează trimiterea - cele opționale pot rămâne necompletate.",
    },
    {
      q: "Cum aflu dacă un produs este disponibil?",
      a: "Fiecare produs are un status de disponibilitate afișat pe pagina lui: „gata de livrare” (are stoc pregătit), „la comandă” sau „precomandă” (se realizează după ce comanzi, de obicei cu un timp de realizare estimat afișat), sau „epuizat” (nu poate fi comandat momentan). Nu trebuie să fii autentificat ca să vezi această informație.",
    },
    {
      q: "Ce se întâmplă dacă produsul este realizat la comandă?",
      a: "Vânzătorul îl realizează după ce plasezi comanda, în intervalul de timp estimat (timpul de realizare/lead time), afișat pe pagina produsului înainte să cumperi - apoi este expediat, la fel ca un produs gata pregătit. Nu ai nevoie de cont doar ca să afli asta - autentificarea se cere abia când chiar plasezi comanda.",
    },
    {
      q: "Pot modifica personalizarea după ce adaug produsul în coș?",
      a: "Nu direct din coș - poți doar schimba cantitatea sau elimina produsul. Dacă vrei altă variantă/personalizare, elimini produsul din coș și revii pe pagina lui ca să-l adaugi din nou cu noile opțiuni.",
    },
    {
      q: "Ce fac dacă produsul nu are opțiunea de personalizare pe care o vreau (altă culoare/mărime/configurație)?",
      a: "Dacă produsul nu are varianta dorită printre opțiunile deja definite de vânzător, poți să-l întrebi direct dacă poate fi realizat în altă culoare, mărime sau configurație, sau poți cere o ofertă personalizată pentru exact ce îți dorești - vânzătorul îți poate confirma dacă e posibil și la ce preț/termen.",
    },
    {
      q: "Cum funcționează un produs personalizat pentru mai multe persoane (ex. mărturii pentru toți invitații)?",
      a: "Unele produse au grupuri repetate de personalizare - completezi câte persoane/seturi ai nevoie, apoi răspunzi la câmpurile de personalizare pentru fiecare în parte (ex. numele fiecărui invitat). Se configurează la aceeași etapă ca restul personalizării, înainte de a adăuga în coș.",
    },
    {
      q: "Trebuie cont ca să completez opțiunile de personalizare ale unui produs?",
      a: "Nu - poți vedea și completa toate opțiunile/câmpurile de personalizare fără cont. Contul devine necesar abia dacă produsul e „doar la cerere de ofertă” (nu are preț fix) - în acel caz, trimiterea cererii de ofertă chiar cere autentificare.",
    },
  ],

  unavailableFeatures: [
    "Status distinct de 'arhivat' pentru un produs (doar dezactivare/ascundere).",
    "Configurarea variantelor/personalizării prin Vendor Assistant conversațional.",
  ],

  notes:
    "Sursă: vendorProductRoutes.js (normalizeOrderModePayload/normalizeOrderConfiguration - enumul REAL are doar DIRECT/OPTIONS/QUOTE_ONLY; 'READY_TO_BUY' și 'CUSTOMIZABLE' sunt doar etichete UI acceptate ca sinonime pentru DIRECT/OPTIONS, nu valori separate), schema.prisma (ProductOrderMode, ProductAvailability, câmpurile optionsSchema/customSchema/repeatedGroups/quoteSchema), vendorAssistantCommandsRoutes.js/vendorAssistantCommandService.js (editare conversațională). Corectat 2026-08-25: audience-ul endpoint-ului updateOwnProduct era greșit (ADMIN în loc de VENDOR); archiveProduct nu există ca status real. Adăugat 2026-08-26, verificat direct din cod: upload poză la personalizare (ProductOrderModeSection.jsx CUSTOM_FIELDS preset 'poza'/type:'file'; ProductDetails.jsx randează <input type=\"file\" accept=\"image/*\"> pentru câmpuri image/photo/file, upload real prin uploadCustomizationFile) - funcțional, nu limitare parțială. Validare câmp obligatoriu: ProductDetails.jsx, funcția onAddToCart - blochează efectiv trimiterea (return devreme) dacă lipsește o variantă/personalizare marcată required, afișează mesaj per câmp și scroll la primul invalid. Extins 2026-08-28 (audit GUEST): enum ProductAvailability confirmat în schema.prisma (READY | MADE_TO_ORDER | PREORDER | SOLD_OUT, + leadTimeDays/readyQty/nextShipDate) pentru FAQ de disponibilitate; editarea personalizării din coș verificată în Cart.jsx - handlerele existente (commitQty/removeFromGuestCart etc., cheie `productId:configurationKey`) ating doar cantitatea și ștergerea, fără niciun handler care modifică selectedOptions/customAnswers după adăugare - singurul link din rândul de coș duce către /produs/:id, nu spre un editor inline. Extins din nou 2026-08-28: ProductDetails.jsx confirmă `onRequestQuote` (produs QUOTE_ONLY) - `if (!me) navigate('/autentificare?redirect=...')` - un guest nu poate trimite o cerere de ofertă fără cont, dar poate configura complet formularul de personalizare/opțiuni fără restricție (nicio verificare `me` pe randarea/completarea câmpurilor în sine, doar la trimitere).",
};
