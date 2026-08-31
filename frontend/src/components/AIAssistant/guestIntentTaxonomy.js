// src/components/AIAssistant/guestIntentTaxonomy.js

/*
 * =========================================================================
 * TAXONOMIE GENERALĂ DE INTENȚII - WIDGET GUEST/USER (AiAssistant.jsx)
 * =========================================================================
 *
 * Motivul acestui fișier: înainte, clasificarea mesajelor libere din
 * AiAssistant.jsx trăia ca un lanț lung de `if`-uri cu regex ad-hoc, unul
 * per "bug raportat" (vezi istoricul git al `detectAssistantIntent`) - de
 * fiecare dată când o formulare nouă eșua, soluția era un regex nou, ceea
 * ce nu se termină niciodată (sute de fraze posibile, o mână de reguli
 * scrise de mână). Acest fișier e o încercare deliberată de a opri acel
 * ciclu: un set MIC și STABIL de 7 intenții generale, un tabel de reguli
 * DETERMINISTE (nu un if per propoziție - fiecare regulă acoperă un
 * CONCEPT, nu o frază), și un fallback explicit la clasificarea LLM
 * existentă (copilotRouter.js / assistantChatRoutes.js) pentru orice nu
 * se potrivește clar determinist.
 *
 * Arhitectură (rule-based first, LLM second, clarify third):
 *
 *   mesaj
 *     -> PASUL 1: classifyGuestIntentDeterministic(mesaj)
 *        parcurge GUEST_INTENT_RULES în ordine, întoarce PRIMA regulă
 *        care se potrivește (intent + confidence 0.9 fix, determinist,
 *        fără LLM) sau { intent: null, confidence: 0 } dacă nimic nu se
 *        potrivește clar.
 *     -> PASUL 2 (doar dacă Pasul 1 n-a decis): apelantul (AiAssistant.jsx)
 *        cheamă copilotul backend (askCopilot -> copilotRouter.js), care
 *        clasifică prin LLM într-una din cele 10 categorii proprii -
 *        mapBackendCategoryToGuestIntent() traduce ORICE categorie
 *        backend înapoi în una din cele 7 intenții de aici, ca restul
 *        aplicației (CTA, metrici, teste) să lucreze cu UN SINGUR
 *        vocabular, indiferent care strat a răspuns efectiv.
 *     -> PASUL 3: dacă nici LLM-ul nu e sigur (confidence mic / eroare),
 *        se ajunge la CLARIFY - o întrebare de clarificare, NU o
 *        ghicire.
 *
 * NU vrem 30 de intenții mici - vezi GUEST_INTENTS mai jos: doar 7.
 * NU vrem regex per propoziție - fiecare regulă din GUEST_INTENT_RULES
 * acoperă un concept întreg (ex. "orice cere explicit o ofertă", nu
 * "vreau o ofertă pentru produsul X" ca frază fixă).
 * NU vrem router bazat DOAR pe LLM - PASUL 1 rezolvă determinist marea
 * majoritate a cazurilor clare (preț, întrebare, verb de navigare,
 * "caut/găsește/recomandă", cuvinte de suport), fără niciun apel de
 * rețea.
 */

/* =========================================================================
   TAXONOMIA
========================================================================= */

export const GUEST_INTENTS = {
  PLATFORM_KNOWLEDGE: "PLATFORM_KNOWLEDGE",
  PRODUCT_DISCOVERY: "PRODUCT_DISCOVERY",
  QUOTE_DISCOVERY: "QUOTE_DISCOVERY",
  NAVIGATION: "NAVIGATION",
  ACCOUNT_ACTION: "ACCOUNT_ACTION",
  SUPPORT: "SUPPORT",
  CLARIFY: "CLARIFY",
};

/*
 * Bucket AUXILIAR, în afara celor 7 - conversație casuală ("salut",
 * "mulțumesc") nu e nici PLATFORM_KNOWLEDGE, nici CLARIFY (nu e nimic
 * ambiguu de clarificat) - dar nici nu merită o a 8-a intenție "reală"
 * în taxonomie, ar contamina metricile cerute (% PLATFORM_KNOWLEDGE
 * etc. ar trebui calculate DOAR pe întrebări substanțiale). Tratat
 * separat, explicit, exclus din numărătoarea celor 7.
 */
export const CHAT_SMALLTALK = "CHAT_SMALLTALK";

/* =========================================================================
   NORMALIZARE + DETECTOARE DE FORMĂ (reutilizate din explainIntent.js)
========================================================================= */

import {
  normalizeForIntentDetection,
  isExplainIntentMessage,
  isLikelyExplainQuestion,
} from "./explainIntent.js";

export { normalizeForIntentDetection };

/*
 * O propoziție e "explicativă" (întrebare despre CUM/CINE/CE/UNDE
 * funcționează ceva) dacă se potrivește cu ORICARE din cele două
 * semnale complementare deja construite:
 * - isExplainIntentMessage: prefixe explicite cunoscute ("cum", "cine",
 *   "unde", "ce este"...) - rapid, fără ambiguitate.
 * - isLikelyExplainQuestion: regulă GENERALĂ pe forma propoziției
 *   (se termină cu "?" și nu începe cu un verb imperativ cunoscut) -
 *   acoperă formulări noi, neanticipate, fără listă de prefixe.
 */
/*
 * Exportat (audit) - reutilizat de AiAssistant.jsx pentru a distinge
 * un follow-up scurt de o întrebare reală într-o căutare activă
 * (vezi handleSubmit) - NICIO regulă/comportament schimbat aici,
 * doar vizibilitate în plus pentru o funcție deja existentă.
 */
export function isQuestionLike(rawText) {
  const normalized = normalizeForIntentDetection(rawText);
  return (
    isExplainIntentMessage(normalized) ||
    isLikelyExplainQuestion(rawText)
  );
}

/* =========================================================================
   TOLERANȚĂ LA TYPO - normalizare ușoară, NU fuzzy matching agresiv
=========================================================================

   Cerință explicită: "nu adăuga regex pentru fiecare typo" și "nu vreau
   fuzzy matching agresiv care poate transforma cuvinte greșite în alt
   intent". Ce facem aici e strict opus unui regex-per-typo: UN singur
   algoritm generic (distanță Damerau-Levenshtein, cu transpoziții -
   acoperă și typo-uri de tip "perosnalizare", nu doar litere lipsă),
   aplicat DOAR împotriva unei liste MICI de cuvinte-cheie IMPORTANTE
   (cele de care depind regulile determinste de mai jos), NU un
   dicționar general. Corectează un cuvânt DOAR dacă:
   - are cel puțin 5 litere (cuvintele scurte au risc mare de coliziune
     falsă - "cos" vs "cost" ar fi distanță 1, dar complet alte cuvinte);
   - distanța până la exact UN cuvânt-cheie e ≤ 1 (2 potriviri egale =
     ambiguu, nu corectăm, mai bine lăsăm mesajul intact spre LLM).
*/
const COMMON_KEYWORD_VOCABULARY = [
  "comanda",
  "comenzi",
  "personalizare",
  "personalizat",
  "livrare",
  "oferta",
  "produsul",
  "produse",
  "disponibil",
  "autentificare",
  "autentific",
  "favorite",
  "contul",
  "stoc",
  "vanzator",
  "retur",
  "plata",
  "problema",
  "deschide",
];

