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
// termeni tehnici care pot apărea cu majusculă în interiorul propoziției
const TECH_WORDS = new Set([
  "AWB", "API", "JSON", "XML", "HTTP", "URL", "ID", "IDS", "COD", "OOH", "PUDO", "IBAN", "CUI", "ONRC",
  "RON", "EUR", "HUF", "RO", "HU", "BG", "XB", "HD", "NEXTDAY", "SAMEDAY", "EASYBOX", "LOCKER", "PDF",
]);

/*
 * Orice cuvânt cu majusculă în INTERIORUL propoziției (nu după . ! ? :) poate fi un nume de
 * persoană / localitate / stradă („city Buzău”, „Recipient Maria Pop”) -> mesaj nesigur,
 * cu excepția termenilor tehnici de mai sus.
 */
function hasProperNoun(text) {
  const tokens = text.split(/\s+/);
  for (let i = 1; i < tokens.length; i += 1) {
    if (/[.!?:]$/.test(tokens[i - 1])) continue;
    const word = tokens[i].replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
    if (!word || !/^\p{Lu}/u.test(word)) continue;
    if (TECH_WORDS.has(word.toUpperCase())) continue;
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
    if (!FOLLOWING_OK.has(next.toLowerCase())) return true;
  }
  return false;
}

export function isSafeProviderText(text) {
  if (!text) return false;
  if (/@/.test(text)) return false;
  if (/\d{3,}/.test(text)) return false;
  // coduri amestecate litere + cifre (parole, coduri, blocuri „A1”, referințe)
  if (/\b(?=[\p{L}\d]*\p{L})(?=[\p{L}\d]*\d)[\p{L}\d]{2,}\b/u.test(text)) return false;
  if (ADDRESS_MARKERS.test(text) || SECRET_MARKERS.test(text)) return false;
  if (hasProperNoun(text)) return false;
  if (hasContextValue(text)) return false;
  return true;
}

let redactedCount = 0;
function messagesOf(list) {
  const arr = Array.isArray(list) ? list : list != null ? [list] : [];
  return arr
    .map((m) => (m && typeof m === "object" ? m.message ?? m.msg ?? m.error ?? null : m))
    .map(sanitizeProviderText)
    .filter((text) => {
      if (!text) return false;
      if (isSafeProviderText(text)) return true;
      redactedCount += 1;
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
  const result = parseSamedayErrorInner(body);
  // câte mesaje au fost eliminate complet (nu au putut fi curățate sigur)
  return { ...result, redacted: redactedCount };
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
export function samedayRejectionMessage(parsed) {
  const labels = [...new Set((parsed?.fields || []).map(fieldLabel).filter(Boolean))];
  if (labels.length) {
    return `Sameday a respins datele AWB-ului. Verifică: ${labels.slice(0, 5).join(", ")}.`;
  }
  return "Sameday a respins cererea de AWB, fără să indice un câmp anume. Datele expedierii par complete; motivul a fost salvat, iar echipa Artfest îl poate verifica. Nu reîncerca de mai multe ori.";
}
