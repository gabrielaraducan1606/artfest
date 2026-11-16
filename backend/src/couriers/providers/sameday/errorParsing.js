// backend/src/couriers/providers/sameday/errorParsing.js
//
// Interpretarea răspunsurilor de eroare Sameday (400 / 422), fără rețea și fără DB.
//
// Forme întâlnite / documentate:
//   A. Swagger (documentat):     { "error": { "code": 400, "message": "Invalid json message received." } }
//   B. formular Symfony:          { "code": 400, "message": "Validation Failed",
//                                   "errors": { "errors": ["..."], "children": { "awbRecipient":
//                                     { "children": { "phoneNumber": { "errors": ["..."] } } } } } }
//   C. formular fără înveliș:     { "errors": { "children": { ... } } }
//   D. listă:                     { "errors": ["...", { "field": "...", "message": "..." }] }
//   E. text simplu / HTML / gol.
//
// Mesajele Sameday pot repeta valorile trimise (ex. This value "0722..." is not valid),
// deci se păstrează DOAR după curățare: fără text între ghilimele, emailuri, numere lungi
// (telefon, cod poștal, CUI, IBAN), URL-uri, tokenuri. Căile câmpurilor (ex.
// "awbRecipient.phoneNumber") sunt nume de câmpuri, nu date, și se păstrează ca atare.

const MAX_MESSAGE = 200;
const MAX_ITEMS = 15;

