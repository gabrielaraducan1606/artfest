// backend/src/lib/supportHelpRequests.js
//
// Cererile de ajutor ale vânzătorilor (ajutor GPSR și ajutor la adăugarea unui produs)
// sunt tichete de suport OBIȘNUITE (SupportTicket + SupportMessage), fără schemă nouă:
//   - tipul: SupportTicket.category = "gpsr_help" | "product_help" (câmp text existent);
//   - primul mesaj = textul vânzătorului, NEMODIFICAT, urmat de detaliile completate
//     automat de server (tip, magazin, produs / ciornă), după un marcaj fix;
//   - starea: statusurile existente OPEN / PENDING / CLOSED = nouă / în lucru / rezolvată.
// Tichetele vechi (category "store", recunoscute după subiect) rămân recunoscute.
// Fără dependențe Node: importat și de frontend (Admin + formularele vânzătorului).

export const HELP_REQUEST_TYPES = Object.freeze({
  GPSR: "gpsr_help",
  PRODUCT: "product_help",
});

export const HELP_REQUEST_TYPE_VALUES = Object.freeze(Object.values(HELP_REQUEST_TYPES));

export const HELP_REQUEST_LABELS = Object.freeze({
  gpsr_help: "Ajutor GPSR",
  product_help: "Ajutor adăugare produs",
});

// subiectele existente (Adminul și tichetele vechi le recunosc deja)
export const HELP_REQUEST_SUBJECTS = Object.freeze({
  gpsr_help: "Ajutor pentru adresa profesională GPSR",
  product_help: "Ajutor la adăugarea unui produs",
});

// statusurile existente, cu sensul lor pentru o cerere de ajutor
export const HELP_STATUS_LABELS = Object.freeze({
  open: "Nouă",
  pending: "În lucru",
  closed: "Rezolvată",
});

export const HELP_CONTEXT_MARKER = "— Detalii solicitare (completate automat) —";
// marcajele folosite până acum în primul mesaj (tichete vechi)
const LEGACY_MARKERS = Object.freeze([
  "— Solicitare din formularul producătorului —",
  "— Ciorna produsului (Smart Listing, nesalvată ca produs) —",
]);
export const PRODUCT_DRAFT_MARKER = "— Ciorna produsului (nesalvată ca produs) —";
const DRAFT_MARKERS = Object.freeze([PRODUCT_DRAFT_MARKER, LEGACY_MARKERS[1]]);

export const HELP_MESSAGE_MAX = 4000;
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const SLUG_RE = /^[A-Za-z0-9._~-]{1,120}$/;
const REQUEST_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Tipul unui tichet: întâi categoria, apoi subiectul (tichete vechi). null = tichet obișnuit. */
export function helpTypeOfTicket(ticket) {
  const category = String(ticket?.category || "").toLowerCase();
  if (HELP_REQUEST_TYPE_VALUES.includes(category)) return category;
  const subject = String(ticket?.subject || "").trim();
  if (subject === HELP_REQUEST_SUBJECTS.gpsr_help) return HELP_REQUEST_TYPES.GPSR;
  if (subject.startsWith(HELP_REQUEST_SUBJECTS.product_help)) return HELP_REQUEST_TYPES.PRODUCT;
  return null;
}

/**
 * Contextul trimis de formular. Doar câmpuri cunoscute, validate; restul se ignoră.
 * Identitatea (vânzător, cont, dată) NU vine de aici: o stabilește serverul.
 */
export function normalizeHelpContext(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const type = String(raw.type || "");
  if (!HELP_REQUEST_TYPE_VALUES.includes(type)) return null;
  const pick = (value, re) => {
    const text = String(value ?? "").trim();
    return text && re.test(text) ? text : null;
  };
  return {
    type,
    productId: pick(raw.productId, ID_RE),
    draftId: pick(raw.draftId, ID_RE),
    storeSlug: pick(raw.storeSlug, SLUG_RE),
  };
}

