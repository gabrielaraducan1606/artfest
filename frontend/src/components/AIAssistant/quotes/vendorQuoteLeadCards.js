// src/components/AIAssistant/quotes/vendorQuoteLeadCards.js
//
// Helper PUR pentru "Cereri primite" din Asistentul vendor (conectare
// flow, 2026-09-23). NU duplică logica din assistantQuotes.js/
// quoteApi.js - ia STRICT rezultatul deja întors de fetchVendorQuotes()
// (GET /api/vendor/quotes, serializeVendorQuote() extins cu
// leadStatus/vendorLastReadAt din thread-ul asociat) și construiește:
// ordinea de afișare + o "choice" compatibilă cu QuoteChoiceCard din
// AssistantMessage.jsx (isQuoteChoice/getQuoteChoiceDetails/
// getQuoteStatusType - randare deja existentă, neatinsă aici).
//
// Niciun apel de rețea în acest fișier - doar transformări pure.
//
// Rulare: node --test src/components/AIAssistant/quotes/vendorQuoteLeadCards.test.js

/*
 * Prioritate de afișare - EXACT statusurile CRM cerute (MessageThread.
 * leadStatus), fără altele inventate: NEW -> IN_DISCUSSION ->
 * OFFER_SENT -> restul (RESERVED/LOST/necunoscut), fiecare grup
 * sortat descrescător după cea mai recentă activitate.
 */
const STATUS_PRIORITY = {
  NEW: 0,
  IN_DISCUSSION: 1,
  OFFER_SENT: 2,
};

const DEFAULT_STATUS_PRIORITY = 3;

const DEFAULT_LIMIT = 5;

export function normalizeVendorQuoteList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.quotes)) return result.quotes;
  return [];
}

/*
 * leadStatus vine din thread-ul asociat (backend, serializeVendorQuote,
 * câmp adăugat aditiv) - fallback "NEW" dacă lipsește/necunoscut, ca
 * să nu crăpăm sortarea/afișarea pe date vechi sau parțiale.
 */
export function getVendorQuoteLeadStatus(quote) {
  const raw = String(quote?.leadStatus || "")
    .trim()
    .toUpperCase();

  return raw || "NEW";
}

