// backend/src/lib/contactInfoGuard.js

/*
 * CONTACT INFO GUARD - validatorul CENTRAL pentru conținutul public al
 * vânzătorilor (descrierea magazinului, textele produsului).
 *
 * Un singur loc pentru reguli, reutilizat:
 * - în backend, la salvare (vendorProductRoutes.js, vendorRoutes.js,
 *   vendorStoreRoutes.js) și la auditul conținutului existent
 *   (services/contactInfoAudit.js);
 * - în frontend (import relativ, ca optionLabels.js), pentru propunerea
 *   de rescriere din Asistent.
 *
 * Modul PUR: fără importuri, fără rețea, fără DB.
 *
 * Diferit, intenționat, de regulile pentru MESAJE
 * (services/marketplaceMessageModeration.js), care blochează orice
 * mențiune a unei rețele sociale: în descrieri publice, „ne găsiți și
 * pe Instagram” fără cont/link concret e permis - blocăm doar date de
 * contact CONCRETE.
 */

export const CONTACT_INFO_TYPES = Object.freeze({
  PHONE: "PHONE",
  EMAIL: "EMAIL",
  URL: "URL",
  DOMAIN: "DOMAIN",
  SOCIAL_HANDLE: "SOCIAL_HANDLE",
  SOCIAL_PROFILE: "SOCIAL_PROFILE",
  QR_REFERENCE: "QR_REFERENCE",
});

export const CONTACT_INFO_ERROR_CODE = "contact_info_detected";

const TYPE_MESSAGES = {
  PHONE: "un număr de telefon",
  EMAIL: "o adresă de email",
  URL: "un link către un website extern",
  DOMAIN: "un website (domeniu)",
  SOCIAL_HANDLE: "un cont de social media (@utilizator)",
  SOCIAL_PROFILE: "un cont de social media sau de mesagerie",
  QR_REFERENCE: "o trimitere la un cod QR extern",
};

export const FIELD_LABELS = Object.freeze({
  title: "titlul produsului",
  description: "descrierea produsului",
  careInstructions: "instrucțiunile de îngrijire",
  specialNotes: "notele speciale",
  dimensions: "dimensiunile",
  materialMain: "materialul principal",
  technique: "tehnica",
  about: "descrierea magazinului",
  shortDescription: "descrierea scurtă a magazinului",
  tagline: "sloganul magazinului",
});

// câmpurile publice verificate, per tip de entitate
export const GUARDED_FIELDS = Object.freeze({
  PRODUCT: [
    "title",
    "description",
    "careInstructions",
    "specialNotes",
    "dimensions",
    "materialMain",
    "technique",
  ],
  STORE: ["about", "shortDescription", "tagline"],
});

// TLD-uri scurte ambigue (de, it, me...) sunt excluse intenționat, ca
// abrevieri/cuvinte obișnuite să nu fie luate drept website
const TLD =
  "ro|com|net|org|eu|info|biz|io|co|shop|store|online|site|app|dev|link|bio";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

const OBFUSCATED_EMAIL_RE =
  /\b[a-z0-9._%+-]+\s*(?:\[\s*at\s*\]|\(\s*at\s*\)|\s+at\s+|\[?\s*arond\s*\]?)\s*[a-z0-9-]+\s*(?:\[\s*dot\s*\]|\(\s*dot\s*\)|\s+dot\s+|\s+punct\s+)\s*[a-z]{2,}\b/gi;

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"']+/gi;

const DOMAIN_RE = new RegExp(
  `\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:${TLD})\\b(?:\\/[^\\s<>()"']*)?`,
  "gi"
);

// numere de telefon RO (mobil 07x / fix 02x-03x) și internaționale cu +
const PHONE_RES = [
  /(?:\+\s?40|0040|\b0)[\s.-]?7\d{2}(?:[\s.-]?\d){6}\b/g,
  /(?:\+\s?40|0040|\b0)[\s.-]?[23]\d(?:[\s.-]?\d){7}\b/g,
  /\+\s?\d{1,3}(?:[\s.-]?\d){7,12}\b/g,
];

