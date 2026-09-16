// backend/src/ai/manifests/reviews.manifest.js

export const REVIEWS_MANIFEST = {
  id: "reviews",

  title: "Recenzii și comentarii",

  /*
   * BUGFIX (audit GUEST, 2026-08-28): audience-ul controlează CINE
   * poate LĂSA o recenzie (necesită cont) - dar CITIREA recenziilor
   * e publică, verificat direct în cod (reviewsProductRoutes.js,
   * router.get("/public/product/:id/reviews", ...) NU are
   * authRequired). GUEST adăugat DOAR la knowledgeAudience, ca un
   * vizitator care întreabă "pot vedea recenziile?" să primească
   * răspunsul corect (da, poți citi, dar ai nevoie de cont ca să
   * lași una), nu "nu am informații".
   */
  audience: ["USER", "VENDOR"],
  knowledgeAudience: ["USER", "VENDOR", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Recenzii pentru produse și magazine, plus comentarii pe produse. Citirea recenziilor e publică (nu necesită cont) - a LĂSA o recenzie necesită cont autentificat.",

  tags: [
    "recenzie",
    "review",
    "comentariu",
    "evaluare",
    "recenzii publice",
    "rating produs",
  ],

  aliases: [
    "cum las o recenzie",
    "cum raspund la o recenzie",
    "cum raportez o recenzie",
    "pot vedea recenziile fara cont",
    "recenziile sunt publice",
    "trebuie cont ca sa citesc recenzii",
    "trebuie sa cumpar ca sa las recenzie",
    "recenzie verificata ce inseamna",

    /*
     * BATCH E (audit regression, 2026-09-07).
     */
    "pot sterge o recenzie",
    "cum sterg o recenzie",
    "unde vad recenziile primite",
    "unde vad recenziile magazinului",
    "cum se calculeaza ratingul",
    "ce inseamna ratingul meu",
    "cate recenzii am",
    "care este ratingul meu",
    "ratingul magazinului meu",
  ],

  uiLocations: [
    { audience: "USER", path: "nested în pagina de produs / cont" },
    { audience: "VENDOR", path: "nested în /vendor/catalog" },
  ],

  capabilities: {
    productReviews: { available: true },
    storeReviews: { available: true },
    vendorReplyToReview: { available: true },
    reportReview: { available: true },

    publicReadAccess: {
      available: true,
      audience: ["GUEST"],

      notes:
        "Oricine poate citi recenziile unui produs/magazin, fără cont - endpoint-urile publice de citire nu cer autentificare.",
    },

    verifiedPurchaseBadge: {
      available: true,

      notes:
        "O recenzie primește automat un badge de 'verificat' dacă userul a avut o comandă PLĂTITĂ/FINALIZATĂ cu acel produs - dar cumpărarea produsului NU e o condiție obligatorie pentru a lăsa o recenzie, doar pentru badge.",
    },

    /*
     * BATCH E (audit regression, 2026-09-07) - STALE_KNOWLEDGE
     * corectat: manifestul nu menționa deloc ștergerea, deși există.
     */
    deleteReview: {
      available: true,
      notes:
        "Poți șterge o recenzie/comentariu propriu (pe produs sau magazin) - DELETE /api/reviews/:id sau /api/store-reviews/:id, doar dacă ești autorul ei.",
    },

    /*
     * ADĂUGAT (audit USER Batch 1, 2026-09-08) - confirmat direct în
     * cod: POST /api/reviews (reviewsProductRoutes.js ~L315-380) - dacă
     * există deja o recenzie a acestui user pentru acest produs
     * (verificat prin @@unique([productId, userId])), request-ul o
     * EDITEAZĂ pe cea existentă (rating+comentariu+verified
     * recalculat), nu creează una nouă. Nu există endpoint PATCH
     * separat - se reutilizează același POST.
     */
    editReview: {
      available: true,
      notes:
        "Poți modifica propria recenzie (rating și comentariu) refăcând același pas ca la creare (POST /api/reviews cu același productId) - sistemul detectează recenzia existentă și o actualizează, nu crează una nouă.",
    },

    /*
     * ADĂUGAT (audit USER Batch 1, 2026-09-08) - confirmat prin
     * @@unique([productId, userId]) pe modelul Review (schema.prisma).
     */
    oneReviewPerProduct: {
      available: false,
      notes:
        "Un user poate avea STRICT o singură recenzie per produs (constrângere unică în baza de date) - a doua „trimitere” editează recenzia existentă, nu creează una nouă.",
    },

    ratingCalculation: {
      available: true,
      notes:
        "Rating-ul magazinului e o medie ponderată, pre-calculată și ținută la zi (StoreRatingStats), nu o medie recalculată live la fiecare cerere. Rating-ul unui produs are propriul calcul similar (ProductRatingStats), separat.",
    },
  },

  limitations: [
    "Nu poți recenzia propriul produs (dacă ești vânzătorul lui).",
    "Limită de maximum 10 recenzii/24h per cont, ca protecție anti-spam.",
  ],

  flows: [],
  integrations: {},

  endpoints: {
    productReviewsPublic: {
      method: "GET",
      path: "/api/public/product/:id/reviews",
      purpose: "Returnează recenziile unui produs - public, fără autentificare.",
      audience: ["USER", "VENDOR", "GUEST"],
    },

    productReviewsAverage: {
      method: "GET",
      path: "/api/public/product/:id/reviews/average",
      purpose: "Returnează media notelor unui produs - public.",
      audience: ["USER", "VENDOR", "GUEST"],
    },

    createReview: {
      method: "POST",
      path: "/api/reviews",
      purpose: "Lasă o recenzie unui produs (cont necesar).",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Cum las o recenzie?",
      a: "Poți lăsa o recenzie unui produs sau unui magazin din pagina produsului/magazinului sau din contul tău - ai nevoie de un cont, dar NU e obligatoriu să fi cumpărat produsul (dacă ai cumpărat, recenzia primește automat un badge de 'verificat').",
    },
    {
      q: "Cum răspund la o recenzie?",
      a: "Ca vânzător, poți răspunde la recenziile primite direct din pagina produsului tău.",
    },
    {
      q: "Cum raportez o recenzie?",
      a: "Din recenzia respectivă ai opțiunea de a o raporta, dacă consideri că încalcă regulile.",
    },
    {
      q: "Cum primesc recenzii ca vânzător?",
      a: "Nu e o acțiune a ta - orice client (cu cont) poate lăsa o recenzie unui produs sau magazinului tău, din pagina respectivă. Nu e obligatoriu să fi cumpărat produsul, dar dacă a cumpărat, recenzia primește automat un badge de „verificat”.",
    },
    {
      q: "Ce fac dacă primesc o recenzie nedreaptă?",
      a: "Poți răspunde direct la recenzie, din pagina produsului tău, ca să clarifici public situația. Dacă recenzia încalcă regulile platformei, ai și opțiunea de a o raporta - nu poți șterge tu recenzia altcuiva, doar pe cele proprii.",
    },
    {
      q: "Pot vedea recenziile unui produs fără cont?",
      a: "Da - recenziile și rating-ul unui produs sunt vizibile public, fără să fii autentificat. Ai nevoie de cont doar dacă vrei chiar tu să lași o recenzie.",
    },

    {
      q: "Pot șterge o recenzie?",
      a: "Da, dar doar propriile recenzii - autorul le poate șterge oricând, atât pe produse cât și pe magazin.",
    },
    {
      q: "Unde văd recenziile primite ca vânzător?",
      a: "Nu există o secțiune separată „Recenzii” - le vezi direct în /vendor/catalog (pagina de produse), la fiecare produs în parte, cu opțiunea de a răspunde direct din același loc. Recenziile de magazin apar similar, tot din zona de gestiune a magazinului.",
    },
    {
      q: "Cum se calculează ratingul meu?",
      a: "E o medie ponderată a notelor primite (1-5), calculată și actualizată automat pe măsură ce primești recenzii noi - nu o medie simplă recalculată pe loc la fiecare cerere.",
    },
    {
      q: "Pot lăsa mai multe recenzii aceluiași produs?",
      a: "Nu - poți avea STRICT o recenzie per produs (constrângere reală în baza de date). Dacă trimiți din nou o recenzie pentru același produs, ea îți EDITEAZĂ recenzia existentă (rating + comentariu), nu se creează una nouă.",
    },
    {
      q: "Pot modifica o recenzie deja lăsată?",
      a: "Da - refaci pur și simplu pasul de a lăsa o recenzie pentru același produs (rating + comentariu nou); sistemul detectează că ai deja una și o actualizează pe loc, nu creează o recenzie nouă.",
    },
    {
      q: "Pot recenza un produs de la o comandă anulată?",
      a: "Da, nimic nu blochează asta - lăsarea unei recenzii nu cere deloc o comandă (poți recenza orice produs, cumpărat sau nu). Diferența e că badge-ul „verificat” se atribuie DOAR dacă ai o comandă cu acel produs în status plătit/finalizat - o comandă anulată nu califică pentru acest badge, dar recenzia în sine se poate lăsa normal.",
    },
    {
      q: "Când pot lăsa o recenzie? Trebuie să aștept livrarea?",
      a: "Nu există o restricție de timp - poți lăsa o recenzie oricând, inclusiv înainte de a cumpăra produsul. Singura consecință a momentului/istoricului comenzii este badge-ul „verificat” (necesită o comandă plătită/finalizată cu acel produs), nu posibilitatea de a scrie recenzia.",
    },
    {
      q: "Trebuie să am o comandă confirmată ca să las recenzie?",
      a: "Nu - a lăsa o recenzie nu necesită nicio comandă. O comandă plătită/finalizată cu acel produs îți dă doar badge-ul „verificat” pe recenzie, nu e o condiție obligatorie pentru a scrie recenzia.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: reviewsProductRoutes.js, reviewsStoreRoutes.js, commentProductRoutes.js. Verificat 2026-08-24. Extins 2026-08-28 (audit GUEST): confirmat direct în cod - router.get('/public/product/:id/reviews', ...) și .../reviews/average NU au authRequired (citire publică); router.post('/reviews', authRequired, ...) - creare recenzie necesită cont, verifică isVendorOwnerOfProduct (blochează auto-recenzie) și rate-limit 10/24h; badge 'verificat' setat separat, din istoricul de comenzi PAID/FULFILLED al userului, nu e o condiție de blocare.\n\nBATCH E (audit regression Vendor Assistant, 2026-09-07): STALE_KNOWLEDGE corectat - ștergere reală confirmată (DELETE /api/reviews/:id, reviewsProductRoutes.js:532; DELETE /api/store-reviews/:id, reviewsStoreRoutes.js:436). Rating: StoreRatingStats/ProductRatingStats (schema.prisma:1063-1091) - câmp `avg` pre-calculat cu distribuție c1-c5, NU o medie live. DESCOPERIRE: reviewsStoreRoutes.js:1017 definește A DOUA OARĂ path-ul GET /api/vendors/me/reviews/kpi (deja definit în reviewsProductRoutes.js:940) - router-ul lui e montat DUPĂ (server.js:547-548 - productReviewsRouter primul, storeReviewsRouter al doilea), deci varianta din reviewsStoreRoutes.js e umbrită/inaccesibilă în Express (primul handler înregistrat pe un path câștigă mereu) - cod mort, nu business logic activă, nu am atins-o. LIVE DATA (câte recenzii am / ratingul meu / notificări necitite): conectat la Vendor Assistant printr-un serviciu subțire nou, vendorAssistantReviews.js, care reutilizează exact query-urile din varianta REALĂ/accesibilă a KPI-ului (reviewsProductRoutes.js) + StoreRatingStats + GET /vendor/notifications/unread-count.",
};