/*
 * Damerau-Levenshtein restrâns (optimal string alignment) - suficient
 * pentru cuvinte scurte/medii, permite și transpoziția a două litere
 * adiacente ca UN singur pas (nu doi, ca în Levenshtein clasic) - exact
 * tiparul din "perosnalizare" (r și o inversate).
 */
function restrictedEditDistance(a, b, maxDistance) {
  const al = a.length;
  const bl = b.length;

  if (Math.abs(al - bl) > maxDistance) return maxDistance + 1;

  const d = Array.from({ length: al + 1 }, () =>
    new Array(bl + 1).fill(0)
  );

  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );

      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }

  return d[al][bl];
}

const MIN_WORD_LENGTH_FOR_TYPO_CORRECTION = 5;
const MAX_TYPO_DISTANCE = 1;

function correctWordIfCommonTypo(word) {
  if (word.length < MIN_WORD_LENGTH_FOR_TYPO_CORRECTION) return word;
  if (COMMON_KEYWORD_VOCABULARY.includes(word)) return word;

  let matched = null;

  for (const keyword of COMMON_KEYWORD_VOCABULARY) {
    if (
      restrictedEditDistance(word, keyword, MAX_TYPO_DISTANCE) <=
      MAX_TYPO_DISTANCE
    ) {
      if (matched && matched !== keyword) {
        /* Ambiguu (la fel de aproape de 2 cuvinte diferite) - nu corectăm. */
        return word;
      }

      matched = keyword;
    }
  }

  return matched || word;
}

/**
 * Aplică normalizarea ușoară cerută (lowercase/diacritice/spații/
 * punctuație - deja făcute de normalizeForIntentDetection) + corectarea
 * conservatoare de typo pe cuvinte-cheie comune. Folosită DOAR ca
 * pregătire pentru regulile determinste - textul afișat userului sau
 * trimis mai departe la căutare/LLM rămâne neschimbat (raw).
 */
export function normalizeWithTypoTolerance(rawText) {
  const normalized = normalizeForIntentDetection(rawText);
  if (!normalized) return normalized;

  return normalized
    .split(" ")
    .map(correctWordIfCommonTypo)
    .join(" ");
}

/* =========================================================================
   EXTRAGERE PREȚ (reutilizată/consistentă cu assistantProducts.js)
========================================================================= */

const MAX_PRICE_LEI_RE =
  /\b(?:sub|pana(?: in| la)?|până(?: în| la)?|maxim|max|cu)\s+(\d+(?:[.,]\d+)?)\s*(?:lei|ron)\b/i;

export function extractMaxPriceCents(rawText) {
  const match = MAX_PRICE_LEI_RE.exec(String(rawText || ""));
  if (!match) return null;

  const lei = Number(match[1].replace(",", "."));
  if (!Number.isFinite(lei) || lei <= 0) return null;

  return Math.round(lei * 100);
}

/* =========================================================================
   PASUL 1 - REGULI DETERMINISTE (câte una per CONCEPT, nu per frază)
========================================================================= */

/*
 * SUPPORT - semnale de problemă/eșec raportat. Verificat PRIMUL - un
 * user care are o problemă reală nu trebuie să treacă prin nicio altă
 * euristică înainte să ajungă la ajutor.
 */
/*
 * BUGFIX (audit, testat automat) - "nu îmi merge plata"/"nu îți
 * încarcă pagina" inserează un pronume ("imi"/"iti"/"ne"/"le") între
 * "nu" și verb - un literal "nu merge" fix rata aceste formulări
 * (frecvente) complet, deși erau exact cazul-manual din exemplele
 * anterioare ("Nu îmi merge plata"). Pronume opțional, nu obligatoriu.
 */
/*
 * BUGFIX (audit, set greu) - "ajutor"/"suport" (cerere directă de
 * ajutor, "Am nevoie de ajutor") lipseau complet față de versiunea
 * originală (dinainte de taxonomie) - regresie reală, nu doar un caz
 * netestat. "problem\w*" (stem) în loc de "am o problema" (frază
 * fixă) - acoperă și "am o problemă"/"probleme" fără "am o" înainte.
 */
const SUPPORT_RE =
  /\bnu\s+(imi\s+|iti\s+|ne\s+|le\s+|se\s+)?(merge|functioneaza|incarca)\b|\b(ajutor|suport|eroare|blocat|blocheaza|problem\w*|nu pot (sa )?(comand|platesc|adaug|trimit)|a esuat|nu am reusit)\b/;

/*
 * BUGFIX (audit, set greu) - varianta de mai sus e pozițională ("nu"
 * chiar ÎNAINTE de verb) - o inversare completă de cuvinte ("plata
 * merge îmi Nu") o rată complet, deși semnalul de negație tot există.
 * Verificare SUPLIMENTARĂ, pe SET de cuvinte (oricare ordine) - "nu"
 * + un verb de funcționare, oriunde în mesaj.
 */
function hasScrambledSupportSignal(normalized) {
  const hasNegation = /\bnu\b/.test(normalized);
  const hasBrokenVerb = /\bmerge\b|\bfunctioneaza\b|\bincarca\b/.test(
    normalized
  );

  return hasNegation && hasBrokenVerb;
}

/*
 * NAVIGATION - verb de navigare EXPLICIT (imperativ, la începutul
 * mesajului) + un cuvânt-cheie de pagină cunoscută. Determinist limitat
 * intenționat la pagini reale, publice, verificate în App.jsx - o
 * cerere spre o pagină necunoscută nu inventează un URL, cade la
 * PLATFORM_KNOWLEDGE (explică unde se găsește, în text).
 */
/*
 * BUGFIX (audit, testat automat) - normalizeForIntentDetection
 * elimină TOATĂ punctuația, inclusiv cratima ("du-mă" -> "du ma",
 * "arată-mi" -> "arata mi") - un literal cu cratimă ("du-ma") nu se
 * potrivea NICIODATĂ cu textul normalizat, deci regula de NAVIGATION
 * nu se declanșa deloc. Toate variantele verificate pe forma
 * POST-normalizare (spații, nu cratime).
 */
const NAVIGATION_VERB_RE =
  /^(du ma|dute|mergi|navigheaza|deschide|arata mi (pagina|sectiunea)|vreau sa ajung)\b/;