export function normalizeRequestKey(value) {
  const text = String(value ?? "").trim();
  return REQUEST_KEY_RE.test(text) ? text : null;
}

/** Subiectul păstrează prefixul cunoscut (Adminul îl recunoaște și în căutare). */
export function helpSubject(type, subject = "") {
  const prefix = HELP_REQUEST_SUBJECTS[type];
  const text = String(subject || "").trim();
  if (!prefix) return text;
  return text.startsWith(prefix) ? text.slice(0, 200) : prefix;
}

/** Detaliile completate de server, la finalul primului mesaj. */
export function buildHelpContextFooter({ type, storeName = "", storeSlug = null, productId = null, productTitle = "", draftId = null }) {
  const lines = [HELP_CONTEXT_MARKER, `Tip: ${HELP_REQUEST_LABELS[type] || type}`];
  if (storeName || storeSlug) lines.push(`Magazin: ${[storeName, storeSlug ? `(${storeSlug})` : ""].filter(Boolean).join(" ")}`);
  if (productId) lines.push(`Produs: ${productId}${productTitle ? ` · ${String(productTitle).slice(0, 120)}` : ""}`);
  if (draftId) lines.push(`Ciornă: ${draftId} (salvată pe dispozitivul vânzătorului)`);
  if (!productId && !draftId) lines.push("Produs: nesalvat încă");
  return lines.join("\n");
}

export function composeHelpMessage(message, footer) {
  return `${String(message || "").trim()}\n\n${footer}`;
}

function linesAfter(text, marker) {
  const index = text.indexOf(marker);
  if (index < 0) return [];
  const rest = text.slice(index + marker.length);
  const next = [HELP_CONTEXT_MARKER, ...LEGACY_MARKERS, PRODUCT_DRAFT_MARKER]
    .map((other) => (other === marker ? -1 : rest.indexOf(other)))
    .filter((position) => position >= 0);
  const end = next.length ? Math.min(...next) : rest.length;
  return rest
    .slice(0, end)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

const valueOf = (lines, label) => {
  const line = lines.find((item) => item.startsWith(`${label}:`));
  return line ? line.slice(label.length + 1).trim() : "";
};

/**
 * Primul mesaj -> { message, details, context }. `message` = exact textul vânzătorului
 * (tot ce e înaintea primului marcaj); funcționează și pentru tichetele vechi.
 */
export function parseHelpTicketBody(body) {
  const text = String(body || "").trim();
  const markers = [HELP_CONTEXT_MARKER, ...LEGACY_MARKERS, PRODUCT_DRAFT_MARKER];
  const positions = markers.map((marker) => text.indexOf(marker)).filter((position) => position >= 0);
  const cut = positions.length ? Math.min(...positions) : text.length;
  const contextLines = linesAfter(text, HELP_CONTEXT_MARKER);
  const draftLines = DRAFT_MARKERS.flatMap((marker) => linesAfter(text, marker));
  const legacyLines = linesAfter(text, LEGACY_MARKERS[0]);

  const productLine = valueOf(contextLines, "Produs");
  const productId = /^[A-Za-z0-9_-]+(?=\s|$)/.exec(productLine)?.[0] || "";
  const storeLine = valueOf(contextLines, "Magazin") || valueOf(draftLines, "Magazin") || valueOf(legacyLines, "Magazin");
  const storeSlug = /\(([^)]+)\)\s*$/.exec(storeLine)?.[1] || (/^[A-Za-z0-9._~-]+$/.test(storeLine) && storeLine !== "-" ? storeLine : "");

  return {
    message: text.slice(0, cut).trim(),
    details: draftLines.filter((line) => !line.startsWith("Magazin:") && !/:\s*-$/.test(line)),
    context: {
      productId: productId && productId !== "nesalvat" ? productId : "",
      productLabel: productLine,
      draftId: /^[A-Za-z0-9_-]+/.exec(valueOf(contextLines, "Ciornă"))?.[0] || "",
      storeSlug,
      storeLabel: storeLine,
    },
  };
}
