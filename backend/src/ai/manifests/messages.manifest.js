// backend/src/ai/manifests/messages.manifest.js

export const MESSAGES_MANIFEST = {
  id: "messages",

  title: "Mesaje / Inbox",

  audience: ["USER", "VENDOR"],

  /*
   * BUGFIX (audit GUEST, 2026-08-28): mesageria directă (sendMessage)
   * chiar necesită cont (audience rămâne USER/VENDOR pentru CINE
   * poate SCRIE un mesaj) - dar un GUEST care întreabă "Cum contactez
   * vânzătorul?" trebuie să primească un răspuns corect, nu "nu am
   * informații" (manifestul era complet invizibil pentru el în
   * retrieval). knowledgeAudience extinde DOAR cine poate GĂSI/CITI
   * despre mecanism, la fel cum se face deja în products.manifest.js.
   */
  knowledgeAudience: ["USER", "VENDOR", "GUEST"],

  available: true,
  status: "ACTIVE",

  description:
    "Mesagerie directă între cumpărători și vânzători.",

  tags: [
    "mesaje",
    "inbox",
    "conversatie",
    "scrie vanzatorului",
    "contactez vanzatorul",
    "vorbesc cu vanzatorul",
    "atasamente",
    "poze mesaje",
    "editare mesaj",
    "stergere mesaj",
    "retry mesaj",
    "vendor to vendor",
    "floating hub",
    "notificari mesaje",
    "cautare conversatii",
    "arhivare conversatii",
    "mesaje necitite",
  ],

  aliases: [
    "cum scriu vanzatorului",
    "unde imi vad mesajele",

    /*
     * USER BATCH 3 (audit multi-turn, 2026-09-08) - "Vreau să văd
     * mesajele mele." pica greșit pe manifestul "invoices" (alias
     * "vreau sa vad facturile" din acel manifest partaja 3/3 tokeni
     * structurali generici "vreau/sa/vad" cu query-ul, bonus de
     * acoperire completă mai mare decât match-ul parțial de aici pe
     * "mesajele") - alias STRICT pe aceeași structură, ca să câștige
     * manifestul corect.
     */
    "vreau sa vad mesajele mele",
    "vreau sa vad mesajele",
    "nu am primit raspuns",
    "cum contactez vanzatorul",
    "cum iau legatura cu vanzatorul",
    "pot vorbi cu vanzatorul inainte sa comand",
    "pot intreba vanzatorul ceva inainte de comanda",
    "cum trimit un mesaj vanzatorului fara cont",

    /*
     * BATCH 1 - MESAJE (audit 2026-09-06): aliases noi, ca întrebările
     * de mai jos să ajungă STRICT la acest manifest, nu la unul
     * generic (products/checkout-payments/support etc, vezi FAIL-urile
     * de retrieval din audit - id172/175/187/190/191/192).
     */
    "pot trimite poze in mesaje",
    "cum trimit o poza intr-un mesaj",
    "pot trimite fisiere in mesaje",
    "pot trimite documente in mesaje",
    "cum descarc o poza dintr-un mesaj",
    "cum descarc un atasament",
    "cum salvez o poza primita in mesaj",
    "pot edita un mesaj trimis",
    "cum modific un mesaj deja trimis",
    "pot sterge un mesaj trimis",
    "cum sterg un mesaj dintr-o conversatie",
    "mesajul nu s-a trimis",
    "mesajul a esuat",
    "cum retrimit un mesaj",
    "ce fac daca un mesaj nu pleaca",
    "ce se intampla daca mesajul nu se trimite",
    "mesajul e blocat",
    "cum raspund unui client",
    "cum raspund la un mesaj de la un client",
    "pot vorbi cu alt vanzator",
    "cum trimit mesaj altui vanzator",
    "ce sunt mesajele intre vanzatori",
    "cum vad mesajele necitite",
    "cate mesaje necitite am",
    "cine mi-a scris ultima data",
    "care este ultima mea conversatie",
    "care e ultima mea conversatie",
    "ce conversatii nu au raspuns",
    "unde gasesc conversatiile vechi",
    "cum caut o conversatie",
    "cum caut un mesaj vechi",
    "unde sunt conversatiile arhivate",
    "cum arhivez o conversatie",
    "cum folosesc mesajele din bula flotanta",
    "ce e mini mesajele",
    "primesc notificare cand imi scrie cineva",
    "primesc notificare la mesaj nou",
  ],

  uiLocations: [
    { audience: "USER", path: "/cont/mesaje" },
    { audience: "VENDOR", path: "/mesaje" },
  ],

  capabilities: {
    sendMessage: { available: true },
    threadedConversations: { available: true },

    /*
     * Confirmat în cod (BATCH 1, audit 2026-09-06):
     * vendorMessageRoutes.js + userMessagesRoutes.js - simetric pe
     * ambele roluri (cumpărător/vânzător).
     */
    editOwnMessage: {
      available: true,
      notes:
        "Doar mesajele proprii (nu ale celuilalt participant); textul editat trece din nou prin filtrul automat de conținut, la fel ca la trimitere.",
    },

    deleteOwnMessage: {
      available: true,
      notes:
        "Ștergere logică (soft-delete): mesajul dispare doar din vederea ta, celălalt participant îl vede în continuare. Funcționează doar pe mesaje proprii.",
    },

    deleteWholeConversation: {
      available: true,
      audience: ["USER"],
      notes:
        "Doar cumpărătorul poate șterge complet o conversație din vederea proprie (soft-delete la nivel de fir, DELETE /api/user-inbox/threads/:id). Vânzătorul nu poate șterge complet un fir, doar îl poate arhiva (vezi archiveConversation, disponibilă AMBELOR roluri).",
    },

    attachments: {
      available: true,
      types: "imagini (nu documente/PDF sau alte tipuri de fișiere)",
      maxFilesPerMessage: 10,
      maxFileSizeMB: 25,
      moderation:
        "Fiecare imagine trece printr-o verificare automată de conținut înainte de a fi trimisă.",
      download:
        "Descărcarea/previzualizarea se face printr-un link intern autenticat, nu direct de pe un URL public.",
    },

    retrySend: {
      available: true,
      notes:
        "Un mesaj eșuat la trimitere e marcat vizibil ca atare; poți apăsa din nou pentru reîncercare, fără risc de duplicat (mecanism de idempotency).",
    },

    vendorToVendorMessaging: {
      available: true,
      audience: ["VENDOR"],
      notes:
        "Un vânzător poate deschide o conversație directă cu alt vânzător activ de pe platformă, separată de conversațiile cu proprii clienți. Apar în aceeași secțiune de mesaje.",
    },

    searchConversations: {
      available: true,
      notes:
        "Căutare după numele/telefonul/emailul clientului, numele magazinului sau conținutul ultimului mesaj.",
    },

    /*
     * CORECTAT (audit USER Batch 1, 2026-09-08) - manifestul afirma
     * greșit "doar VENDOR" - verificat direct în cod: PATCH /api/
     * user-inbox/threads/:id/archive EXISTĂ real pentru USER (ownership
     * corect: where:{id,userId}), și e chiar folosit de UserMessages.jsx
     * (buton "Archive" + tab "Arhivate" confirmate în frontend). Ambele
     * roluri pot arhiva propriile conversații.
     */
    archiveConversation: {
      available: true,
      audience: ["USER", "VENDOR"],
      notes:
        "Disponibilă atât cumpărătorului, cât și vânzătorului, pentru propriile conversații. Pentru vânzător, doar pentru conversațiile cu clienți (tip CUSTOMER); conversațiile vendor-to-vendor nu pot fi arhivate.",
    },

    /*
     * CORECTAT (audit USER Batch 1, 2026-09-08) - confirmat direct în
     * cod (FloatingHub.jsx): "canSeeMessages = me?.role === 'USER' ||
     * me?.role === 'VENDOR'" - panoul mini-mesaje e disponibil AMBELOR
     * roluri, nu doar vânzătorului (formularea veche, centrată pe
     * "conversațiile cu clienți", era specifică perspectivei vânzător).
     */
    miniMessagesFloatingHub: {
      available: true,
      audience: ["USER", "VENDOR"],
      notes:
        "Bula flotantă are un buton „Mesaje” care deschide un panou rapid, simplificat (fără filtre/CRM), cu propriile conversații (pentru vânzător: cele cu clienții; pentru cumpărător: cele cu vânzătorii). De acolo, „Deschide toate mesajele” duce la pagina completă.",
    },

    newMessageNotification: {
      available: true,
      notes:
        "La un mesaj sau atașament nou primești o notificare în platformă, cu link direct către conversația respectivă.",
    },

    unreadCount: {
      available: true,
      liveData: true,
      notes:
        "Numărul de conversații/mesaje necitite e calculat live pentru contul tău - nu e o valoare pe care manifestul o poate da static.",
    },
  },

  limitations: [
    "Editarea și ștergerea funcționează doar pe mesaje proprii, niciodată pe mesajele celuilalt participant.",
    "Ștergerea unui mesaj sau a unei conversații e din perspectiva ta - celălalt participant poate încă vedea conținutul original.",
    "Vânzătorul poate arhiva o conversație cu un client, dar nu o poate șterge complet - doar cumpărătorul are opțiunea de ștergere completă din vederea proprie.",
    "Arhivarea nu există pentru conversațiile vendor-to-vendor, doar pentru cele cu clienți.",
    "Atașamentele acceptă doar imagini (max 10 per mesaj, 25MB fiecare) - nu orice tip de fișier/document.",
  ],

  flows: [],
  integrations: {},

  endpoints: {
    myThreads: {
      method: "GET",
      path: "/api/user-inbox",
      purpose: "Returnează firele de mesaje ale utilizatorului.",
      audience: ["USER"],
    },

    /*
     * BATCH 1 (audit 2026-09-06) - endpoint-uri LIVE reale, confirmate
     * în cod, dar NECONECTATE la Vendor Assistant (nu există handler
     * EXISTING_FLOW/QUERY_LIVE_DATA pentru domeniul mesaje în
     * copilotRouter.js - comentariul din cod limitează explicit acel
     * handler la "produse, costuri, comenzi"). Documentate aici ca
     * MISSING_LIVE_TOOL, NU ca valori de pus în FAQ.
     */
    unreadCount: {
      method: "GET",
      path: "/api/inbox/unread-count",
      purpose: "Numărul de mesaje necitite ale vânzătorului (CUSTOMER threads).",
      audience: ["VENDOR"],
      connectedToAssistant: false,
    },

    unreadThreads: {
      method: "GET",
      path: "/api/inbox/threads?scope=unread",
      purpose: "Lista conversațiilor cu mesaje necitite, sortate după ultima activitate (oferă implicit și „cine mi-a scris ultima dată”).",
      audience: ["VENDOR"],
      connectedToAssistant: false,
    },
  },

  faq: [
    {
      q: "Cum scriu vânzătorului?",
      a: "Din pagina produsului/magazinului, sau direct dintr-o comandă, poți deschide o conversație cu vânzătorul.",
    },
    {
      q: "Unde îmi văd mesajele?",
      a: "În secțiunea de mesaje/inbox din contul tău - acolo vezi toate conversațiile, atât ca și cumpărător cât și ca vânzător.",
    },
    {
      q: "Cum contactez vânzătorul?",
      a: "Ai nevoie de un cont pentru a scrie direct unui vânzător - odată autentificat, poți deschide o conversație din pagina produsului/magazinului, dintr-o cerere de ofertă directă către el, sau dintr-o comandă plasată. Fără cont poți în continuare cumpăra direct orice produs cu preț fix; pentru mesaje sau cereri de ofertă (inclusiv cererea publică) trebuie să te autentifici întâi - confirmat direct în cod (nu există flux de mesagerie sau de cerere de ofertă accesibil fără cont).",
    },
    {
      q: "Pot vorbi cu vânzătorul înainte să comand?",
      a: "Da - poți cere o ofertă direct acelui vânzător și discuta detalii înainte de a cumpăra, de obicei pornind din pagina produsului sau a magazinului lui, dar necesită cont (la fel ca cererea publică vizibilă tuturor vânzătorilor - niciuna dintre cele două variante nu e disponibilă fără cont). Fără cont poți în continuare cumpăra direct produse cu preț fix.",
    },

    /*
     * BATCH 1 - MESAJE (audit 2026-09-06). Toate confirmate direct în
     * vendorMessageRoutes.js / userMessagesRoutes.js (simetric pe
     * ambele roluri, dacă nu se specifică altfel).
     */
    {
      q: "Pot trimite poze în mesaje?",
      a: "Da, poți atașa până la 10 imagini per mesaj (maximum 25MB fiecare), atât ca vânzător cât și ca cumpărător. Fiecare imagine trece printr-o verificare automată de conținut înainte de a fi trimisă.",
    },
    {
      q: "Pot trimite fișiere în mesaje?",
      a: "Doar imagini sunt acceptate ca atașamente - nu poți trimite documente (PDF, Word etc.) sau alte tipuri de fișiere, doar poze.",
    },
    {
      q: "Cum descarc o poză primită într-un mesaj?",
      a: "Poți deschide atașamentul pentru previzualizare sau folosi opțiunea de descărcare direct din conversație - fișierul este livrat printr-un link intern securizat (nu un URL public), accesibil doar celor doi participanți la conversație.",
    },
    {
      q: "Pot edita un mesaj deja trimis?",
      a: "Da, dar doar mesajele tale proprii, nu și cele primite. Textul editat trece din nou prin verificarea automată de conținut, la fel ca la trimiterea inițială.",
    },
    {
      q: "Pot șterge un mesaj trimis?",
      a: "Da, poți șterge un mesaj propriu - dispare din vederea ta, dar rămâne vizibil pentru celălalt participant (ștergere logică, nu una definitivă și reciprocă).",
    },
    {
      q: "Ce fac dacă un mesaj nu se trimite?",
      a: "Mesajul rămâne marcat vizibil ca „eșuat” în conversație. Poți apăsa din nou pe el pentru a-l retrimite - sistemul recunoaște că e aceeași tentativă, deci nu va apărea de două ori chiar dacă prima încercare ajunsese totuși la destinație.",
    },
    {
      q: "Cum răspund unui client?",
      a: "Deschide conversația respectivă din secțiunea Mesaje și trimite răspunsul direct în acel fir - la fel ca la orice alt mesaj, poți include și poze ca atașament. Dacă discuția pornește dintr-o cerere de ofertă, poți răspunde atât cu un mesaj simplu, cât și cu o ofertă formală (preț, termen) din același loc.",
    },
    {
      q: "Pot vorbi cu alt vânzător?",
      a: "Da - vânzătorii pot deschide conversații directe unii cu alții (mesagerie vendor-to-vendor), separat de conversațiile cu proprii clienți. Apar în aceeași secțiune de mesaje.",
    },
    {
      q: "Cum văd mesajele necitite?",
      a: "În lista de conversații, cele cu mesaje necitite pot fi filtrate separat. Numărul exact de conversații/mesaje necitite ale contului tău e o informație live (nu ceva ce pot afișa direct în această conversație) - se vede în timp real în pagina de mesaje.",
    },
    {
      q: "Pot arhiva o conversație?",
      a: "Da, atât ca cumpărător cât și ca vânzător - arhivarea o scoate din lista principală, într-un tab separat „Arhivate”, fără să șteargă nimic. Confirmat direct în cod, disponibil pentru propriile conversații.",
    },
    {
      q: "Pot șterge complet o conversație?",
      a: "Doar ca cumpărător - ștergerea completă a unui fir de discuție din vederea proprie e disponibilă STRICT pentru rolul de cumpărător. Ca vânzător, poți doar arhiva o conversație cu un client, nu o poți șterge complet.",
    },
    {
      q: "Cum știu dacă mesajul meu a fost citit?",
      a: "Nu există un indicator explicit de „citit” pe fiecare mesaj în parte (gen bifă). Platforma reține intern ultima dată la care celălalt participant a deschis conversația, dar nu îți arată explicit dacă a citit exact mesajul tău cel mai recent.",
    },
    {
      q: "Unde văd conversațiile mele?",
      a: "În secțiunea Mesaje - /mesaje pentru vânzători, /cont/mesaje pentru cumpărători. De acolo poți căuta o conversație după numele/telefonul/emailul persoanei, numele magazinului sau conținutul ultimului mesaj.",
    },
    {
      q: "Cum văd conversațiile vechi?",
      a: "Toate conversațiile (nu doar cele recente) sunt disponibile în secțiunea Mesaje (/mesaje) - nu se arhivează automat pe bază de vechime. Le poți căuta după nume/telefon/email/numele magazinului sau conținutul ultimului mesaj, dacă lista e lungă.",
    },
    {
      q: "Cum folosesc mesajele din bula flotantă?",
      a: "Bula flotantă are un al doilea buton, „Mesaje”, care deschide un panou rapid cu conversațiile tale cu clienții (fără filtre sau funcții avansate). De acolo, „Deschide toate mesajele” te duce la pagina completă.",
    },
    {
      q: "Primesc notificare când primesc un mesaj nou?",
      a: "Da, primești o notificare în platformă când cineva îți trimite un mesaj sau un atașament nou, cu link direct către acea conversație.",
    },
  ],

  unavailableFeatures: [
    "Trimiterea de fișiere/documente (altele decât imagini) ca atașament în mesaje.",
    "Ștergerea definitivă și reciprocă a unui mesaj (din vederea ambilor participanți) - ștergerea e mereu doar din perspectiva ta.",
    "Arhivarea conversațiilor vendor-to-vendor (arhivarea există doar pentru conversațiile cu clienți).",
  ],

  notes:
    "Sursă: vendorMessageRoutes.js, userMessagesRoutes.js, vendorInboxThreadsRoutes.js. Verificat 2026-08-24. Extins 2026-08-28 (audit GUEST): knowledgeAudience + FAQ contact-vânzător, verificat direct în cod - assistantQuotesRoutes.js montează `router.use(authRequired, enforceTokenVersion)` la nivel de router, cu comentariu explicit \"Pentru cereri de ofertă cerem cont autentificat. Guest poate cumpăra direct în continuare, dar nu poate crea cereri de ofertă.\" (cerere directă la un vânzător = necesită cont); customerRequestsRoutes.js/quotes.manifest.js (createPublicRequest, audience USER+GUEST) confirmă că cererea publică rămâne posibilă fără cont. Extins 2026-09-06 (BATCH 1, audit regression Vendor Assistant - lot Mesaje, 2/23 PASS): adăugat FAQ/capabilities/aliases pentru atașamente (imagini, max 10/25MB, moderare, download prin proxy autenticat - vendorMessageRoutes.js L77-80, 1857-2089, 2094-2173), editare/ștergere mesaj propriu (PATCH/DELETE .../messages/:mid, ambele fișiere de rută, simetric user/vendor), retry idempotent (clientMessageId, useMessageSend.js), mesagerie vendor-to-vendor (ensure-vendor-thread + vendor-threads*, vendorMessageRoutes.js L2278-2825), căutare conversații (param `q` pe /threads și /vendor-threads), arhivare (doar CUSTOMER, PATCH .../archive), mini-mesaje FloatingHub (MiniMessages.jsx + FloatingHub.jsx L342-345, buton secundar „Mesaje”), notificări in-app la mesaj/atașament nou (createUserNotification, vendorMessageRoutes.js L1453-1466, 2060-2076). NU s-a adăugat FAQ pentru trimitere fișiere non-imagine sau ștergere completă bidirecțională - confirmat că NU există în cod (unavailableFeatures). LIVE DATA: unread-count (GET /api/inbox/unread-count) și threads?scope=unread EXISTĂ ca endpoint-uri reale dar NU sunt conectate la Vendor Assistant - handler-ul EXISTING_FLOW/QUERY_LIVE_DATA din copilotRouter.js (linia ~2411) e limitat explicit la \"produse, costuri, comenzi\" și nu include mesaje; raportat ca MISSING_LIVE_TOOL, nu construit tool nou în această etapă (vezi raport BATCH 1). Nu s-a modificat classifierul, runtime-ul, business logic-ul de mesagerie, paginarea sau idempotency-ul.",
};