/*
 * BUGFIX (audit, extindere acțiuni) - fiecare intrare duce acum la un
 * TARGET semantic din assistantActionRegistry.js (backend/sursă de
 * adevăr pentru rută/rol/auth), NU un path direct - taxonomia alege
 * DOAR target-ul, codul (AiAssistant.jsx, resolveAssistantAction)
 * decide dacă/cum se execută. Ordinea contează: variantele "mele"
 * (personale) sunt verificate ÎNAINTEA celor generice, ca "cererile
 * mele" să nu cadă pe target-ul public PUBLIC_REQUESTS.
 */
/*
 * BUGFIX (audit, testat live) - "du-mă la comenzi" (fără "mele") nu
 * se potrivea cu NICIUN target - doar forma "comenzile mele" era
 * acoperită. Adăugat "comen\w*" generic (comenzi/comandă/comenzile),
 * separat de varianta "mele" din ACCOUNT_ACTION (aceea rămâne mai
 * specifică, verificată separat, cu prioritate mai mare - vezi
 * account-action-order-status).
 *
 * `allowArataVerb` - "arată-mi" e AMBIGUU structural: pentru
 * target-uri "personale" (comenzi/cereri/mesaje/favorite/profil/
 * setări/facturi), "arată-mi X" înseamnă clar navigare - dar pentru
 * target-uri de marketplace (produse/categorii/magazine/coș/colecții),
 * "arată-mi X" e deja un declanșator STABIL de PRODUCT_DISCOVERY
 * (ex. "arată-mi decorațiuni de botez") - a permite "arată-mi" ca
 * verb de navigare ȘI acolo ar sparge acea căutare (ar deveni
 * navigare spre pagina generică /produse, nu o căutare filtrată).
 * Steagul ține cele două cazuri separate, fără să afecteze regula
 * deja testată pentru PRODUCT_DISCOVERY.
 */
/*
 * Interes de a deveni vânzător - verificat ÎNAINTEA target-urilor
 * generice de marketplace (STORES pe "magazin", PRODUCTS pe "vreau" -
 * vezi product-discovery-imperative) - altfel "vreau să îmi deschid
 * magazin"/"vreau să vând" cădeau pe STORES (răsfoiește magazine
 * publice) sau pe PRODUCT_DISCOVERY (căutare), nu pe intenția reală.
 * "de" opțional în "cont (de) vânzător"/"cont (de) creator" - acoperă
 * și forma trunchiată ("cont creator"). Exportat mai jos
 * (isVendorSignupInterest) - folosit și de AiAssistant.jsx pentru a
 * decide dacă atașează CTA-ul "Creează cont de vânzător" după un
 * răspuns de knowledge.
 */
const VENDOR_SIGNUP_TOPIC_RE =
  /\bcont\s+(de\s+)?vanzator\b|\bcont\s+(de\s+)?creator\b|\bdevin\w*\s+vanzator\b|\bvand\w*|\bmagazin propriu\b|\bimi\s+(deschid|fac)\w*\s+magazin\w*\b|\bvreau\s+(un\s+)?magazin\b|\bcreare\s+cont\s+(de\s+)?vanzator\b|\bcreez\s+cont\s+(de\s+)?vanzator\b|\binregistrare\s+(de\s+|ca\s+)?vanzator\b/;

export function isVendorSignupInterest(text) {
  return VENDOR_SIGNUP_TOPIC_RE.test(normalizeForIntentDetection(text));
}

const NAVIGATION_TARGETS = [
  {
    re: VENDOR_SIGNUP_TOPIC_RE,
    target: "VENDOR_SIGNUP",
    allowArataVerb: false,
  },
  { re: /\bfavorit/, target: "FAVORITES", allowArataVerb: true },
  /*
   * BUGFIX (audit, verificare independentă) - "comen\w*" ar fi
   * potrivit și "comentariu"/"comentarii" (comen-TARIU, aceleași
   * prime 5 litere) - restrâns la radicalii REALI de
   * "comandă"/"comenzi" (comand-/comenz-), care nu se suprapun cu
   * "coment-".
   */
  {
    re: /\bcomand\w*|\bcomenz\w*/,
    target: "USER_ORDERS",
    allowArataVerb: true,
  },
  { re: /\bcererile mele\b/, target: "USER_REQUESTS", allowArataVerb: true },
  { re: /\bmesaj/, target: "USER_MESSAGES", allowArataVerb: true },
  /*
   * BUGFIX (audit, regresie găsită la regresie) - "contul meu" a fost
   * SCOS de aici (rămâne DOAR "profil") - se suprapunea cu
   * ACCOUNT_ACTION_RE, care are deja propriul pattern "contul( meu)?"
   * și rulează la prioritate #3. Cu allowArataVerb:true și "contul
   * meu" prezent aici, navigation-explicit (#2) câștiga cursa pentru
   * "Arată-mi contul meu" ÎNAINTEA lui account-action, schimbând
   * eticheta de intent din ACCOUNT_ACTION în NAVIGATION - rezultatul
   * final (target USER_PROFILE, aceeași navigare) era identic, dar
   * eticheta greșită strica testele de regresie. "profil" (fără
   * "contul meu") acoperă în continuare "arată-mi profilul" - nu s-a
   * pierdut nicio acoperire, doar eliminată suprapunerea.
   */
  {
    re: /\bprofil/,
    target: "USER_PROFILE",
    allowArataVerb: true,
  },
  { re: /\bsetari/, target: "USER_SETTINGS", allowArataVerb: true },
  { re: /\bfactur/, target: "USER_INVOICES", allowArataVerb: true },
  { re: /\bprodus/, target: "PRODUCTS", allowArataVerb: false },
  { re: /\bcategor/, target: "CATEGORIES", allowArataVerb: false },
  { re: /\bmagazin/, target: "STORES", allowArataVerb: false },
  { re: /\bcos\b/, target: "CART", allowArataVerb: false },
  { re: /\bcolecti\w*/, target: "COLLECTIONS", allowArataVerb: false },
  { re: /\bcererile publice\b|\bcerer/, target: "PUBLIC_REQUESTS", allowArataVerb: true },
];

function matchNavigationTarget(normalized) {
  for (const entry of NAVIGATION_TARGETS) {
    if (entry.re.test(normalized)) return entry;
  }
  return null;
}

/*
 * ACCOUNT_ACTION - referință clară la date/acțiuni PROPRII care cer
 * cont ("comenzile mele", "cererile mele", "favoritele mele", "contul
 * meu") sau intenție explicită de autentificare. Verificat DOAR pe
 * formă IMPERATIVĂ/declarativă (nu întrebare) - "cum îmi văd comenzile
 * mele?" e o întrebare explicativă (PLATFORM_KNOWLEDGE, nu cere login
 * doar ca să afle UNDE), dar "arată-mi comenzile mele" chiar vrea
 * datele -> ACCOUNT_ACTION -> guest e trimis la autentificare.
 */
