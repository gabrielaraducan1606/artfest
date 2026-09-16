// backend/src/ai/manifests/quotes.manifest.js

/*
 * Domeniul "cereri de ofertă" are DOUĂ fluxuri active, distincte,
 * verificate în cod (nu doar unul, cum am presupus inițial):
 *
 * 1. Cereri publice (customerRequestsRoutes.js, montat la
 *    /api/customer-requests) - userul postează public o cerere
 *    ("vreau X personalizat"), mai mulți vânzători pot răspunde
 *    cu oferte. UI: /cereri, /cereri/:id
 *    (CustomerRequestsPage/CustomerRequestDetailsPage - confirmat
 *    wired în App.jsx).
 *
 * 2. Oferte prin AI assistant (assistantQuotesRoutes.js, montat la
 *    /api/assistant/quotes) - flow ghidat de widget-ul de chat,
 *    conversație 1:1 cu mesaje și oferte. UI:
 *    components/AIAssistant/quotes/.
 *
 * Ambele sunt ACTIVE - documentate aici separat, ca să nu se
 * confunde răspunsurile date userului.
 */

export const QUOTES_MANIFEST = {
  id: "quotes",

  title: "Cereri de ofertă / Cer o ofertă personalizată",

  /*
   * CORECTAT (audit Guest, 2026-09-08) - GUEST rămâne în audience
   * DOAR ca să poată CITI despre acest concept (i.e. i se poate
   * explica "ai nevoie de cont"), NU pentru că ar putea executa
   * vreuna dintre cele două fluxuri. Comentariul vechi de mai sus
   * era GREȘIT: verificat direct în cod,
   * POST /api/customer-requests (creare cerere publică) are
   * authRequired (customerRequestsRoutes.js, linia rutei "/"),
   * și TOT routerul assistantQuotesRoutes.js (oferta ghidată 1:1)
   * are authRequired, cu comentariu explicit în cod: "Pentru cereri
   * de ofertă cerem cont autentificat. Guest poate cumpăra direct
   * în continuare, dar nu poate crea cereri de ofertă." Un guest
   * NU poate crea nicio cerere de ofertă, prin niciun flux.
   */
  audience: ["USER", "VENDOR", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Userul poate cere un produs personalizat în două moduri: (1) postează o cerere publică pe care mai mulți vânzători o pot vedea și oferta, sau (2) cere o ofertă direct printr-o conversație ghidată în asistentul AI.",

  tags: [
    "cerere oferta",
    "comanda personalizata",
    "cer o oferta",
    "produs la comanda",
    "cerere publica",
    "oferta personalizata",
    "link de promovare",
  ],

  aliases: [
    "cum cer o oferta",
    "vreau ceva personalizat",
    "unde imi vad cererile",
    "cum raspund la o cerere de oferta",
    "cerere publica",
    "cerere oferta homepage",
    "primesc oferte de la mai multi",
    "cer oferta unui vanzator",
    "cer oferta pentru produs",
    "oferta personalizata",
    "cererile mele",
    "care e diferenta dintre cerere publica si oferta directa",

    /*
     * USER BATCH 3 (audit 2026-09-08) - "Care este ultima cerere?"
     * (fără "de ofertă") nu potrivea NIMIC pe acest manifest - pica pe
     * "messages" (zgomot organic slab) și primea fallback generic.
     */
    "care este ultima cerere",
    "care este ultima mea cerere",
    "care e ultima cerere de oferta",

    /*
     * BATCH 3 (audit regression, 2026-09-06) - perspectiva VENDOR,
     * complet absentă înainte de această etapă.
     */
    "unde vad cererile de oferta ca vanzator",
    "cum trimit o oferta unui client",
    "pot schimba pretul in oferta",
    "pot negocia cu clientul",
    "pot trimite mai multe oferte pe aceeasi cerere",
    "cum retrag o oferta trimisa",
    "cum refuz o cerere de oferta",
    "primeste clientul notificare cand raspund",
    "primeste clientul email la oferta",
    "cum transform cererea intr-o comanda",
    "pot cere avans pentru o oferta",
    "ce statusuri au cererile de oferta",
    "ce inseamna statusul cererii",
    "cum schimb statusul unei cereri",
    "pot marca o cerere ca rezervata",
    "pot vorbi cu clientul inainte sa trimit oferta",
    "unde vad conversatia legata de oferta",
    "cum vad cererile noi",
    "cum vad cererile in discutii",
    "cum vad ofertele trimise",
    "cum vad cererile rezervate",
    "cum vad cererile pierdute",
  ],

  uiLocations: [
    { audience: "USER", path: "/cereri" },
    { audience: "USER", path: "/cereri/:id" },
    { audience: "USER", path: "widget AI assistant - Cereri ofertă" },

    /*
     * BATCH 3 (audit regression, 2026-09-06): nu există o pagină
     * dedicată "Oferte" pentru vendor - o cerere de ofertă e un
     * MessageThread ca oricare altul (are quoteRequest asociat), deci
     * apare direct în Mesaje (vezi messages.manifest.js, VENDOR_MESSAGES
     * -> /mesaje). Widget-ul de asistent rămâne calea conversațională
     * de a trimite/retrage o ofertă.
     */
    { audience: "VENDOR", path: "/mesaje" },
    { audience: "VENDOR", path: "widget AI assistant - Oferte vendor" },
  ],

  capabilities: {
    publicRequestBoard: {
      available: true,
      notes: "customer-requests: cerere publică, mai mulți vânzători pot oferta.",
    },

    assistantGuidedQuote: {
      available: true,
      notes: "assistant/quotes: conversație ghidată 1:1 în chat.",
    },

    offerAcceptReject: { available: true },
    imageModeration: {
      available: true,
      notes: "Imaginile atașate la cererea publică trec prin moderare AI.",
    },

    /*
     * Confirmat în cod (BATCH 3, audit 2026-09-06):
     * vendorQuotesRoutes.js (POST /:id/offers).
     */
    vendorSendOffer: {
      available: true,
      notes:
        "Vendorul trimite oferta din conversația cererii (preț per produs/serviciu, cantitate, cost transport, termen de producție, dată estimată de livrare, valabilitate ofertă, notițe). Prețul este liber ales de vendor, nu vine impus din cererea inițială.",
    },

    vendorNegotiate: {
      available: true,
      notes:
        "Vendorul poate trimite ORICÂTE oferte succesive pe aceeași cerere (negociere/ajustare) cât timp cererea nu e închisă (acceptată/refuzată/anulată/expirată) - fiecare ofertă nouă marchează automat oferta anterioară activă ca „înlocuită” (SUPERSEDED), doar ultima rămâne activă.",
    },

    vendorWithdrawOffer: {
      available: true,
      notes: "Vendorul poate retrage o ofertă trimisă înainte ca ea să fie acceptată sau refuzată.",
    },

    vendorRejectQuote: {
      available: true,
      notes:
        "Vendorul poate refuza direct cererea (cu motiv opțional, vizibil clientului) - cererea se închide definitiv, nu doar oferta.",
    },

    quoteToOrder: {
      available: true,
      notes:
        "STALE_KNOWLEDGE CORECTAT (audit 2026-09-06): acceptarea unei oferte de către client CHIAR creează o comandă reală (Order), cu adresă de livrare/facturare, metodă de plată și shipment - nu e doar o schimbare de status. Comanda rezultată e vizibilă în secțiunea Comenzi ca orice altă comandă.",
    },

    depositForQuoteOrder: {
      available: true,
      notes:
        "Comanda rezultată dintr-o ofertă acceptată trece prin ACELAȘI mecanism de plată ca orice comandă normală (vezi checkout-payments) - avans fix, doar la plata ramburs, nimic specific cererilor de ofertă.",
    },

    crmLeadStatus: {
      available: true,
      notes:
        "Fiecare cerere de ofertă (conversația ei) are un status CRM: nouă, în discuții, cu ofertă trimisă, rezervată sau pierdută. Primele trei se schimbă AUTOMAT (trimiterea unei oferte -> „ofertă trimisă”; refuzul cererii -> „pierdută”); „rezervată” se setează DOAR manual de vânzător.",
    },

    crmManualStatusChange: {
      available: true,
      notes:
        "Schimbarea manuală a statusului (ex. „rezervată”) se face din pagina de Mesaje, pe conversația respectivă - necesită un abonament cu funcții avansate de mesagerie (nu e disponibilă pe orice plan).",
    },
  },

  limitations: [
    "Sunt două fluxuri distincte (cerere publică vs. asistent AI) - nu sunt unificate într-un singur loc.",
    "Nu există o pagină dedicată „Oferte” pentru vendor - cererile de ofertă apar în Mesaje, ca orice altă conversație cu un client.",
    "Marcarea manuală a statusului unei cereri (ex. „rezervată”) necesită un abonament cu funcții avansate de mesagerie.",
    "Nu există un status CRM distinct pentru „câștigată”/finalizată prin comandă - odată acceptată oferta, statusul rămâne „ofertă trimisă”, iar semnul real că s-a finalizat e faptul că are o comandă asociată.",
  ],

  flows: [
    {
      name: "cerere publică",
      steps: ["creare cerere", "vânzători ofertă", "acceptare/respingere ofertă"],
    },
  ],

  integrations: {},

  endpoints: {
    createPublicRequest: {
      method: "POST",
      path: "/api/customer-requests",
      purpose: "Creează o cerere publică de ofertă.",
      audience: ["USER"],
    },

    listPublicRequests: {
      method: "GET",
      path: "/api/customer-requests",
      purpose: "Listează cererile publice (doar citire - fără cont).",
      audience: ["USER", "VENDOR", "GUEST"],
    },

    myAssistantQuotes: {
      method: "GET",
      path: "/api/assistant/quotes/me",
      purpose: "Returnează ofertele/cererile prin asistentul AI ale userului.",
      audience: ["USER"],
    },

    /*
     * BATCH 3 (audit regression, 2026-09-06) - perspectiva VENDOR,
     * confirmate direct în vendorQuotesRoutes.js (montat la
     * /api/vendor/quotes).
     */
    listVendorQuotes: {
      method: "GET",
      path: "/api/vendor/quotes",
      purpose: "Listează TOATE cererile de ofertă ale vendorului (fără filtru de status server-side).",
      audience: ["VENDOR"],
    },

    sendOffer: {
      method: "POST",
      path: "/api/vendor/quotes/:id/offers",
      purpose: "Trimite o ofertă (sau una nouă, care înlocuiește pe cea activă) pe o cerere.",
      audience: ["VENDOR"],
    },

    withdrawOffer: {
      method: "POST",
      path: "/api/vendor/quotes/:id/offers/:offerId/withdraw",
      purpose: "Retrage o ofertă trimisă, încă neacceptată/nerefuzată.",
      audience: ["VENDOR"],
    },

    rejectQuote: {
      method: "POST",
      path: "/api/vendor/quotes/:id/reject",
      purpose: "Refuză definitiv cererea (cu motiv opțional) - statusul CRM devine „pierdută”.",
      audience: ["VENDOR"],
    },

    acceptOffer: {
      method: "POST",
      path: "/api/assistant/quotes/:id/offers/:offerId/accept",
      purpose: "Clientul acceptă oferta - creează efectiv o comandă (Order) reală.",
      audience: ["USER"],
    },

    changeLeadStatus: {
      method: "PATCH",
      path: "/api/inbox/threads/:id/meta-advanced",
      purpose:
        "Schimbă manual statusul CRM al conversației (inclusiv „rezervată”) - necesită abonament cu funcții avansate.",
      audience: ["VENDOR"],
    },

    /*
     * LIVE - conectat la Vendor Assistant (vezi
     * vendorAssistantQuoteLeads.js): câte cereri am / noi / în discuții /
     * cu ofertă trimisă / rezervate / pierdute.
     */
    countLeadsByStatus: {
      method: "GET",
      path: "/api/inbox/threads?status=...",
      purpose: "Numărul/lista de conversații (inclusiv cereri de ofertă) filtrate după statusul CRM.",
      audience: ["VENDOR"],
      connectedToAssistant: true,
    },
  },

  faq: [
    {
      q: "Cum funcționează cererile de ofertă?",
      a: "Există DOUĂ moduri diferite, dar AMBELE necesită cont: (1) Cerere publică - o postezi din pagina „Cereri” (buton „Publică o cerere”), o văd mai mulți vânzători, care pot trimite oferte; alegi tu oferta care ți se potrivește. (2) Cerere directă către un vânzător - o pornești din pagina unui produs/magazin sau direct în conversația cu asistentul, e o discuție 1:1 doar cu acel vânzător, ghidată pas cu pas (cantitate, detalii). Fără cont poți doar cumpăra direct produse cu preț fix - pentru orice tip de cerere de ofertă trebuie să te autentifici întâi.",
    },
    {
      q: "Cum cer o ofertă pentru un produs personalizat?",
      a: "Trebuie să ai cont (sau să te autentifici pe loc) - apoi poți posta o cerere publică din pagina „Cereri”, la care mai mulți vânzători pot răspunde cu oferte, sau poți cere direct în chat-ul asistentului AI o ofertă ghidată, de la un singur vânzător. Fără cont poți în continuare cumpăra direct produse cu preț fix.",
    },
    {
      q: "Trebuie să am cont ca să cer o ofertă?",
      a: "Da, pentru ambele fluxuri (cerere publică ȘI ofertă directă prin asistent) - confirmat direct în cod, ambele necesită autentificare. Nu există nicio variantă de cerere de ofertă accesibilă fără cont. Fără cont poți în schimb cumpăra direct orice produs cu preț fix, inclusiv finaliza plata.",
    },
    {
      q: "Pot cere ofertă fără să am cont?",
      a: "Nu - nici cererea publică, nici oferta directă către un vânzător nu sunt disponibile fără cont. Îți poți crea unul rapid (email+parolă sau Google) exact în momentul în care vrei să ceri o ofertă.",
    },
    {
      q: "Care e diferența dintre o cerere publică și o ofertă directă la un vânzător?",
      a: "Cererea publică e vizibilă tuturor vânzătorilor, care pot trimite oferte independent - alegi tu care ți se potrivește. Oferta directă e o conversație doar cu UN vânzător anume, de obicei pornind de la un produs sau magazin care te-a interesat deja. Ambele necesită cont.",
    },
    {
      q: "Cum public o cerere la care pot răspunde mai mulți vânzători?",
      a: "Din pagina „Cereri” (accesibilă și de pe homepage), apeși „Publică o cerere” - ți se cere să te autentifici dacă nu ai făcut-o deja, apoi completezi ce cauți, iar vânzătorii interesați îți vor trimite oferte.",
    },
    {
      q: "Cum cer ofertă direct unui vânzător?",
      a: "Trebuie să fii autentificat. De obicei pornești din pagina unui produs sau a unui magazin care te interesează - asistentul te ghidează prin câteva întrebări (cantitate, detalii) și trimite cererea direct acelui vânzător.",
    },
    {
      q: "Unde îmi văd cererile mele?",
      a: "Din asistent, cerându-i „arată-mi cererile mele”, sau din pagina dedicată din contul tău - vezi cererile trimise, conversațiile cu vânzătorii și ofertele primite. Necesită cont (fiind o listă legată strict de contul tău); asta e doar listare, nu creează o cerere nouă.",
    },

    /*
     * BATCH 3 (audit regression, 2026-09-06) - perspectiva VENDOR.
     * Toate confirmate direct în vendorQuotesRoutes.js/
     * assistantQuotesRoutes.js/schema.prisma.
     */
    {
      q: "Unde văd cererile de ofertă ca vânzător?",
      a: "Nu există o pagină separată „Oferte” - o cerere de ofertă e o conversație ca oricare alta, vizibilă în secțiunea Mesaje (/mesaje). Acolo, deschizând conversația respectivă, vezi și cererea, și oferta/ofertele trimise.",
    },
    {
      q: "Cum răspund la o cerere de ofertă (ca vânzător)?",
      a: "Poți trimite un mesaj liber în conversație (inclusiv să negociezi înainte de a formaliza o ofertă), poți trimite o ofertă formală (preț, termen, notițe) sau poți refuza direct cererea, cu un motiv opțional vizibil clientului.",
    },
    {
      q: "Cum trimit o ofertă?",
      a: "Din conversația cererii, completezi prețul (per produs/serviciu), cantitatea, costul de transport, termenul de producție, data estimată de livrare, valabilitatea ofertei și eventuale notițe, apoi o trimiți către client.",
    },
    {
      q: "Pot schimba prețul în ofertă?",
      a: "Da - prețul din ofertă îl stabilești tu, ca vânzător, nu vine impus din cererea inițială a clientului.",
    },
    {
      q: "Pot negocia cu clientul?",
      a: "Da - poți trimite mesaje libere în aceeași conversație înainte de a formaliza o ofertă, iar dacă clientul cere ajustări, poți trimite oricâte oferte noi pe aceeași cerere; fiecare ofertă nouă înlocuiește automat oferta activă anterioară, doar ultima rămânând valabilă pentru acceptare.",
    },
    {
      q: "Primește clientul notificare când răspund?",
      a: "Da, primește o notificare în platformă - la trimiterea unei oferte noi („Ai primit o ofertă nouă”), la retragerea unei oferte, sau la refuzarea cererii (cu motivul, dacă l-ai completat). Aceste evenimente NU trimit și email către client, doar notificare in-app.",
    },
    {
      q: "Primește clientul email?",
      a: "Nu la trimiterea/retragerea unei oferte sau la refuzul cererii - acolo primește doar notificare în platformă. Email primește doar când comanda chiar se formează (după ce el acceptă o ofertă) - atunci atât clientul, cât și tu primiți email de confirmare a comenzii noi.",
    },
    {
      q: "Cum transform cererea într-o comandă?",
      a: "Nu o transformi tu direct - clientul trebuie să accepte o ofertă trimisă de tine. În momentul acceptării, platforma creează automat o comandă reală (cu adresă de livrare, metodă de plată etc.), vizibilă apoi în secțiunea Comenzi ca orice altă comandă.",
    },
    {
      q: "Pot cere avans pentru o ofertă?",
      a: "Avansul nu se setează per ofertă - comanda rezultată dintr-o ofertă acceptată urmează exact aceleași reguli de plată ca orice comandă normală (avans fix, doar la plata ramburs, procent nenegociabil per ofertă).",
    },
    {
      q: "Ce statusuri poate avea o cerere de ofertă?",
      a: "Cinci statusuri CRM: nouă (implicit, fără răspuns), în discuții, cu ofertă trimisă, rezervată sau pierdută. Primele trei se schimbă automat pe măsură ce conversația avansează; „rezervată” o setezi tu manual; „pierdută” se setează automat când refuzi cererea (sau manual, dacă vrei să o închizi fără refuz formal).",
    },
    {
      q: "Cum schimb statusul unei cereri?",
      a: "Din conversația respectivă, în secțiunea Mesaje, poți seta manual statusul (de exemplu „rezervată”) - funcția face parte din setul de funcții avansate de mesagerie, deci necesită un abonament care le include.",
    },
    {
      q: "Pot marca o cerere ca rezervată?",
      a: "Da, manual, din conversația ei, din secțiunea Mesaje - e singurul mod în care o cerere devine „rezervată” (nu se întâmplă automat).",
    },
    {
      q: "Cum văd cererile pierdute?",
      a: "Statusul „pierdută” se aplică automat cererilor pe care le-ai refuzat (sau pe care le-ai marcat manual ca atare). Le găsești filtrând conversațiile din Mesaje după acest status, sau întrebând direct Vendor Assistant-ul „ce cereri sunt pierdute”.",
    },
    {
      q: "Pot vorbi cu clientul înainte să trimit oferta?",
      a: "Da - poți schimba mesaje libere în aceeași conversație înainte de a trimite o ofertă formală, ca să clarifici detalii.",
    },
    {
      q: "Unde văd conversația legată de o ofertă?",
      a: "Este chiar conversația cererii, în Mesaje - mesajele și ofertele trimise coexistă în același fir de discuție, nu sunt separate.",
    },

    /*
     * BUGFIX (audit USER Batch 1, 2026-09-08) - CORECTAT: retrieval-ul
     * surfacta FAQ-urile de mai sus (scrise din perspectiva VÂNZĂTORULUI
     * - "cum trimit oferta", "pot negocia cu clientul") ca răspuns la
     * "Cum accept o ofertă?" a unui CUMPĂRĂTOR, ducând la un răspuns
     * complet greșit (explica cum se PROCESEAZĂ o comandă, ca vânzător).
     * FAQ-urile de mai jos sunt STRICT din perspectiva cumpărătorului
     * (USER), care a PRIMIT o ofertă și vrea să reacționeze la ea -
     * verificate direct în cod: POST /api/assistant/quotes/:id/offers/
     * :offerId/accept (creează efectiv o Comandă reală, tx.order.create
     * + quoteRequest.update({status:"ACCEPTED", orderId})).
     */
    {
      q: "Cum accept o ofertă primită de la un vânzător?",
      a: "Din conversația cererii tale (o găsești în Mesaje sau în widget-ul de asistent, la „Cererile mele”) - acolo vezi oferta primită și ai opțiunea de a o accepta direct. Acceptarea creează IMEDIAT o comandă reală (cu adresă, metodă de plată, expediere), vizibilă apoi în „Comenzile mele” ca orice altă comandă.",
    },
    {
      q: "Ce se întâmplă când accept oferta, ca cumpărător?",
      a: "Se creează automat o comandă reală, pe baza ofertei acceptate - nu e doar o schimbare de status. Comanda rezultată urmează exact același proces ca o comandă normală (plată, expediere, urmărire) și o vezi în „Comenzile mele”.",
    },
    {
      q: "Acceptarea unei oferte creează o comandă, ca cumpărător?",
      a: "Da - confirmat direct în cod: la acceptare se creează o comandă reală (Order), nu doar se schimbă statusul cererii. Vezi comanda rezultată în „Comenzile mele”, la fel ca orice altă comandă.",
    },
    {
      q: "Pot refuza o ofertă primită, ca cumpărător?",
      a: "Da - din aceeași conversație a cererii poți refuza oferta primită, fără să accepți. Cererea rămâne deschisă pentru discuție ulterioară, dacă vânzătorul trimite o nouă ofertă.",
    },
    {
      q: "Pot cere alt preț la o ofertă primită?",
      a: "Nu direct printr-un buton „cere alt preț” - poți totuși scrie un mesaj liber în conversația cererii, cerând vânzătorului să ajusteze prețul; dacă e de acord, el trimite o ofertă nouă (care înlocuiește automat pe cea veche), pe care o poți accepta separat.",
    },
    {
      q: "Pot cere alt termen de livrare la o ofertă primită?",
      a: "La fel ca la preț - nu există un buton dedicat, dar poți discuta termenul direct în conversația cererii; vânzătorul poate trimite o ofertă nouă cu alt termen, pe care o accepți sau o refuzi separat.",
    },
    {
      q: "Primesc notificare sau email când vânzătorul îmi trimite o ofertă?",
      a: "Primești notificare în platformă (in-app) când vânzătorul trimite o ofertă nouă, o retrage, sau refuză cererea. NU primești și email în aceste momente - email primești DOAR când comanda se formează efectiv, după ce accepți o ofertă (atunci primești email de confirmare a comenzii noi).",
    },
  ],

  unavailableFeatures: [
    "O pagină/secțiune dedicată „Oferte” separată de Mesaje, pentru vânzător.",
    "Avans specific per ofertă, diferit de regula generală de avans a comenzilor (COD, procent fix).",
    "Email către client la trimiterea/retragerea unei oferte sau la refuzul cererii (doar notificare in-app; email există doar la formarea comenzii).",
    "Trecere automată la statusul „rezervată” - se face doar manual.",
  ],

  notes:
    "Sursă: customerRequestsRoutes.js (confirmat montat în server.js la /api/customer-requests, consumat de 5 fișiere frontend sub pages/Home/CustomerRequestsSection/, wired în App.jsx la /cereri și /cereri/:id) + assistantRoutes/assistant/assistantQuotesRoutes.js (montat la /api/assistant/quotes) + vendorQuotesRoutes.js (montat la /api/vendor/quotes). Verificat 2026-08-24 - NU e legacy, e un flow activ separat. BUGFIX (audit 2026-08-26): asistentul confunda cele două concepte în routing (client-side) - reparat cu detectQuoteRequestIntent (assistantQuotes.js), care distinge semantic CREATE_PUBLIC_REQUEST (ghidează spre /cereri, fără flow conversațional de creare - nu există endpoint pentru asta apelat din widget) de REQUEST_VENDOR_QUOTE (flow conversațional existent, createQuoteRequest -> POST /api/assistant/quotes, pornit acum și din text liber, nu doar din butonul dedicat de pe pagina de produs/magazin) și de simpla listare (\"cererile mele\").\n\nBATCH 3 (audit regression Vendor Assistant, 2026-09-06) - STALE_KNOWLEDGE CORECTAT: manifestul nu menționa deloc perspectiva vendorului, iar auditul a arătat că asistentul afirma greșit \"acceptarea unei oferte nu creează comandă\" - FALS, confirmat direct în assistantQuotesRoutes.js (POST /:id/offers/:offerId/accept, ~linia 3053: tx.order.create(...), apoi tx.quoteRequest.update({status:\"ACCEPTED\", orderId: order.id})). Adăugat, verificat direct în cod: statusuri reale - QuoteRequest.status (QuoteRequestStatus: DRAFT/SUBMITTED/IN_DISCUSSION/OFFER_SENT/ACCEPTED/REJECTED/CANCELLED/EXPIRED, schema.prisma ~L2868) și, SEPARAT, MessageThread.leadStatus (LeadStatus: NEW/IN_DISCUSSION/OFFER_SENT/RESERVED/LOST, schema.prisma ~L2405) - cele două NU sunt identice, dar sunt sincronizate automat la trimitere ofertă (->OFFER_SENT pe ambele, vendorQuotesRoutes.js ~L2004-2029) și la refuz (leadStatus->LOST, quoteRequest.status->REJECTED, ~L2585-2611); RESERVED nu e atins NICIODATĂ automat (grep confirmat) - se setează STRICT manual via PATCH /api/inbox/threads/:id/meta-advanced, care necesită requireChatEntitlement({advanced:true}) (vendorMessageRoutes.js, confirmat în BATCH 1). Negociere: trimiterea unei oferte noi marchează automat oferta SENT anterioară ca SUPERSEDED (QuoteOfferStatus, vendorQuotesRoutes.js ~L1951-1964) - nu există limită la număr de oferte succesive cât timp quote.status e în {SUBMITTED, IN_DISCUSSION, OFFER_SENT}. Notificări: la ofertă trimisă/retrasă/cerere refuzată -> DOAR createUserNotification in-app către client (vendorQuotesRoutes.js nu importă deloc mailer.js, verificat prin grep); la cerere nouă -> vendorul primește EMAIL real (sendVendorNewQuoteRequestEmail, assistantQuotesRoutes.js ~L1010); la acceptarea ofertei (creare comandă) -> AMBII primesc email (sendOrderConfirmationEmail către client ~L3484, sendVendorNewOrderEmail către vendor ~L3584). Avans: assistantQuotesRoutes.js nu are logică proprie de avans - apelează createPaymentForOrder din payments/orchestrator.js, ACELAȘI orchestrator folosit de checkout-ul normal (vezi checkoutPayments.manifest.js) - nimic specific cererilor de ofertă. Nu există pagină dedicată de \"Oferte\" pentru vendor (grep pe frontend/src pentru /api/vendor/quotes - un singur match, quoteApi.js, folosit doar de widget-ul de asistent) - o cerere e un MessageThread ca oricare altul, vizibil în /mesaje. LIVE DATA: numărul de cereri pe status conectat la Vendor Assistant printr-un serviciu subțire nou, backend/src/services/vendorAssistantQuoteLeads.js (reutilizează exact MessageThread.leadStatus, fără duplicare de logică de business), apelat din copilotRouter.js STRICT pentru audience VENDOR - comenzi/câștiguri/stoc rămân neatinse. E2E prin chat real NEVERIFICAT încă (cotă OpenAI epuizată la data auditului) - verificat doar static (node --check) și direct pe date reale din DB (fără LLM).",
};