/** Elimină datele care pot identifica o persoană / un secret din textul Sameday. */
export function sanitizeProviderText(value) {
  if (value === null || value === undefined) return null;
  let s = typeof value === "string" ? value : String(value);
  s = s
    .replace(/<[^>]*>/g, " ") // HTML
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[^\s@"'“”]+@[^\s@"'“”]+\.[^\s@"'“”]+/g, "[email]")
    .replace(/"[^"]*"|“[^”]*”|„[^”"]*["”]|'[^']*'/g, "[valoare]") // valori citate
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "[ascuns]") // tokenuri / chei
    .replace(/\+?\d[\d\s.-]{3,}\d/g, "[număr]") // telefon, cod poștal, CUI, IBAN parțial
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE - 1)}…` : s;
}

// un nume de câmp: litere, cifre, puncte, paranteze, „_” (fără valori)
function cleanFieldPath(value) {
  const s = String(value ?? "")
    .replace(/\[(\w+)\]/g, ".$1")
    .replace(/[^A-Za-z0-9_.]/g, "")
    .replace(/^\.+|\.+$/g, "");
  return s && s.length <= 80 ? s : null;
}

/*
 * Verificare FINALĂ, după curățare: dacă textul tot pare să conțină date personale
 * sau secrete, NU îl păstrăm deloc (rămân doar codul erorii și numele câmpurilor).
 * Conservator: preferăm să pierdem un mesaj decât să salvăm / logăm date.
 */
const ADDRESS_MARKERS = /\b(str|strada|bd|blvd|bulevardul|calea|aleea|sos|soseaua|șoseaua|nr|bl|bloc|sc|scara|ap|apartament|et|etaj|jud|judet|județ|judetul|județul|sector|sectorul|loc|localitatea|comuna|sat)\b\.?/i;
const SECRET_MARKERS = /\b(password|passwd|parola|parolă|token|secret|bearer|authorization|api[-_ ]?key|x-auth)\b/i;
/*
 * VOCABULAR TEHNIC (litere mici): cuvintele care apar în erorile de validare / cont ale
 * unui curier. Un cuvânt din vocabular NU poate fi un nume de persoană / stradă în sensul
 * regulilor de mai jos, deci nu face mesajul nesigur. Tot ce NU e în vocabular rămâne
 * tratat conservator (exact ca înainte). Folosit și pentru „scheletul” mesajelor nesigure.
 */
const SAFE_VOCAB = new Set(
  (
    // structură / gramatică (EN)
    "a an the this that these those is are was were be been being has have had does do did not no " +
    "must should can cannot could may will would to of for in on at by with from and or as than then it its " +
    "please only also yet already " +
    // stări / validare (EN)
    "invalid valid validation failed fail failure error errors wrong incorrect missing required mandatory empty " +
    "blank null allowed permitted authorized unauthorized forbidden denied active inactive enabled disabled available " +
    "unavailable found exist exists existing unknown supported unsupported accepted rejected expired match matches " +
    "mismatch belong belongs associated assigned configured selected choose chosen option options limit exceeded " +
    "maximum minimum max min greater less more too long short large small big value values field fields format " +
    "type types number count amount total data form request received message json xml parameter parameters " +
    "set use used using access permission permissions contract contractual account accounts client clients customer " +
    "user commercial department contact person persons " +
    // domeniu curierat (EN)
    "awb awbs pickup pick up point points third party thirdparty sender recipient recipients receiver shipment " +
    "shipments expedition delivery deliveries service services nextday next day hour hours standard return returns " +
    "locker lockers easybox pudo ooh home cash on cod reimbursement insured insurance payment pays paid tax taxes " +
    "interval package packages parcel parcels envelope weight length width height dimension dimensions kg cm " +
    "phone email address county city locality postal zip code country company cui onrc vat id ids reference " +
    "internal observation observations price cost estimate label sameday crossborder " +
    // RO
    "nu este sunt fi a al ale ai de la pe pentru cu din si și sau ori nici acest aceasta această acestui " +
    "invalid invalidă invalida valid validă valida valoare valoarea valori valorile selectat selectată selectata " +
    "câmp camp câmpul campul obligatoriu obligatorie lipsă lipsa lipsește lipseste permis permisă permisa permite " +
    "permis permisiune activ activă activa inactiv inactivă dezactivat disponibil disponibilă indisponibil " +
    "existent există exista găsit gasit acces client clientul clientului cont contul contract contractul " +
    "serviciu serviciul servicii serviciului punct punctul ridicare ridicarea ridicării livrare livrarea " +
    "colet coletul colete greutate greutatea tip tipul ramburs rambursul plata plată terț tert terță terta " +
    "destinatar destinatarul expeditor expeditorul adresa adresă telefon telefonul județ judet județul " +
    "localitate localitatea cod codul poștal postal persoana persoană contact prea mare mic mică maxim minim " +
    "depășit depasit greșit gresit corect necesar trebuie poate"
  ).split(/\s+/)
);
// coduri de serviciu / unități (ex. 24H, 3H, 2H, 6H) - nu sunt date personale
const SERVICE_CODE = /^\d{1,2}h$/i;

function vocabWord(word) {
  const w = String(word || "").toLowerCase();
  return SAFE_VOCAB.has(w) || SERVICE_CODE.test(w);
}

/*
 * Orice cuvânt cu majusculă în INTERIORUL propoziției (nu după . ! ? :) poate fi un nume de
 * persoană / localitate / stradă („city Buzău”, „Recipient Maria Pop”) -> mesaj nesigur,
 * cu excepția cuvintelor din vocabularul tehnic („Validation Failed”, „Third Party Pickup”).
 */
function hasProperNoun(text) {
  const tokens = text.split(/\s+/);
  for (let i = 1; i < tokens.length; i += 1) {
    if (/[.!?:]$/.test(tokens[i - 1])) continue;
    const word = tokens[i].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!word || !/^\p{Lu}/u.test(word)) continue;
    if (vocabWord(word)) continue;
    return true;
  }
  return false;
}

/*
 * Un cuvânt oarecare imediat după un termen care introduce o persoană / un loc
 * („client ionescu”, „city buzau”, „user test”) poate fi o dată personală, chiar scris
 * cu literă mică. Excepție: cuvintele gramaticale / tehnice („client is not allowed”).
 */
const CONTEXT_WORDS = /^(client|customer|user|username|recipient|sender|name|person|contact|city|county|town|street|address|locality|oras|oraș|judet|județ|strada|destinatar|expeditor|utilizator|nume)$/i;
const FOLLOWING_OK = new Set([
  "is", "are", "was", "were", "has", "have", "had", "does", "do", "did", "not", "must", "should", "cannot", "can", "could",
  "may", "will", "account", "type", "id", "data", "field", "value", "values", "code", "and", "or", "of", "for", "with",
  "this", "the", "a", "an", "in", "on", "at", "to", "from", "nu", "este", "sunt", "invalid", "invalidă", "invalida",
  "missing", "required", "empty", "lipsă", "lipsa", "obligatoriu", "obligatorie", "information", "details", "phone",
  "email", "postal", "number", "nr",
]);
function hasContextValue(text) {
  const words = text.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}[]+|[^\p{L}\p{N}\]]+$/gu, ""));
  for (let i = 0; i < words.length - 1; i += 1) {
    if (!CONTEXT_WORDS.test(words[i])) continue;
    const next = words[i + 1];
    if (!next || next.startsWith("[")) continue; // deja înlocuit ([valoare], [număr]...)
    // cuvânt gramatical / tehnic („client pickup point”, „contact person”) => nu e o valoare
    if (!FOLLOWING_OK.has(next.toLowerCase()) && !vocabWord(next)) return true;
  }
  return false;
}

// coduri amestecate litere + cifre (parole, coduri, blocuri „A1”, referințe), exceptând 24H / 3H...
function hasMixedCode(text) {
  const re = /\b(?=[\p{L}\d]*\p{L})(?=[\p{L}\d]*\d)[\p{L}\d]{2,}\b/gu;
  for (const m of text.matchAll(re)) if (!SERVICE_CODE.test(m[0])) return true;
  return false;
}

/**
 * Motivele pentru care un text (deja curățat) NU e sigur. Listă goală = sigur.
 * Motivele sunt coduri fixe (nu conțin text din mesaj).
 */
export function unsafeReasons(text) {
  if (!text) return ["empty"];
  const reasons = [];
  if (/@/.test(text)) reasons.push("email_like");
  if (/\d{3,}/.test(text)) reasons.push("long_number");
  if (hasMixedCode(text)) reasons.push("mixed_code");
  if (ADDRESS_MARKERS.test(text)) reasons.push("address_marker");
  if (SECRET_MARKERS.test(text)) reasons.push("secret_marker");
  if (hasProperNoun(text)) reasons.push("proper_noun");
  if (hasContextValue(text)) reasons.push("context_value");
  return reasons;
}

export function isSafeProviderText(text) {
  return unsafeReasons(text).length === 0;
}

/*
 * Categorii tehnice SIGURE (coduri fixe), deduse din cuvintele-cheie ale mesajului ORIGINAL.
 * Rezultatul nu conține niciun fragment din mesaj.
 */
const CATEGORY_RULES = [
  ["third_party_pickup", /third[\s_-]*party|thirdparty|terț|terta|tert\b/i],
  ["pickup_point", /pickup[\s_-]*point|punct(ul)? de ridicare/i],
  ["contact_person", /contact[\s_-]*person|persoan[aă] de contact/i],
  ["service", /\bservices?\b|serviciu|24h|next[\s_-]*day|nextday/i],
  // „COD” doar cu majuscule (cash on delivery); „cod” românesc = cod poștal / cod client
  ["cash_on_delivery", /[Cc]ash[\s_-]*[Oo]n[\s_-]*[Dd]elivery|\bCOD\b|[Rr]ambursu?l?|[Rr]eimburs/],
  ["package_type", /package[\s_-]*type|packagetype|tip(ul)? colet|envelope|plic/i],
  ["weight_dimensions", /weight|greutat|dimension|length|width|height|\bkg\b/i],
  ["awb_payment", /awb[\s_-]*payment|awbpayment|who pays|plat[aă] transport/i],
  ["insured_value", /insured|asigur/i],
  ["recipient", /recipient|receiver|destinatar/i],
  ["address", /address|adres|county|city|locality|jude[tț]|localitat|postal|zip/i],
  ["phone", /phone|telefon/i],
  ["email", /e-?mail/i],
  ["locker_ooh", /locker|easybox|pudo|\booh\b/i],
  ["account_contract", /contract|account|\bcont(ul)?\b|commercial|comercial/i],
  ["permission", /not allowed|not permitted|unauthori[sz]ed|forbidden|denied|nu (este )?permis|interzis|no access|nu are acces|not authori[sz]ed/i],
  ["inactive", /inactive|not active|disabled|unavailable|not available|inactiv|dezactivat|indisponibil/i],
  ["missing", /missing|required|mandatory|blank|empty|lips[aă]|obligatori/i],
  ["invalid", /invalid|not valid|wrong|incorrect|mismatch|does not match|greșit|gresit|incorect/i],
  ["not_found", /not found|does not exist|nu exist|negăsit|inexistent/i],
  ["limit", /exceed|too (long|large|big|small|short)|maximum|minimum|limit|prea (mare|mic)/i],
  ["format", /json|format|malformed/i],
];

export function categorizeProviderText(raw) {
  const text = String(raw ?? "");
  return CATEGORY_RULES.filter(([, re]) => re.test(text)).map(([code]) => code);
}

/*
 * „Scheletul” unui mesaj nesigur: DOAR cuvintele din vocabularul tehnic și marcajele deja
 * puse ([valoare], [număr]...); orice alt cuvânt devine „…”. Prin construcție nu poate
 * conține un nume / o stradă / o valoare care nu e cuvânt tehnic. Cel puțin 3 cuvinte
 * tehnice, altfel nu se păstrează nimic.
 */
export function technicalSkeleton(text) {
  if (!text) return null;
  const out = [];
  let vocabCount = 0;
  for (const token of text.split(/\s+/)) {
    const placeholder = /^\[(valoare|număr|email|url|ascuns)\]$/.test(token.replace(/[.,;:!?()]+$/g, ""));
    const word = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (placeholder) out.push(token.replace(/[^\[\]\p{L}]/gu, ""));
    else if (word && vocabWord(word) && !/\d{3,}/.test(word)) {
      out.push(word.toLowerCase());
      vocabCount += 1;
    } else if (out[out.length - 1] !== "…") out.push("…");
  }
  if (vocabCount < 3) return null;
  return out.join(" ").slice(0, MAX_MESSAGE);
}

let redactedCount = 0;
let filtered = [];
let categories = new Set();
function messagesOf(list) {
  const arr = Array.isArray(list) ? list : list != null ? [list] : [];
  return arr
    .map((m) => (m && typeof m === "object" ? m.message ?? m.msg ?? m.error ?? null : m))
    .map((raw) => {
      if (raw === null || raw === undefined) return null;
      // categoriile: din textul ORIGINAL (doar coduri fixe ies de aici)
      for (const c of categorizeProviderText(raw)) categories.add(c);
      return sanitizeProviderText(raw);
    })
    .filter((text) => {
      if (!text) return false;
      const reasons = unsafeReasons(text);
      if (!reasons.length) return true;
      redactedCount += 1;
      // mesaj eliminat: păstrăm doar motivul filtrării + scheletul tehnic (fără valori)
      filtered.push({ reasons, skeleton: technicalSkeleton(text) });
      return false;
    });
}

/**
 * @param {any} body  corpul JSON (sau textul) primit de la Sameday
 * @returns {{ message: string|null, fields: string[], errors: Array<{ field: string|null, message: string|null }> }}
 *   message = mesajul general (sigur); fields = căile câmpurilor respinse;
 *   errors = perechi câmp / mesaj (sigure), max 15
 */
export function parseSamedayError(body) {
  redactedCount = 0;
  filtered = [];
  categories = new Set();
  const result = parseSamedayErrorInner(body);
  return {
    ...result,
    // câte mesaje au fost eliminate complet (nu au putut fi curățate sigur)
    redacted: redactedCount,
    // pentru fiecare mesaj eliminat: motivele (coduri fixe) + scheletul tehnic (doar vocabular)
    filtered: filtered.slice(0, 5),
    // categorii tehnice (coduri fixe) din toate mesajele, inclusiv cele eliminate
    categories: [...categories],
    // forma răspunsului (fără conținut): ajută la diagnostic când mesajul lipsește
    shape: describeShape(body),
  };
}

// structura corpului, doar chei / tipuri (fără valori)
function describeShape(body) {
  if (body === null || body === undefined || body === "") return "empty";
  if (typeof body === "string") return /^\s*</.test(body) ? "html" : "text";
  if (typeof body !== "object") return typeof body;
  const keys = Object.keys(body).slice(0, 8).map((k) => cleanFieldPath(k) || "?");
  const inner = body.error && typeof body.error === "object" ? `error{${Object.keys(body.error).slice(0, 6).map((k) => cleanFieldPath(k) || "?").join(",")}}` : null;
  return [keys.join(","), inner].filter(Boolean).join(" ");
}

function parseSamedayErrorInner(body) {
  const errors = [];
  const fields = [];
  const general = [];
  const addField = (path, msgs) => {
    const field = cleanFieldPath(path);
    if (field && !fields.includes(field)) fields.push(field);
    if (msgs.length) for (const message of msgs) errors.push({ field, message });
    else errors.push({ field, message: null });
  };

  if (body === null || body === undefined || body === "") return { message: null, fields: [], errors: [] };
  if (typeof body === "string") {
    const [message = null] = messagesOf(body);
    return { message, fields: [], errors: message ? [{ field: null, message }] : [] };
  }
  if (typeof body !== "object") return { message: null, fields: [], errors: [] };

  // A. { error: { code, message } } / { error: "text" }
  if (body.error) {
    if (typeof body.error === "string") general.push(...messagesOf(body.error));
    else if (typeof body.error === "object") general.push(...messagesOf(body.error.message ?? null));
  }
  // B. mesajul de la rădăcină
  if (typeof body.message === "string") general.push(...messagesOf(body.message));

  // B / C. formular Symfony (errors.errors = erori pe formular, errors.children = pe câmpuri)
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    const rawOwn = Array.isArray(node.errors) ? node.errors : [];
    const own = messagesOf(rawOwn);
    // câmpul respins rămâne înregistrat chiar dacă mesajul lui a fost eliminat (nesigur)
    if (path && rawOwn.length) addField(path, own);
    else if (!path) general.push(...own);
    const children = node.children && typeof node.children === "object" ? node.children : null;
    if (children) for (const [key, child] of Object.entries(children)) walk(child, path ? `${path}.${key}` : key);
  };
  if (body.errors && typeof body.errors === "object" && !Array.isArray(body.errors)) {
    if (body.errors.children || body.errors.errors) walk(body.errors, "");
    else {
      // { errors: { "awbRecipient.phoneNumber": ["..."] } }
      for (const [key, value] of Object.entries(body.errors)) addField(key, messagesOf(value));
    }
  }
  // D. { errors: [ "...", { field|property|propertyPath, message } ] }
  if (Array.isArray(body.errors)) {
    for (const item of body.errors) {
      if (item && typeof item === "object" && (item.field || item.property || item.propertyPath)) {
        addField(item.field || item.property || item.propertyPath, messagesOf(item.message ?? item.msg ?? null));
      } else {
        general.push(...messagesOf(item));
      }
    }
  }

  const uniqueGeneral = [...new Set(general)];
  for (const message of uniqueGeneral) errors.unshift({ field: null, message });
  return {
    message: uniqueGeneral[0] || null,
    fields: fields.slice(0, 30),
    errors: errors.slice(0, MAX_ITEMS),
  };
}

/*
 * Câmpul Sameday -> ce înțelege vânzătorul (fără termeni tehnici). Ordinea contează:
 * primul prefix potrivit câștigă.
 */
const FIELD_LABELS = [
  ["awbRecipient.phoneNumber", "telefonul destinatarului"],
  ["awbRecipient.email", "emailul destinatarului"],
  ["awbRecipient.name", "numele destinatarului"],
  ["awbRecipient.postalCode", "codul poștal al destinatarului"],
  ["awbRecipient.county", "județul destinatarului"],
  ["awbRecipient.city", "localitatea destinatarului"],
  ["awbRecipient.address", "adresa destinatarului"],
  ["awbRecipient.company", "datele de firmă ale destinatarului"],
  ["awbRecipient", "datele destinatarului"],
  ["thirdPartyPickup", "ridicarea coletului de la magazin (configurarea contului de curierat Artfest)"],
  ["thirdParty.phoneNumber", "telefonul de la adresa de ridicare"],
  ["thirdParty.postalCode", "codul poștal al adresei de ridicare"],
  ["thirdParty.county", "județul adresei de ridicare"],
  ["thirdParty.city", "localitatea adresei de ridicare"],
  ["thirdParty.address", "adresa de ridicare"],
  ["thirdParty.company", "datele de firmă ale magazinului (adresa de ridicare)"],
  ["thirdParty", "datele de ridicare ale magazinului"],
  ["packageWeight", "greutatea coletului"],
  ["parcels", "greutatea sau dimensiunile coletului"],
  ["packageType", "tipul coletului"],
  ["packageNumber", "numărul de colete"],
  ["cashOnDelivery", "suma de ramburs"],
  ["insuredValue", "valoarea declarată"],
  ["service", "serviciul de curierat (configurarea contului Artfest)"],
  ["pickupPoint", "punctul de ridicare Artfest (configurarea contului)"],
  ["contactPerson", "persoana de contact Artfest (configurarea contului)"],
  ["awbPayment", "plata transportului (configurarea contului Artfest)"],
  ["oohLastMile", "punctul easybox / Sameday Point ales"],
  ["observation", "observațiile pentru curier"],
];

export function fieldLabel(path) {
  const p = String(path || "");
  for (const [prefix, label] of FIELD_LABELS) {
    if (p === prefix || p.startsWith(`${prefix}.`) || p.startsWith(prefix)) return label;
  }
  return null;
}

/**
 * Mesajul pentru vânzător (română, fără mesajul tehnic Sameday).
 * @param {{ fields?: string[] }} parsed
 */
// categoriile care țin de contul / contractul de curierat Artfest (nu de datele vânzătorului)
const ACCOUNT_CATEGORIES = new Set(["third_party_pickup", "account_contract", "pickup_point", "contact_person", "awb_payment"]);
const CATEGORY_LABELS = {
  third_party_pickup: "ridicarea coletului de la magazin (configurarea contului de curierat Artfest)",
  service: "serviciul de curierat",
  pickup_point: "punctul de ridicare Artfest (configurarea contului)",
  contact_person: "persoana de contact Artfest (configurarea contului)",
  cash_on_delivery: "suma de ramburs",
  package_type: "tipul coletului",
  weight_dimensions: "greutatea sau dimensiunile coletului",
  awb_payment: "plata transportului (configurarea contului Artfest)",
  insured_value: "valoarea declarată",
  phone: "telefonul",
  email: "emailul",
  address: "adresa (județ, localitate, cod poștal)",
  locker_ooh: "punctul easybox / Sameday Point ales",
};

export function samedayRejectionMessage(parsed) {
  const labels = [...new Set((parsed?.fields || []).map(fieldLabel).filter(Boolean))];
  if (labels.length) {
    return `Sameday a respins datele AWB-ului. Verifică: ${labels.slice(0, 5).join(", ")}.`;
  }
  const cats = parsed?.categories || [];
  const topics = [...new Set(cats.map((c) => CATEGORY_LABELS[c]).filter(Boolean))];
  if (cats.some((c) => ACCOUNT_CATEGORIES.has(c)) && (cats.includes("permission") || cats.includes("inactive") || cats.includes("account_contract"))) {
    const short = [...new Set(topics.map((t) => t.replace(/\s*\(configurarea[^)]*\)/, "")))];
    return `Sameday a respins AWB-ul din cauza configurării contului de curierat Artfest (${short.slice(0, 3).join(", ")}). Nu este o problemă a datelor tale; echipa Artfest verifică. Nu reîncerca deocamdată.`;
  }
  if (topics.length) {
    return `Sameday a respins datele AWB-ului. Verifică: ${topics.slice(0, 4).join(", ")}.`;
  }
  return "Sameday a respins cererea de AWB, fără să indice un câmp anume. Datele expedierii par complete; motivul a fost salvat, iar echipa Artfest îl poate verifica. Nu reîncerca de mai multe ori.";
}