/*
 * BUGFIX (audit, testat automat) - varianta inițială cerea fraza
 * COMPLETĂ "vreau sa ma loghez" - o formulare trunchiată ("vreau
 * loghez") sau cu ordine schimbată nu se mai potrivea deloc, deși
 * cuvântul-cheie ("loghez"/"logare"/"autentificare") tot era acolo.
 * Verificăm direct cuvântul-radical, indiferent de restul frazei.
 */
/*
 * BUGFIX (audit, set greu) - "contul meu" (frază completă) rata
 * "Arată-mi contul" (fără "meu", trunchiat) - odată ce "arata" a
 * devenit declanșator de PRODUCT_DISCOVERY, mesajul cădea pe căutare.
 * "contul" bare, în formă IMPERATIVĂ (regula rămâne gated pe
 * !ctx.isQuestion), e suficient de specific.
 */
/*
 * BUGFIX (audit, extindere acțiuni) - "favoritele"/"mesajele" bare
 * (fără "mele") adăugate direct - spre deosebire de "comenzile"/
 * "cererile" (care au și un sens PUBLIC/generic - "cererile" publice,
 * vezi PUBLIC_REQUESTS), "favorite"/"mesaje" nu au niciun sens
 * public în aplicație - "arată-mi favoritele"/"arată-mi mesajele"
 * înseamnă mereu datele proprii, chiar fără "mele" explicit.
 */
const ACCOUNT_ACTION_RE =
  /\b(comenzile mele|cererile mele|favoritele( mele)?|contul( meu)?|mesajele( mele)?|autentific\w*|logare|logez|loghez|conecteaza\w*|login)\b/;

/*
 * Mapare la target-ul REAL din assistantActionRegistry.js - verificat
 * în ordinea specificității (comenzile mele înainte de "contul",
 * etc.), ca un mesaj cu mai multe cuvinte-cheie să aleagă cel mai
 * relevant target, nu primul alfabetic.
 */
const ACCOUNT_ACTION_TARGET_PATTERNS = [
  { re: /\bcomenzile mele|\bcomanda mea\b/, target: "USER_ORDERS" },
  { re: /\bcererile mele\b/, target: "USER_REQUESTS" },
  { re: /\bfavoritele\b/, target: "FAVORITES" },
  { re: /\bmesajele\b/, target: "USER_MESSAGES" },
  { re: /\bcontul\b/, target: "USER_PROFILE" },
  {
    re: /\bautentific\w*|\blogare\b|\blogez\b|\bloghez\b|\bconecteaza\w*|\blogin\b/,
    target: "LOGIN",
  },
];

function resolveAccountActionTarget(normalized) {
  for (const entry of ACCOUNT_ACTION_TARGET_PATTERNS) {
    if (entry.re.test(normalized)) return entry.target;
  }
  return null;
}

/*
 * QUOTE_DISCOVERY - cerere EXPLICITĂ de ofertă/variantă alternativă de
 * la vânzător. Distinct de o simplă întrebare EXPLICATIVĂ despre
 * personalizare ("cum funcționează personalizarea?" - aceea e
 * PLATFORM_KNOWLEDGE, verificată separat mai jos, cu prioritate pentru
 * formele-întrebare). Acoperă și "nu găsesc exact ce caut" / "poate
 * face vânzătorul altceva" din taxonomia cerută.
 */
/*
 * BUGFIX (audit, testat automat) - fraze fixe ("vreau o oferta",
 * "o oferta pentru") ratau variante scurtate ("vreau oferta pentru",
 * fără "o") - "oferta" ca simplu cuvânt e deja un semnal suficient de
 * puternic în contextul unui widget de shopping (nu apare des cu alt
 * sens), fără să mai cerem restul frazei exacte.
 */
const QUOTE_DISCOVERY_RE =
  /\boferta\b|\balta varianta\b|\balta culoare decat\b|\bpoate (face|realiza) vanzatorul\b|\bcomanda speciala\b|\bpersonalizat la cerere\b/;

/*
 * BUGFIX (audit, testat automat) - "nu găsesc exact ce caut" ca frază
 * fixă se pierde complet la inversarea ordinii cuvintelor (mesaj
 * trunchiat/reformulat neobișnuit). Verificare pe SET de cuvinte
 * (oricare ordine), nu pe frază contiguă - mai robustă la exact acest
 * tip de degradare, cerută explicit ("cuvinte inversate").
 */
function hasQuoteMismatchSignal(normalized) {
  const hasNu = /\bnu\b/.test(normalized);
  const hasExactOrGasesc = /\bexact\b|\bgasesc\b|\bgasesti\b/.test(
    normalized
  );

  return hasNu && hasExactOrGasesc;
}

/*
 * Cuvinte-temă de PLATFORM_KNOWLEDGE - domenii/concepte ale platformei,
 * NU obiecte de cumpărat. Prezența unuia dintre acestea într-o
 * propoziție-întrebare arată clar că userul vrea o EXPLICAȚIE, nu o
 * căutare - inclusiv când propoziția conține cuvântul "produs" (vezi
 * regula #3 - "produs" NU înseamnă automat căutare).
 */
/*
 * BUGFIX (audit, set greu) - extins cu cuvinte-temă găsite lipsă la
 * testarea pe formulări FĂRĂ semn de întrebare/colocviale: "transport"
 * (sinonim comun pentru livrare), "colectie/colectii", "categorii",
 * "ale voastre"/"ale artfest" (întrebare de proprietate - "produsele
 * sunt ale voastre?"), "vind\w*" generalizat (stem, nu doar fraza
 * fixă "cine vinde" - acoperă "voi vindeți?", "vinde cineva aici?").
 */
/*
 * BUGFIX (audit, set greu) - "livrar\w*" nu acoperea forma de VERB
 * ("livrează"/"livreaza" - radical "livr", diferit de "livrar", cel
 * al substantivului "livrare") - "Cum se livrează produsul?" pica pe
 * search doar pentru că "livrează" nu era recunoscut ca temă. Aceeași
 * problemă pentru "avans" ("avansul" nu se potrivea, \b final cerea
 * cuvânt întreg) și "retur" ("returnez" nu se potrivea). Toate 3
 * convertite la radical cu \w*. Adăugat și "aveti voi"/"aveti chiar
 * voi" (întrebare de proprietate, cerută explicit ca reformulare -
 * "Aveți voi produsele?") și "reducer\w*"/"discount\w*" (promoții).
 */