function toTimestamp(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/*
 * "Nou" = a apărut activitate (creare/actualizare cerere) DUPĂ ultima
 * dată la care vendorul a citit conversația (vendorLastReadAt) -
 * exact conceptul deja folosit pentru unreadCount în
 * vendorMessageRoutes.js (mesaj mai nou decât vendorLastReadAt),
 * aplicat aici la nivelul QuoteRequest.updatedAt (singura dată de
 * activitate expusă azi de serializeVendorQuote pentru listă). Fără
 * activitate cunoscută -> nu marcăm "nou" (nimic de arătat).
 */
export function isVendorQuoteLeadUnread(quote) {
  const lastActivity = toTimestamp(
    quote?.updatedAt || quote?.createdAt
  );

  if (!lastActivity) return false;
  if (!quote?.vendorLastReadAt) return true;

  return toTimestamp(quote.vendorLastReadAt) < lastActivity;
}

/*
 * Sortare STABILĂ (index original ca tie-breaker final), fără
 * mutarea array-ului primit.
 */
export function sortVendorQuoteLeads(quotes) {
  const list = Array.isArray(quotes) ? quotes.slice() : [];

  return list
    .map((quote, index) => ({ quote, index }))
    .sort((a, b) => {
      const pa =
        STATUS_PRIORITY[
          getVendorQuoteLeadStatus(a.quote)
        ] ?? DEFAULT_STATUS_PRIORITY;

      const pb =
        STATUS_PRIORITY[
          getVendorQuoteLeadStatus(b.quote)
        ] ?? DEFAULT_STATUS_PRIORITY;

      if (pa !== pb) return pa - pb;

      const ta = toTimestamp(
        a.quote?.updatedAt || a.quote?.createdAt
      );

      const tb = toTimestamp(
        b.quote?.updatedAt || b.quote?.createdAt
      );

      if (ta !== tb) return tb - ta;

      return a.index - b.index;
    })
    .map((entry) => entry.quote);
}

export function pickTopVendorQuoteLeads(quotes, limit = DEFAULT_LIMIT) {
  const safeLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Number(limit)
      : DEFAULT_LIMIT;

  return sortVendorQuoteLeads(quotes).slice(0, safeLimit);
}

/*
 * Label RO pentru statusul CRM - folosit ca ULTIM segment din
 * description (AssistantMessage.jsx -> getQuoteChoiceDetails extrage
 * ultimul "·" ca statusLabel, restul ca details). Formele "Nouă"/
 * "În discuții"/"Ofertă trimisă" sunt EXACT cele recunoscute deja de
 * getQuoteStatusType() pentru culoarea corectă a badge-ului - nu
 * inventăm text nou, doar reutilizăm ce randerul știe deja să coloreze.
 */
const CRM_STATUS_LABEL = {
  NEW: "Nouă",
  IN_DISCUSSION: "În discuții",
  OFFER_SENT: "Ofertă trimisă",
  RESERVED: "Rezervată",
  LOST: "Pierdută",
};

export function getVendorQuoteLeadCrmLabel(quote) {
  const status = getVendorQuoteLeadStatus(quote);
  return CRM_STATUS_LABEL[status] || "Nouă";
}

/*
 * Status FORMAL (QuoteRequest.status - enum separat de CRM, vezi
 * audit) - afișat DOAR ca informație suplimentară în details, nu ca
 * badge principal (badge-ul rămâne CRM, cerut explicit).
 */
const FORMAL_STATUS_LABEL = {
  DRAFT: "ciornă",
  SUBMITTED: "trimisă",
  IN_DISCUSSION: "în discuții",
  OFFER_SENT: "ofertă trimisă",
  ACCEPTED: "acceptată",
  REJECTED: "refuzată",
  CANCELLED: "anulată",
  EXPIRED: "expirată",
};

export function getVendorQuoteFormalStatusLabel(quote) {
  const raw = String(quote?.status || "").trim().toUpperCase();
  return FORMAL_STATUS_LABEL[raw] || null;
}

/*
 * Buget - QuoteRequest.budgetMin/budgetMax sunt numere simple (RON),
 * fără conversie de cenți (spre deosebire de CustomerRequest.
 * budgetMinCents/budgetMaxCents - alt model, neatins aici).
 */
export function formatVendorQuoteBudget(quote) {
  const min = Number(quote?.budgetMin);
  const max = Number(quote?.budgetMax);

  const hasMin = Number.isFinite(min) && min > 0;
  const hasMax = Number.isFinite(max) && max > 0;

  if (!hasMin && !hasMax) return null;
  if (hasMin && hasMax && min === max) return `${min} RON`;
  if (hasMin && hasMax) return `${min} - ${max} RON`;
  if (hasMin) return `de la ${min} RON`;
  return `până la ${max} RON`;
}

function formatVendorQuoteDate(quote) {
  const raw = quote?.createdAt;
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString("ro-RO");
}

function getCustomerName(quote) {
  return quote?.customerName || "Client";
}

function getProductTitle(quote) {
  return quote?.product?.title || null;
}

/*
 * Construiește O SINGURĂ "choice" pentru lista de carduri compacte -
 * formă compatibilă STRICT cu ce așteaptă deja AssistantMessage.jsx
 * (isQuoteChoice: choice.quote + getQuoteId(choice.quote); randarea
 * cardului: QuoteChoiceCard, deja existentă, NEATINSĂ). `quote` rămâne
 * obiectul brut din fetchVendorQuotes(), necesar pentru imagine +
 * pentru fallback-ul din handleQuoteChoice (deschidere din listă).
 */
export function buildVendorQuoteLeadCard(quote) {
  const id = quote?.quoteRequestId || quote?.id || null;
  const productTitle = getProductTitle(quote);
  const formalStatusLabel = getVendorQuoteFormalStatusLabel(quote);

  const detailParts = [
    isVendorQuoteLeadUnread(quote) ? "Nou" : null,
    getCustomerName(quote),
    formatVendorQuoteBudget(quote),
    formatVendorQuoteDate(quote),
    formalStatusLabel && formalStatusLabel !== "trimisă"
      ? `formal: ${formalStatusLabel}`
      : null,
  ].filter(Boolean);

  const description = [
    ...detailParts,
    getVendorQuoteLeadCrmLabel(quote),
  ].join(" · ");

  return {
    id,
    quoteRequestId: id,

    label: productTitle || "Cerere de ofertă",
    title: productTitle || "Cerere de ofertă",
    subject: productTitle || "Cerere de ofertă",

    description,

    quote,
  };
}

/*
 * Punct de intrare unic pentru VendorAssistant.jsx - sortare +
 * limitare (implicit 5) + construire carduri, într-un singur apel.
 */
export function buildVendorQuoteLeadCards(quotes, limit = DEFAULT_LIMIT) {
  return pickTopVendorQuoteLeads(quotes, limit).map(
    buildVendorQuoteLeadCard
  );
}
