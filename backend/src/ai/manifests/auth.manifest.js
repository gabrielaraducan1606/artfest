// backend/src/ai/manifests/auth.manifest.js

export const AUTH_MANIFEST = {
  id: "auth-account",

  title: "Autentificare și cont",

  audience: ["USER", "VENDOR", "GUEST", "ADMIN"],

  available: true,
  status: "ACTIVE",

  description:
    "Înregistrare, autentificare (email/parolă și Google), verificare email, resetare parolă, ștergere cont - și, la fel de important pentru un vizitator, CÂND chiar e nevoie de cont pe Artfest (mult mai rar decât s-ar crede: browsing, căutare, coș și chiar finalizarea unei comenzi funcționează integral fără cont).",

  tags: [
    "login",
    "parola",
    "cont",
    "autentificare",
    "inregistrare",
    "signup",
    "google",
    "verificare email",
    "sterge cont",
    "cand am nevoie de cont",
    "trebuie cont",
    "guest checkout",
    "cumpar fara cont",
    "coșul se salvează după login",
  ],

  aliases: [
    "cum imi schimb parola",
    "mi-am uitat parola",
    "cum ma autentific cu google",
    "cum imi sterg contul",
    "il mai pot recupera",
    "pot recupera contul sters",
    "stergerea contului meu de cumparator este reversibila",
    "ce se intampla cu contul meu de cumparator dupa stergere",
    "nu am primit emailul de verificare",
    "cum imi fac cont",
    "cum ma inregistrez",
    "trebuie cont pentru a cumpara",
    "pot cumpara fara cont",
    "cand am nevoie de cont pe artfest",
    "ce pot face fara cont",
    "ce pot face doar cu cont",
    "ce functii primesc in plus daca imi fac cont",
    "ce se intampla cu cosul cand ma loghez",
    "produsele din cos raman dupa ce ma loghez",

    /*
     * Gap 2026-09-04 (audit Setări Vendor) - schimbarea emailului de
     * cont (distinctă de parolă) nu era documentată deloc.
     */
    "cum schimb emailul contului",
    "cum schimb emailul de login",
    "vreau sa schimb emailul cu care ma autentific",
    "cum imi schimb adresa de email",
  ],

  uiLocations: [
    { audience: "GUEST", path: "/autentificare" },
    { audience: "GUEST", path: "/inregistrare" },
    { audience: "GUEST", path: "/verify-email" },
    { audience: "GUEST", path: "/reset-parola" },
    { audience: "USER", path: "/cont" },
  ],

  capabilities: {
    emailPasswordLogin: { available: true },
    emailPasswordSignup: { available: true },
    googleLogin: { available: true },
    passwordReset: { available: true },
    emailVerification: { available: true },
    changePassword: { available: true },
    deleteAccount: { available: true },

    guestCheckout: {
      available: true,

      notes:
        "Un vizitator poate finaliza o comandă completă (inclusiv plata) FĂRĂ cont - rute backend dedicate, separate de cele autentificate (checkout/guest/quote, checkout/guest/place).",
    },

    guestCartMergeOnLogin: {
      available: true,

      notes:
        "Dacă un vizitator are produse în coș (salvate local, în browser) și apoi își face cont/se autentifică, coșul local se mută automat în contul nou - nu se pierde nimic.",
    },

    /*
     * Gap 2026-09-04 (audit Setări Vendor) - verificat direct în cod
     * (vendorSettingRoutes.js). Flow VENDOR-specific - nu am verificat
     * dacă USER are un echivalent identic, deci nu presupun asta aici.
     */
    changeAccountEmail: {
      available: true,
      status: "ACTIVE",
      audience: ["VENDOR"],

      notes:
        "Din /setari?tab=security: vendorul introduce emailul nou și parola curentă (pentru confirmare). Sistemul trimite un link de confirmare la adresa NOUĂ - emailul contului se schimbă efectiv abia după accesarea acelui link (token valabil 24h). Până la confirmare, contul rămâne pe emailul vechi.",
    },
  },

  limitations: [],

  flows: [
    {
      name: "resetare parolă",
      steps: [
        "cerere resetare (email)",
        "primire link/cod",
        "setare parolă nouă",
      ],
    },

    {
      name: "coșul unui vizitator, la autentificare",
      steps: [
        "vizitatorul adaugă produse în coș fără cont (salvat local, în browser)",
        "se autentifică sau își creează un cont",
        "coșul local se trimite automat către server și se unește cu contul",
        "coșul local se golește - de-acum coșul e cel din cont",
      ],
    },
  ],

  integrations: {
    google: { available: true, status: "ACTIVE" },
  },

  endpoints: {
    signup: {
      method: "POST",
      path: "/api/auth/signup",
      purpose: "Creează un cont nou (email și parolă).",
      audience: ["GUEST"],
    },

    login: {
      method: "POST",
      path: "/api/auth/login",
      purpose: "Autentificare cu email și parolă.",
      audience: ["GUEST"],
    },

    googleLogin: {
      method: "POST",
      path: "/api/auth/google",
      purpose: "Autentificare/înregistrare cu Google.",
      audience: ["GUEST"],
    },

    guestCheckoutQuote: {
      method: "POST",
      path: "/api/checkout/guest/quote",
      purpose: "Calculează totalul comenzii (transport, produse) fără cont.",
      audience: ["GUEST"],
    },

    guestCheckoutPlace: {
      method: "POST",
      path: "/api/checkout/guest/place",
      purpose: "Plasează efectiv comanda, fără cont.",
      audience: ["GUEST"],
    },

    cartMerge: {
      method: "POST",
      path: "/api/cart/merge",
      purpose: "Mută automat coșul local (guest) în contul nou, la autentificare.",
      audience: ["USER"],
    },

    changePassword: {
      method: "POST",
      path: "/api/account/change-password",
      purpose: "Schimbă parola contului autentificat.",
      audience: ["USER", "VENDOR"],
    },

    vendorChangeEmailRequest: {
      method: "POST",
      path: "/api/vendor/settings/account/change-email",
      purpose: "Cere schimbarea emailului de cont (necesită parola curentă) - trimite link de confirmare pe emailul nou.",
      audience: ["VENDOR"],
    },

    vendorChangeEmailConfirm: {
      method: "GET",
      path: "/api/vendor/settings/account/change-email/confirm",
      purpose: "Confirmă schimbarea emailului (link din email, public - nu necesită autentificare).",
      audience: ["VENDOR"],
    },

    /*
     * ADĂUGAT (audit Guest, 2026-09-08) - confirmat direct în cod
     * (userSettingsRoutes.js, montat la /api/account) - USER obișnuit
     * are ACELAȘI mecanism ca vendorul, nu unul diferit. Rezolvă
     * incertitudinea semnalată anterior ("nu am verificat dacă USER
     * are un flow identic").
     */
    userChangeEmailRequest: {
      method: "POST",
      path: "/api/account/change-email",
      purpose: "Cere schimbarea emailului de cont (necesită parola curentă) - trimite link de confirmare pe emailul nou. Identic ca mecanism cu fluxul de vendor.",
      audience: ["USER"],
    },

    userUpdateProfile: {
      method: "PATCH",
      path: "/api/account/me/profile",
      purpose: "Schimbă prenumele/numele contului.",
      audience: ["USER"],
    },

    /*
     * CORECTAT (audit USER Batch 1, 2026-09-08) - path-ul vechi
     * ("/api/account") era greșit, și mecanismul NU e unificat între
     * USER și VENDOR - sunt două fluxuri diferite, verificate separat:
     * - USER: DELETE /api/account/me (accountDeleteRoutes.js) - ștergere
     *   imediată, FĂRĂ pas de confirmare pe email, folosită real de
     *   UserSettingsPage.jsx.
     * - VENDOR: POST /api/vendor/settings/account/deactivate/request +
     *   confirmare pe email (vezi vendorStoreProfile.manifest.js) -
     *   flux diferit, cu anonimizare.
     * BUSINESS_LOGIC_BUG CONFIRMAT, PENDING (raportat separat, nu
     * reparat în acest batch): fluxul USER poate eșua pentru un cont cu
     * recenzii (constrângere de bază de date lipsă pe relația Review-
     * User). NU expune acest detaliu tehnic în knowledge - vezi FAQ de
     * mai jos, formulare prudentă.
     */
    deleteAccountUser: {
      method: "DELETE",
      path: "/api/account/me",
      purpose: "Șterge contul utilizatorului (cumpărător) autentificat.",
      audience: ["USER"],
    },
  },

  faq: [
    {
      q: "Cum îmi schimb parola?",
      a: "Din contul tău, la secțiunea de setări, poți schimba parola dacă știi parola actuală. Dacă ai uitat-o, folosește opțiunea de resetare parolă din pagina de autentificare.",
    },

    {
      q: "Cum îmi fac cont pe Artfest?",
      a: "Din pagina de înregistrare, cu email și parolă, sau printr-un singur click cu Google - ambele opțiuni creează direct contul, fără pași suplimentari.",
    },

    {
      q: "Trebuie cont ca să cumpăr?",
      a: "Nu. Poți răsfoi, căuta, adăuga produse în coș și chiar finaliza integral o comandă (inclusiv plata) fără niciun cont. Ai nevoie de cont doar pentru lucruri legate strict de contul tău: să vezi istoricul comenzilor oricând mai târziu, să salvezi produse la favorite, să ceri o ofertă directă unui vânzător, sau să-i scrii un mesaj.",
    },

    {
      q: "Ce se întâmplă cu produsele din coș dacă mă loghez?",
      a: "Nimic nu se pierde - coșul salvat local (fără cont) se mută automat în contul tău, imediat ce te autentifici sau îți creezi unul.",
    },

    {
      q: "Mă pot autentifica cu Google?",
      a: "Da - autentificarea/înregistrarea cu Google e disponibilă, pe lângă email și parolă, printr-un singur click.",
    },
    {
      q: "Cum îmi schimb emailul contului?",
      a: "Din Setări → Securitate (/setari?tab=security), introdu emailul nou și parola curentă pentru confirmare. Îți trimitem un link de confirmare la adresa NOUĂ - emailul contului se schimbă efectiv abia după ce accesezi acel link (valabil 24 de ore).",
    },

    /*
     * FINAL BATCH 3 (audit regression, 2026-09-07) - completate STRICT
     * pe fapte deja confirmate (capability changeAccountEmail de mai
     * sus) - doar formulările exacte care rateau retrieval-ul.
     */
    {
      q: "Trebuie să confirm noul email dacă îl schimb?",
      a: "Da - după ce introduci emailul nou și parola curentă, primești un link de confirmare pe adresa NOUĂ (valabil 24 de ore). Emailul contului se schimbă efectiv abia după ce accesezi acel link - până atunci, contul rămâne pe emailul vechi.",
    },
    {
      q: "Unde sunt setările de securitate?",
      a: "Setări → Securitate (/setari?tab=security) - acolo schimbi parola și emailul contului (cu confirmare pe adresa nouă).",
    },
    {
      q: "Cum îmi schimb numele contului (ca simplu cumpărător, nu vânzător)?",
      a: "Din profilul contului tău - există un endpoint dedicat (PATCH /api/account/me/profile) prin care schimbi prenumele/numele. Mecanismul de schimbare a emailului e identic cu cel de la vânzător: parola curentă + confirmare pe adresa nouă.",
    },
    {
      q: "Cum schimb numărul de telefon al contului?",
      a: "Nu am găsit, în cod, un endpoint dedicat pentru schimbarea telefonului CONTULUI (câmpul phone există pe profilul de user, dar fără un flux de editare confirmat) - nu confund asta cu telefonul de CONTACT/livrare dintr-o comandă, care se completează separat la fiecare comandă.",
    },

    /*
     * ADĂUGAT (audit USER Batch 1, 2026-09-08) - verificat direct în
     * userSettingsRoutes.js, PATCH /api/account/me/profile: gestionează
     * STRICT firstName/lastName/avatarUrl - nu are câmp pentru city sau
     * address (User nu are deloc un câmp "address" în schema, doar
     * "city"). Preferences: doar notificări, via /me/notifications.
     */
    {
      q: "Cum schimb avatarul contului?",
      a: "Din profilul contului tău - același endpoint ca la schimbarea numelui (PATCH /api/account/me/profile) acceptă și avatarUrl. Interfața exactă din Setări pentru upload de imagine nu e detaliată aici, dar mecanismul de salvare a URL-ului avatarului e confirmat real.",
    },
    {
      q: "Cum schimb orașul contului?",
      a: "Nu am găsit, în cod, un endpoint prin care să editezi orașul asociat contului tău de cumpărător - câmpul „city” există în baza de date, dar fără un flux de editare confirmat pentru USER.",
    },
    {
      q: "Cum schimb adresa contului?",
      a: "Contul tău nu are o adresă proprie, generală - adresele se completează separat, la fiecare comandă (adresă de livrare/facturare per comandă), nu ca un câmp fix al profilului.",
    },
    /*
     * PRUDENT, INTENȚIONAT (audit USER Batch 1, 2026-09-08) - vezi
     * BUSINESS_LOGIC_BUG PENDING din raportul de batch: fluxul de
     * ștergere pentru USER e diferit de cel de VENDOR și are un
     * comportament neconfirmat complet pentru conturi cu recenzii. NU
     * afirma ferm succes/reversibilitate/soarta recenziilor până nu se
     * rezolvă acel subiect - formulare STRICT prudentă.
     */
    {
      q: "Cum șterg contul meu (cumpărător)?",
      a: "Poți solicita ștergerea contului din Setări. Comportamentul exact al datelor asociate (comenzi, mesaje, recenzii) este în curs de verificare tehnică - pentru detalii sigure despre ce se întâmplă cu ele, contactează echipa Artfest înainte de a solicita ștergerea, dacă ai recenzii lăsate pe platformă.",
    },
    {
      q: "Ștergerea contului meu (cumpărător) este reversibilă?",
      a: "Nu pot confirma ferm acest detaliu momentan - comportamentul exact al ștergerii contului de cumpărător este în curs de verificare tehnică. Pentru o confirmare sigură, contactează echipa Artfest.",
    },
    {
      q: "Cum schimb preferințele contului?",
      a: "Din Setări → Notificări, poți controla exact trei preferințe: notificări in-app pentru mesaje noi, pentru actualizări de comandă și pentru remindere de evenimente. Nu există alte preferințe de cont configurabile confirmate în cod.",
    },
  ],

  unavailableFeatures: [],

  notes:
    "Sursă: authRoutes.js (/signup, /login, /me, /exists, /logout, /forgot-password, /reset-password), authGoogleRoutes.js (/google - login/signup, fără authRequired; /methods și /google/connect - authRequired, pentru un cont deja existent), changePasswordRoutes.js, accountDeleteRoutes.js. Extins 2026-08-28 (audit GUEST): chekoutRoutes.js confirmă rute de checkout PARALELE, fără authRequired (/checkout/guest/quote, /checkout/guest/place) distincte de cele autentificate (/checkout/quote, /checkout/place) - un guest poate plasa o comandă completă fără cont. Cart.jsx (mergeIfNeeded) confirmă merge automat al coșului local -> POST /api/cart/merge, apoi clearGuestCart() - la fiecare încărcare a paginii de coș, dacă userul tocmai s-a autentificat și mai are produse locale. Verificat 2026-08-24, extins 2026-08-28. FIX 2026-09-04 (audit Setări Vendor): adăugat capability changeAccountEmail + FAQ - flow VENDOR-specific verificat direct în vendorSettingRoutes.js (POST /api/vendor/settings/account/change-email, cu parolă curentă + confirmare pe email nou, token 24h; GET .../change-email/confirm, public). CONFIRMAT (audit Guest, 2026-09-08): USER obișnuit are un flow IDENTIC, verificat direct în userSettingsRoutes.js (montat la /api/account) - POST /change-email (parolă curentă + confirmare pe email nou) și PATCH /me/profile (firstName/lastName). Schimbarea numărului de telefon al CONTULUI (câmpul phone de pe User) nu are niciun endpoint de editare confirmat în cod.",
};