/*
 * BUGFIX (audit, cont vânzător) - "vand\w*" (1a pers. - "vând"/"vand",
 * radical DIFERIT de "vind\w*"/3a pers. deja prezent) adăugat direct
 * aici; restul frazelor de interes vendor-signup vin din
 * VENDOR_SIGNUP_TOPIC_RE (.source), ca să nu dubleze patternul -
 * fără asta, "Vreau să vând pe Artfest"/"Cum îmi fac magazin..."
 * cădeau pe explain-generic (funcționează, dar fără topicId specific
 * pentru CTA) sau, în formă imperativă, pe PRODUCT_DISCOVERY.
 */
const PLATFORM_TOPIC_RE = new RegExp(
  `\\b(stoc|epuizat|disponibil\\w*|livr\\w*|transport\\w*|expedia\\w*|curier|colet|awb|comanda speciala|realizat la comanda|la comanda|precomand\\w*|personalizare|personalizat\\w*|plata|ramburs|avans\\w*|retur\\w*|garantie|cont(?!act)|mesaj|contactez|vorbesc cu vanzatorul|vind\\w*|vand\\w*|vanzator\\w*|creator\\w*|marketplace|artfest|colecti\\w*|categori\\w*|ale voastre|ale artfest|aveti\\s+(chiar\\s+)?voi|reducer\\w*|discount\\w*)\\b|${VENDOR_SIGNUP_TOPIC_RE.source}`
);

/*
 * BUGFIX (audit, testat automat) - varianta STRICTĂ, folosită DOAR ca
 * excludere pentru regula imperativă de mai jos (product-discovery-
 * imperative), EXCLUDE deliberat "personalizare"/"personalizat" din
 * lista de cuvinte-temă: e SINGURUL cuvânt din PLATFORM_TOPIC_RE care
 * apare firesc și într-o cerere REALĂ de cumpărare ("vreau un cadou
 * personalizat" - aici e un adjectiv al obiectului dorit, nu o
 * întrebare despre concept). Toate celelalte cuvinte-temă (stoc,
 * livrare, disponibilitate, expediere, plată, retur, contact
 * vânzător etc.) nu apar firesc într-o propoziție imperativă de
 * cumpărare - rămân excludere validă chiar și în formă imperativă/
 * degradată (fără "?", scurtată, cu ordine schimbată).
 */
const PLATFORM_TOPIC_STRICT_RE = new RegExp(
  `\\b(stoc|epuizat|disponibil\\w*|livr\\w*|transport\\w*|expedia\\w*|curier|colet|awb|comanda speciala|realizat la comanda|la comanda|precomand\\w*|plata|ramburs|avans\\w*|retur\\w*|garantie|cont(?!act)|mesaj|contactez|vorbesc cu vanzatorul|vind\\w*|vand\\w*|vanzator\\w*|creator\\w*|marketplace|artfest|colecti\\w*|categori\\w*|ale voastre|ale artfest|aveti\\s+(chiar\\s+)?voi|reducer\\w*|discount\\w*)\\b|${VENDOR_SIGNUP_TOPIC_RE.source}`
);

/*
 * Obiect de cumpărat concret - folosit ca semnal MARKETPLACE_SEARCH
 * chiar și în forma "cum găsesc X"/"unde găsesc X" (vezi copilotRouter.js,
 * aceeași regulă, generalizată aici la nivel local).
 */
const PURCHASE_OBJECT_RE =
  /\b(cadou\w*|marturi\w*|invitati\w*|lumanar\w*|bijuteri\w*|decoratiun\w*|pentru\s+(nunta|botez|aniversar\w*|petrecer\w*))\b/;

/*
 * PRODUCT_DISCOVERY (formă imperativă/declarativă, nu întrebare) -
 * cuvinte de căutare/cumpărare. "gas" (stem) acoperă găsește/găsesc/
 * găsim etc. EXCLUS explicit dacă mesajul conține un cuvânt-temă de
 * platformă (regula #3 din cerință).
 */
/*
 * BUGFIX (audit, testat automat) - `\b(...|gas|cadou|...)\b` cu `\b`
 * final cerea ca radicalul să fie CUVÂNT ÎNTREG - "gaseste"/"gasesc"
 * (radical "gas" + sufix) sau "cadouri" (radical "cadou" + sufix) NU
 * se potriveau deloc, pentru că nu există graniță de cuvânt ÎNTRE
 * radical și sufixul care urmează imediat. `\w*` după radical
 * consumă orice sufix, iar `\b` de la final ajunge corect la granița
 * REALĂ a cuvântului.
 */
/*
 * BUGFIX (audit, set greu) - "arată-mi decorațiuni de botez" nu se
 * potrivea cu niciun cuvânt din listă ("arata" lipsea) - adăugat ca
 * declanșator de căutare, DAR verificat cu prioritate mai mică decât
 * NAVIGATION (care "consumă" deja "arată-mi pagina/secțiunea X"),
 * deci nu intră în conflict.
 */
const PRODUCT_DISCOVERY_RE =
  /\b(caut\w*|vreau|gas\w*|arata\w*|recomand\w*|cadou\w*|marturi\w*|invitati\w*|lumanar\w*|bijuteri\w*|produs\w*)\b/;

const IMAGE_SEARCH_RE = /\b(poza|fotografie|imagine)\b/;
const IMAGE_SEARCH_VERB_RE = /\b(gas|caut|similar|asemanator|dupa)\b/;

/*
 * Tabel de reguli, în ORDINEA priorității. Fiecare intrare = un
 * CONCEPT (nu o frază), cu un `test(ctx)` determinist. Prima regulă
 * care se potrivește câștigă - nu se mai evaluează restul.
 */