// @utilizator (nu email - emailurile sunt eliminate înainte)
const HANDLE_RE = /(^|[\s(:,;])@([a-z0-9][a-z0-9._]{2,29})\b/gi;

const SOCIAL_WORDS =
  "instagram|insta|ig|facebook|fb|tiktok|tik tok|whatsapp|whats app|telegram|messenger|viber|signal|youtube|pinterest|etsy|snapchat";

// identificator „tehnic” de cont: conține . _ sau cifre (atelier.ana,
// atelier_ana, ana1990) - un cuvânt obișnuit („pagina”, „noi”) nu e
const ACCOUNT_ID = "@?(?=[a-z0-9._]*[a-z])[a-z0-9]*[._\\d][a-z0-9._]*[a-z0-9]";

// „Instagram: atelierana”, „WhatsApp= ana” (două puncte = identificator)
const SOCIAL_LABELED_RE = new RegExp(
  `\\b(?:${SOCIAL_WORDS})\\b\\s*[:=]\\s*@?[a-z0-9][a-z0-9._]{2,29}`,
  "gi"
);

// „Instagram - atelier.ana”, „pe Instagram la/ca atelier_ana”
const SOCIAL_LOOSE_RE = new RegExp(
  `\\b(?:${SOCIAL_WORDS})\\b\\s*(?:[–-]|\\s(?:la|ca|pe))\\s*${ACCOUNT_ID}`,
  "gi"
);

// „pe Instagram sub numele Atelier Ana” / „contul atelierana”
const SOCIAL_NAMED_RE = new RegExp(
  `\\b(?:${SOCIAL_WORDS})\\b\\s+(?:sub numele|cu numele|user(?:ul)?|contul|id(?:-ul)?)\\s+@?[a-z0-9][a-z0-9._]{2,29}`,
  "gi"
);

const QR_RE =
  /\b(?:scanea?z\w*|scan)\b.{0,25}\b(?:cod(?:ul)?\s+)?qr\b|\bqr\s*code\b.{0,25}\b(?:contact|comenz|comand|site|profil)/gi;

// date/ore/intervale - scoase înainte de detecția telefonului, ca
// „01.02.2025 10:00” sau „12-24 luni” să nu fie luate drept telefon
const DATE_TIME_RE = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}:\d{2}\b/g;

function blank(text, re) {
  return text.replace(re, (m) => " ".repeat(m.length));
}

function collect(text, re, type, pick = (m) => m[0]) {
  const out = [];
  re.lastIndex = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    const fragment = String(pick(m) || "").trim();
    if (fragment) out.push({ type, fragment, index: m.index });
    if (m[0].length === 0) re.lastIndex += 1;
  }

  return out;
}

/*
 * Returnează lista de detecții { type, fragment, index }, fără
 * duplicate. Ordinea contează: emailurile și linkurile sunt „acoperite”
 * înainte de domenii / @handle, ca să nu fie raportate de două ori.
 */
export function detectContactInfo(value) {
  let text = String(value ?? "");
  if (!text.trim()) return [];

  const detections = [];

  const take = (re, type, pick) => {
    const found = collect(text, re, type, pick);
    detections.push(...found);
    // acoperim ce am găsit, ca alte reguli să nu-l mai raporteze
    for (const d of found) {
      const start = text.indexOf(d.fragment, Math.max(0, d.index));
      if (start >= 0) {
        text =
          text.slice(0, start) +
          " ".repeat(d.fragment.length) +
          text.slice(start + d.fragment.length);
      }
    }
  };

  take(EMAIL_RE, CONTACT_INFO_TYPES.EMAIL);
  take(OBFUSCATED_EMAIL_RE, CONTACT_INFO_TYPES.EMAIL);
  take(URL_RE, CONTACT_INFO_TYPES.URL);
  take(DOMAIN_RE, CONTACT_INFO_TYPES.DOMAIN);

  // telefoanele înaintea conturilor sociale („WhatsApp la 0722…” e un
  // telefon, nu un nume de cont); datele/orele scoase înainte
  const dated = blank(text, DATE_TIME_RE);
  const beforeDates = text;
  text = dated;

  for (const re of PHONE_RES) {
    take(re, CONTACT_INFO_TYPES.PHONE);
  }

  // refacem textul original (fără telefoanele deja acoperite), ca
  // regulile sociale să vadă și cifrele din identificatori (ana1990)
  text = [...beforeDates]
    .map((ch, i) => (text[i] === " " && dated[i] !== " " ? " " : ch))
    .join("");

  take(SOCIAL_LABELED_RE, CONTACT_INFO_TYPES.SOCIAL_PROFILE);
  take(SOCIAL_LOOSE_RE, CONTACT_INFO_TYPES.SOCIAL_PROFILE);
  take(SOCIAL_NAMED_RE, CONTACT_INFO_TYPES.SOCIAL_PROFILE);
  take(HANDLE_RE, CONTACT_INFO_TYPES.SOCIAL_HANDLE, (m) => `@${m[2]}`);
  take(QR_RE, CONTACT_INFO_TYPES.QR_REFERENCE);

  return detections.sort((a, b) => a.index - b.index);
}

export function hasContactInfo(value) {
  return detectContactInfo(value).length > 0;
}

export function describeDetection(type) {
  return TYPE_MESSAGES[type] || "date de contact externe";
}

/*
 * Verifică câmpurile unei entități. `fields` = { numeCâmp: valoare }.
 * Întoarce issues structurate - câte una per câmp, cu toate fragmentele.
 */