const GUEST_INTENT_RULES = [
  {
    id: "support-signal",
    intent: GUEST_INTENTS.SUPPORT,
    test: (ctx) =>
      SUPPORT_RE.test(ctx.normalized) ||
      hasScrambledSupportSignal(ctx.normalized),
  },

  {
    id: "navigation-explicit",
    intent: GUEST_INTENTS.NAVIGATION,
    test: (ctx) => {
      const matched = matchNavigationTarget(ctx.normalized);
      if (!matched) return false;

      /*
       * Forma ancorată la început ("du-mă la produse") + fallback pe
       * SET de cuvinte, nu poziție - robust și la ordine inversată
       * ("produse la du-mă"), cât timp verbul de navigare apare ca
       * TOKEN, oriunde în mesaj. "arată-mi" e verb de navigare DOAR
       * pentru target-urile care permit asta explicit (allowArataVerb -
       * vezi comentariul de la NAVIGATION_TARGETS) - păstrează
       * "arată-mi produse ieftine" ca PRODUCT_DISCOVERY, nu navigare.
       */
      const hasCoreVerb =
        NAVIGATION_VERB_RE.test(ctx.normalized) ||
        /\b(du|dute|mergi|navigheaza|deschide)\b/.test(ctx.normalized);

      if (hasCoreVerb) return true;

      if (
        Boolean(matched.allowArataVerb) &&
        /\barata\w*\b/.test(ctx.normalized)
      ) {
        return true;
      }

      /*
       * BUGFIX (audit, test matrix) - mențiune GOALĂ, fără niciun
       * verb ("favorite", "mesaje", "profil", "setări", tastate
       * singure) - cerute explicit în matricea de test USER. Permisă
       * DOAR pentru target-urile "personale" (allowArataVerb=true,
       * aceeași listă folosită și mai sus - produse/categorii/
       * magazine/coș/colecții rămân EXCLUSE, ca să nu intre în
       * conflict cu PRODUCT_DISCOVERY pentru un "produse" bar) și
       * DOAR pentru mesaje foarte scurte (≤2 cuvinte).
       *
       * BUGFIX (audit, regresie găsită la regresie, runda 2) -
       * exclus explicit orice frază deja recunoscută de
       * ACCOUNT_ACTION_RE ("comenzile mele" etc.) - aceea rămâne
       * proprietarul semantic mai specific (verificat la prioritate
       * #3), la fel cum "contul meu" a fost scos din
       * NAVIGATION_TARGETS mai devreme. Fără excluderea asta,
       * fallback-ul de aici ar câștiga cursa înaintea lui
       * account-action pentru EXACT aceeași frază, schimbând doar
       * eticheta (comportamentul final e identic), stricând testele.
       */
      if (ACCOUNT_ACTION_RE.test(ctx.normalized)) {
        return false;
      }

      const wordCount = ctx.normalized
        .split(" ")
        .filter(Boolean).length;

      return Boolean(matched.allowArataVerb) && wordCount <= 2;
    },
    extract: (ctx) => {
      const matched = matchNavigationTarget(ctx.normalized);
      return { target: matched?.target || null };
    },
  },

  {
    id: "account-action",
    intent: GUEST_INTENTS.ACCOUNT_ACTION,
    test: (ctx) =>
      !ctx.isQuestion && ACCOUNT_ACTION_RE.test(ctx.normalized),
    extract: (ctx) => ({
      target: resolveAccountActionTarget(ctx.normalized),
    }),
  },

  /*
   * BUGFIX (audit, testat automat) - "Unde este comanda mea?" e
   * grafiată ca întrebare, dar FUNCȚIONAL userul vrea date live
   * despre comanda lui, nu o explicație generică despre tracking -
   * aceeași excepție există deja, explicit, în copilotRouter.js
   * (backend): "Ce comenzi am?" / "Unde este comanda mea?" = mereu
   * date proprii, NICIODATĂ o explicație generică. Verificat separat
   * de restul ACCOUNT_ACTION (care rămâne gated pe !isQuestion) -
   * "comanda mea"/"comenzile mele" au voie să câștige chiar și în
   * formă de întrebare.
   */
  {
    id: "account-action-order-status",
    intent: GUEST_INTENTS.ACCOUNT_ACTION,
    test: (ctx) =>
      /\bcomanda mea\b|\bcomenzile mele\b/.test(ctx.normalized),
    extract: () => ({ orderActionId: "track-order" }),
  },

  /*
   * Urmărire livrare PROPRIE ("coletul meu", "awb-ul meu", "unde
   * este coletul") - distinct de o întrebare generică despre CUM
   * funcționează livrarea (aceea rămâne PLATFORM_KNOWLEDGE, prin
   * explain-platform-knowledge mai jos). Gated pe pronume posesiv
   * SAU pe "unde este" + cuvânt de livrare, ca să nu intercepteze
   * "Cum funcționează livrarea?" (fără nicio referire personală).
   */
  {
    id: "account-action-delivery-tracking",
    intent: GUEST_INTENTS.ACCOUNT_ACTION,
    test: (ctx) =>
      /\b(coletul|awb-?ul)\s+meu\b|\bunde\s+(e|este)\b.*\b(colet|awb|curier)\w*\b/.test(
        ctx.normalized
      ),
    extract: () => ({ orderActionId: "order-delivery" }),
  },

  {
    id: "quote-discovery",
    intent: GUEST_INTENTS.QUOTE_DISCOVERY,
    test: (ctx) =>
      QUOTE_DISCOVERY_RE.test(ctx.normalized) ||
      hasQuoteMismatchSignal(ctx.normalized),
  },

  {
    id: "image-search",
    intent: GUEST_INTENTS.PRODUCT_DISCOVERY,
    subtype: "image",
    test: (ctx) =>
      IMAGE_SEARCH_RE.test(ctx.normalized) &&
      IMAGE_SEARCH_VERB_RE.test(ctx.normalized),
  },

  /*
   * Formă-întrebare (EXPLAIN) + temă de platformă -> PLATFORM_KNOWLEDGE,
   * chiar dacă mesajul conține "produs" ("cine vinde produsele?",
   * "produsul e disponibil?", "cum se livrează produsul?", "ce se
   * întâmplă dacă produsul e realizat la comandă?" - toate PLATFORM_
   * KNOWLEDGE, NU căutare - vezi regula #3 din cerință).
   */
  {
    id: "explain-platform-knowledge",
    intent: GUEST_INTENTS.PLATFORM_KNOWLEDGE,
    test: (ctx) =>
      ctx.isQuestion && PLATFORM_TOPIC_RE.test(ctx.normalized),
  },

  /*
   * Formă-întrebare + obiect de cumpărat concret, FĂRĂ temă de
   * platformă -> tot căutare ("cum găsesc mărturii pentru nuntă?"),
   * nu explicație despre motorul de căutare.
   *
   * BUGFIX (audit, regresie găsită la runda finală de regresie) -
   * varianta anterioară adăuga PRODUCT_DISCOVERY_RE ca alternativă la
   * PURCHASE_OBJECT_RE, ca să prindă "Mă ajuți să găsesc ceva mai
   * ieftin de tot?" - dar PRODUCT_DISCOVERY_RE include "produs\w*" și
   * "caut\w*" FĂRĂ obiect, deci "Cum caut un produs?" (cerința #A,
   * confirmată explicit: TREBUIE PLATFORM_KNOWLEDGE/SEARCH_HELP, NU
   * căutare directă) pica din nou pe PRODUCT_DISCOVERY - exact
   * regresia pe care fixul din sesiunea 1 o rezolvase. Revenit la
   * DOAR PURCHASE_OBJECT_RE (obiect concret numit) - un verb de
   * căutare FĂRĂ obiect ("găsesc ceva") rămâne, corect, un caz pentru
   * Pasul 2 (LLM), nu o presupunere determinstă.
   */
  {
    id: "explain-marketplace-search",
    intent: GUEST_INTENTS.PRODUCT_DISCOVERY,
    test: (ctx) =>
      ctx.isQuestion &&
      PURCHASE_OBJECT_RE.test(ctx.normalized) &&
      !PLATFORM_TOPIC_RE.test(ctx.normalized),
  },

  /*
   * BUGFIX (audit, testat automat) - "mă ajuți să găsesc ceva sub 100
   * lei?"/"ce găsesc cu 100 lei?" nu numesc niciun obiect de cumpărat
   * concret (regula anterioară, PURCHASE_OBJECT_RE, caută cuvinte ca
   * "cadou"/"mărturii" - "ceva" nu se potrivește cu niciunul), dar UN
   * PREȚ menționat explicit ("sub X lei" etc.) e la fel de puternic un
   * semnal de căutare - fără această regulă, cădeau pe explain-generic
   * (PLATFORM_KNOWLEDGE), deci "nu înțelegea" complet cererea de buget.
   */
  /*
   * BUGFIX (audit, set greu) - fără gate pe ctx.isQuestion: "sub 100
   * lei" sau "buget maxim 50 lei", tastate simplu, fără "?" și fără
   * niciun alt cuvânt de căutare, sunt un semnal de preț la fel de
   * clar indiferent de formă - deferau la LLM degeaba.
   */
  {
    id: "budget-search",
    intent: GUEST_INTENTS.PRODUCT_DISCOVERY,
    test: (ctx) =>
      extractMaxPriceCents(ctx.raw) !== null &&
      !PLATFORM_TOPIC_RE.test(ctx.normalized),
  },

  /*
   * Orice altă formă-întrebare rămâne PLATFORM_KNOWLEDGE implicit -
   * DOAR dacă mesajul are conținut substanțial (nu small talk gol,
   * vezi classifyGuestIntentDeterministic - small talk e filtrat
   * ÎNAINTE să ajungă la regulile astea). O întrebare fără NICIUN
   * cuvânt-temă recunoscut tot merită o încercare de răspuns din
   * knowledge (retrieval-ul din backend decide dacă are într-adevăr
   * ce răspunde), nu o ghicire aici.
   */
  /*
   * BUGFIX (audit, testat automat) - "unde e(ste) comanda (mea)?"
   * trunchiat rămâne ambiguu cu ACCOUNT_ACTION chiar fără "mea" - dar
   * doar tiparul de STATUS/LOCAȚIE ("unde este.../ce status are..."),
   * NU orice mențiune de "comandă" - o întrebare de MECANISM ("cum
   * plătesc comanda?") tot rămâne clar PLATFORM_KNOWLEDGE, nu trebuie
   * deferată doar pentru că apare cuvântul "comandă".
   */
  {
    id: "explain-generic",
    intent: GUEST_INTENTS.PLATFORM_KNOWLEDGE,
    test: (ctx) =>
      ctx.isQuestion &&
      !/\bunde (e|este)\b.*\bcomand\w*|\bcomand\w*.*\bunde (e|este)\b|\bstatus\w* comand\w*/.test(
        ctx.normalized
      ),
  },

  /*
   * BUGFIX (audit, set greu) - GOL MAJOR găsit prin testare: TOATE
   * regulile PLATFORM_KNOWLEDGE de mai sus sunt gated pe ctx.isQuestion
   * (formă de întrebare) - dar un vizitator scrie des o afirmație, nu
   * o întrebare ("artfest are stoc propriu", "ce sunt colecțiile" fără
   * "?", "produsul e epuizat"). Regulă NOUĂ, separată, pentru forma
   * STATEMENT: cuvânt-temă STRICT (fără personalizare/personalizat -
   * vezi motivul la PLATFORM_TOPIC_STRICT_RE, aceeași ambiguitate care
   * ar rupe "vreau un cadou personalizat" dacă am folosi varianta
   * completă aici) + NU e deja o cerere de cont/suport/ofertă/
   * navigare (verificate mai sus, cu prioritate). Plasată ÎNAINTEA
   * regulii imperative de căutare, ca "produsul e epuizat" să nu fie
   * confundat cu o cerere de cumpărare doar pentru cuvântul "produs".
   */
  {
    id: "platform-knowledge-statement",
    intent: GUEST_INTENTS.PLATFORM_KNOWLEDGE,
    test: (ctx) => PLATFORM_TOPIC_STRICT_RE.test(ctx.normalized),
  },

  /*
   * Formă imperativă/declarativă, NU întrebare, cu cuvinte de căutare
   * -> PRODUCT_DISCOVERY determinist.
   *
   * BUGFIX (audit, testat automat) - excluderea pe PLATFORM_TOPIC_RE
   * era corectă DOAR pentru forma-întrebare (regulile explain-* de
   * mai sus, unde chiar there's ambiguity: "cum funcționează
   * personalizarea?" e cunoaștere, nu cumpărare) - dar aplicată și
   * aici bloca greșit cereri REALE de cumpărare care conțin din
   * întâmplare un cuvânt-temă ("Vreau un cadou personalizat" e clar
   * o căutare, nu o întrebare despre CONCEPTUL de personalizare).
   * Fără "?" și fără prefix explicativ, un cuvânt-temă nu mai e
   * ambiguu - rămâne doar un adjectiv/detaliu al cererii de cumpărare.
   */
  /*
   * BUGFIX (audit) - regulă semantică EXPLICITĂ pentru ambiguitatea
   * "personalizare" (cerința #4): un mesaj format DOAR din acest
   * cuvânt (fără verb de dorință - "vreau"/"cadou" - și fără formă de
   * întrebare - "cum") nu are NICIUN semnal despre ce vrea userul de
   * fapt - nici măcar un om n-ar putea decide fără să întrebe înapoi.
   * Verificare STRICTĂ pe potrivire EXACTĂ (nu substring) - "vreau
   * personalizat" sau "cum funcționează personalizarea?" au deja
   * semnal clar și sunt prinse de regulile de mai sus, înaintea
   * acesteia.
   */
  {
    id: "clarify-bare-personalization",
    intent: GUEST_INTENTS.CLARIFY,
    test: (ctx) =>
      ctx.normalized === "personalizare" ||
      ctx.normalized === "personalizat",
  },

  {
    id: "product-discovery-imperative",
    intent: GUEST_INTENTS.PRODUCT_DISCOVERY,
    test: (ctx) =>
      !ctx.isQuestion &&
      PRODUCT_DISCOVERY_RE.test(ctx.normalized) &&
      !PLATFORM_TOPIC_STRICT_RE.test(ctx.normalized),
  },
];

/*
 * Small talk determinist - "salut", "buna", "multumesc", "ce mai
 * faci" - fără niciun cuvânt-temă. Verificat ÎNAINTEA regulilor de
 * mai sus (altfel "salut, cum sunteti?" ar risca să pice pe
 * explain-generic).
 */
const SMALLTALK_RE =
  /^(salut|buna( ziua)?|hey|hei|multumesc|mersi|ce mai faci|ce faci|cum esti)[\s!.,?]*$/;

/**
 * PASUL 1 - clasificare deterministă, fără niciun apel de rețea.
 *
 * Întoarce:
 *   { intent, confidence: 0.9, ruleId, extracted }   - o regulă s-a potrivit
 *   { intent: CHAT_SMALLTALK, confidence: 0.95 }     - small talk gol
 *   { intent: null, confidence: 0, ruleId: null }    - nimic determinist
 *     nu s-a potrivit -> apelantul trece la PASUL 2 (LLM).
 */
export function classifyGuestIntentDeterministic(rawText) {
  const text = String(rawText || "").trim();

  if (!text) {
    return { intent: null, confidence: 0, ruleId: null, extracted: null };
  }

  const normalized = normalizeForIntentDetection(text);

  if (SMALLTALK_RE.test(normalized)) {
    return {
      intent: CHAT_SMALLTALK,
      confidence: 0.95,
      ruleId: "smalltalk",
      extracted: null,
    };
  }

  /*
   * Toleranță la typo (cerință #3) - regulile de mai jos verifică
   * `ctx.normalized`, care acum trece prin corectarea conservatoare
   * de typo pe cuvinte-cheie comune ("comnda" -> "comanda", "ofeta"
   * -> "oferta"), NU textul brut. `ctx.raw` rămâne neatins - folosit
   * doar acolo unde forma EXACTĂ contează (extractMaxPriceCents,
   * isQuestionLike pe semnul "?").
   */
  const ctx = {
    raw: text,
    normalized: normalizeWithTypoTolerance(text),
    isQuestion: isQuestionLike(text),
  };

  for (const rule of GUEST_INTENT_RULES) {
    if (rule.test(ctx)) {
      const extracted = {
        maxPriceCents: extractMaxPriceCents(text),
        ...(rule.extract ? rule.extract(ctx) : null),
        ...(rule.subtype ? { subtype: rule.subtype } : null),
      };

      return {
        intent: rule.intent,
        confidence: 0.9,
        ruleId: rule.id,
        extracted,
      };
    }
  }

  return { intent: null, confidence: 0, ruleId: null, extracted: null };
}