export function checkPublicFields({
  entityType,
  entityId = null,
  fields = {},
}) {
  const issues = [];

  for (const [field, value] of Object.entries(fields || {})) {
    if (typeof value !== "string" || !value.trim()) continue;

    const detections = detectContactInfo(value);
    if (!detections.length) continue;

    const kinds = [...new Set(detections.map((d) => d.type))];
    const label = FIELD_LABELS[field] || field;

    issues.push({
      entityType,
      entityId,
      field,
      fieldLabel: label,
      types: kinds,
      fragments: detections.map((d) => d.fragment),
      text: value,
      message: `Am găsit ${kinds.map(describeDetection).join(", ")} în ${label} („${detections[0].fragment}”). Pe Artfest, clienții te contactează prin mesageria platformei - te rugăm să elimini datele de contact externe.`,
    });
  }

  return issues;
}

/*
 * Corpul răspunsului HTTP 422 pentru o salvare blocată. Conținutul
 * neconform NU se salvează (apelantul returnează înainte de orice
 * scriere).
 */
export function buildContactInfoErrorBody(issues) {
  const first = issues[0];

  return {
    error: CONTACT_INFO_ERROR_CODE,
    message:
      issues.length === 1
        ? first.message
        : `Am găsit date de contact externe în ${issues.length} câmpuri (${issues
            .map((i) => i.fieldLabel)
            .join(", ")}). Te rugăm să le elimini - clienții te contactează prin mesageria Artfest.`,
    issues,
    cta: {
      label: "Corectează cu ajutorul asistentului",
      action: "open_vendor_assistant",
      task: "CONTACT_INFO_FIX",
    },
  };
}

/*
 * Doar câmpurile care chiar se schimbă (față de valoarea salvată) sunt
 * verificate - o editare fără legătură (ex. stoc) nu e blocată de un
 * text vechi; conținutul vechi e tratat prin audit + notificare.
 */
export function pickChangedGuardedFields(entityType, incoming = {}, stored = {}) {
  const out = {};

  for (const field of GUARDED_FIELDS[entityType] || []) {
    if (!Object.prototype.hasOwnProperty.call(incoming, field)) continue;

    const next = incoming[field];
    if (typeof next !== "string") continue;

    const previous = stored?.[field];
    if (String(previous ?? "").trim() === next.trim()) continue;

    out[field] = next;
  }

  return out;
}

// formule de contact care nu mai au sens fără datele eliminate
const CONTACT_INTENT_RE =
  /\b(?:suna[țt]i|sună|suna|scrie[țt]i|scrie|contacta[țt]i|contactează|contacteaz|găsi[țt]i|găsi|gasi|găsește|urmări[țt]i|urmărește|comenzi\s+(?:la|pe|prin)|comand\w*\s+(?:la|pe|prin)|detalii\s+(?:la|pe|prin)|whats\s?app|instagram|insta|facebook|tiktok|telegram|messenger|telefon|email|e-mail|mail)\b/i;

export const COMPLIANT_CONTACT_SENTENCE =
  "Pentru detalii și comenzi, folosește mesageria și funcțiile de contact disponibile în Artfest.";

/*
 * Propunere de rescriere DETERMINISTĂ (fără AI, fără salvare):
 * - elimină propozițiile care conțin date de contact;
 * - dacă o propoziție are și conținut comercial în afara datelor de
 *   contact, păstrează partea fără ele;
 * - adaugă o singură dată fraza standard de contact prin Artfest.
 * Rezultatul este reverificat; vendorul îl confirmă sau îl editează.
 */
export function suggestContactFreeRewrite(value) {
  const original = String(value ?? "");
  if (!hasContactInfo(original)) return original.trim();

  const sentences = original
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const kept = [];

  for (const sentence of sentences) {
    if (!hasContactInfo(sentence)) {
      kept.push(sentence);
      continue;
    }

    /*
     * Propoziție cu date de contact: o împărțim în părți („, ” / „; ” /
     * „ sau ” / „ ori ”) și păstrăm doar părțile care NU conțin date de
     * contact și nici formule de contact („sunați-ne”, „comenzi la”...).
     * Ex. „Lumânare din soia, comenzi la 07xx” -> „Lumânare din soia.”
     */
    const clauses = sentence
      .replace(/[.!?]+$/, "")
      .split(/\s*[,;]\s*|\s+(?:sau|ori)\s+/i)
      .map((c) => c.trim())
      .filter(Boolean);

    const commercial = clauses.filter(
      (clause) =>
        !hasContactInfo(clause) &&
        !CONTACT_INTENT_RE.test(clause) &&
        clause.split(/\s+/).filter((w) => /\p{L}{3,}/u.test(w)).length >= 2
    );

    if (commercial.length) {
      const joined = commercial.join(", ");
      kept.push(`${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`);
    }
  }

  if (!kept.includes(COMPLIANT_CONTACT_SENTENCE)) {
    kept.push(COMPLIANT_CONTACT_SENTENCE);
  }

  const result = kept.join(" ").trim();

  return hasContactInfo(result) ? COMPLIANT_CONTACT_SENTENCE : result;
}