/* =========================================================================
   PASUL 2 - MAPARE CATEGORII BACKEND (LLM) -> TAXONOMIA DE 7 INTENȚII
========================================================================= */

/*
 * copilotRouter.js (backend) are propriile 10 categorii, mai fine,
 * gândite pentru VENDOR + USER + GUEST (VENDOR_INSIGHTS, PLATFORM_ACTION
 * etc. n-au sens pentru un guest, dar categoria tot vine din backend).
 * Nu duplicăm acel clasificator LLM aici - doar traducem rezultatul lui
 * ÎNAPOI în cele 7 intenții din acest fișier, ca restul aplicației
 * (CTA-uri, metrici, teste) să lucreze cu UN SINGUR vocabular, indiferent
 * dacă răspunsul a venit din regulile determinste de mai sus sau din
 * LLM. Pentru categoriile cu ambele sensuri posibile (PAYMENT_HELP,
 * ORDER_HELP), decizia ține cont și de `intentMode` (TROUBLESHOOT vs
 * QUERY_LIVE_DATA/EXPLAIN), calculat oricum de classifyCopilotMessage.
 */
export function mapBackendCategoryToGuestIntent(category, intentMode) {
  switch (category) {
    case "PLATFORM_KNOWLEDGE":
    case "HELP_OVERVIEW":
      return GUEST_INTENTS.PLATFORM_KNOWLEDGE;

    case "ACCOUNT_HELP":
      return GUEST_INTENTS.ACCOUNT_ACTION;

    case "ORDER_HELP":
      return intentMode === "TROUBLESHOOT"
        ? GUEST_INTENTS.SUPPORT
        : GUEST_INTENTS.ACCOUNT_ACTION;

    case "PAYMENT_HELP":
      return intentMode === "TROUBLESHOOT"
        ? GUEST_INTENTS.SUPPORT
        : GUEST_INTENTS.PLATFORM_KNOWLEDGE;

    case "INCIDENT_OR_BUG":
    case "HUMAN_SUPPORT":
      return GUEST_INTENTS.SUPPORT;

    /*
     * Doar VENDOR/ADMIN - un guest nu ar trebui să ajungă aici real,
     * dar dacă LLM-ul greșește, tratăm ca "vrea acces la ceva ce ține
     * de un cont" - cel mai apropiat bucket rămâne ACCOUNT_ACTION.
     */
    case "PLATFORM_ACTION":
    case "VENDOR_INSIGHTS":
      return GUEST_INTENTS.ACCOUNT_ACTION;

    case "GENERAL_CONVERSATION":
      return CHAT_SMALLTALK;

    /*
     * EXISTING_FLOW (handled:false, delegateTo assistantChatRoutes) -
     * intentMode decide: căutare de marketplace vs date proprii vs
     * altceva nerezolvat determinist.
     */
    case "EXISTING_FLOW":
      if (intentMode === "MARKETPLACE_SEARCH") {
        return GUEST_INTENTS.PRODUCT_DISCOVERY;
      }
      if (intentMode === "QUERY_LIVE_DATA") {
        return GUEST_INTENTS.ACCOUNT_ACTION;
      }
      return GUEST_INTENTS.CLARIFY;

    default:
      return GUEST_INTENTS.CLARIFY;
  }
}

/*
 * assistantChatRoutes.js (clasificatorul mai vechi, folosit ca punte
 * finală - vezi sendAssistantChat în copilotApi.js) are propriul set
 * de 8 "intent"-uri normalizate în `type`. Aceeași idee de mapare.
 */
export function mapChatRouteTypeToGuestIntent(type, actionId = null) {
  switch (type) {
    case "product-search":
      return GUEST_INTENTS.PRODUCT_DISCOVERY;

    case "action":
      /*
       * image-search e o subformă de căutare de produse; track-order/
       * order-delivery țin de o comandă PROPRIE - există și un flow de
       * urmărire pentru guest (GuestOrder.jsx, prin număr de comandă,
       * fără login), dar taxonomic rămân "date despre mine", cel mai
       * apropiat de ACCOUNT_ACTION din cele 7 bucket-uri.
       */
      return actionId === "image-search"
        ? GUEST_INTENTS.PRODUCT_DISCOVERY
        : GUEST_INTENTS.ACCOUNT_ACTION;

    case "support":
      return GUEST_INTENTS.SUPPORT;

    case "menu": // personalization
      return GUEST_INTENTS.QUOTE_DISCOVERY;

    case "chat":
      return CHAT_SMALLTALK;

    case "clarify":
    default:
      return GUEST_INTENTS.CLARIFY;
  }
}
