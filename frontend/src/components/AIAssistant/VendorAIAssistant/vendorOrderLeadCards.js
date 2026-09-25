// src/components/AIAssistant/VendorAIAssistant/vendorOrderLeadCards.js
//
// Helper PUR pentru "Comenzile magazinului" din Asistentul vendor
// (conectare flow, 2026-09-23). NU duplică logica din
// vendorOrdersRoutes.js - ia STRICT rezultatul deja întors de
// GET /api/vendor/orders (+ GET /api/vendor/orders/thread-meta pentru
// unread) și construiește: ordinea de afișare + view-model-ul unui
// card. Fiecare status/enum folosit aici e EXACT ce backend-ul
// (shipmentToUiStatus/uiToShipmentStatus, PaymentDepositStatus)
// întoarce deja - niciun status nou inventat.
//
// Multi-vendor: NU se face nicio filtrare suplimentară aici -
// endpoint-ul e deja scoped pe req.user.vendorId (Shipment.vendorId).
//
// Niciun apel de rețea în acest fișier - doar transformări pure.
//
// Rulare: node --test src/components/AIAssistant/VendorAIAssistant/vendorOrderLeadCards.test.js

/*
 * Prioritate de afișare - EXACT statusurile UI reale (shipmentToUiStatus,
 * vendorOrdersRoutes.js), fără altele inventate: new -> preparing ->
 * confirmed -> shipped -> fulfilled -> cancelled. În interiorul
 * fiecărui grup, cel mai recent (createdAt) primul.
 */
const STATUS_PRIORITY = {
  new: 0,
  preparing: 1,
  confirmed: 2,
  shipped: 3,
  fulfilled: 4,
  cancelled: 5,
};

const DEFAULT_STATUS_PRIORITY = 6;

const DEFAULT_LIMIT = 5;

/*
 * BUGFIX (auto-identificat la testare): Number(null) === 0, deci
 * `Number.isFinite(Number(x)) ? Number(x) : null` trata greșit
 * null/undefined/"" ca 0 valid, în loc de "lipsă". Helper explicit,
 * folosit pentru orice sumă (total/avans) care poate lipsi legitim.
 */
function toFiniteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/*
 * Action id pentru "Reîncearcă" de pe cardul de eroare al fetch-ului -
 * export explicit, ca VendorAssistant.jsx și testele să citească
 * ACEEAȘI constantă, fără string-uri duplicate/dezalinate.
 */
export const RETRY_VENDOR_ORDER_LEADS_ACTION =
  "retry-vendor-order-leads";

export function normalizeVendorOrderList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.items)) return result.items;
  if (Array.isArray(result?.orders)) return result.orders;
  return [];
}

/*
 * `status` vine deja normalizat ca string UI ("new"/"preparing"/...)
 * din GET /api/vendor/orders (shipmentToUiStatus) - fallback "new"
 * dacă lipsește/necunoscut, ca să nu crăpăm sortarea pe date parțiale.
 */
export function getVendorOrderStatus(order) {
  const raw = String(order?.status || "").trim().toLowerCase();
  return raw || "new";
}

function toTimestamp(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

/*
 * Sortare STABILĂ (index original ca tie-breaker final), fără
 * mutarea array-ului primit.
 */
export function sortVendorOrderLeads(orders) {
  const list = Array.isArray(orders) ? orders.slice() : [];

  return list
    .map((order, index) => ({ order, index }))
    .sort((a, b) => {
      const pa =
        STATUS_PRIORITY[getVendorOrderStatus(a.order)] ??
        DEFAULT_STATUS_PRIORITY;

      const pb =
        STATUS_PRIORITY[getVendorOrderStatus(b.order)] ??
        DEFAULT_STATUS_PRIORITY;

      if (pa !== pb) return pa - pb;

      const ta = toTimestamp(a.order?.createdAt);
      const tb = toTimestamp(b.order?.createdAt);

      if (ta !== tb) return tb - ta;

      return a.index - b.index;
    })
    .map((entry) => entry.order);
}

export function pickTopVendorOrderLeads(orders, limit = DEFAULT_LIMIT) {
  const safeLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Number(limit)
      : DEFAULT_LIMIT;

  return sortVendorOrderLeads(orders).slice(0, safeLimit);
}

const STATUS_LABEL_RO = {
  new: "Nouă",
  preparing: "În pregătire",
  confirmed: "Confirmată",
  shipped: "Expediată",
  fulfilled: "Livrată",
  cancelled: "Anulată",
};

export function getVendorOrderStatusLabel(order) {
  const status = getVendorOrderStatus(order);
  return STATUS_LABEL_RO[status] || "Nouă";
}

/*
 * Culoare badge status - mapare PROPRIE (nu getQuoteStatusType, care
 * e legată de vocabularul cererilor de ofertă), peste ACELEAȘI 5
 * variante CSS deja existente (quoteChoiceStatus*), fără CSS nou.
 */
export function getVendorOrderStatusType(order) {
  const status = getVendorOrderStatus(order);

  if (status === "new") return "new";
  if (status === "preparing" || status === "confirmed")
    return "discussion";
  if (status === "shipped") return "offer";
  if (status === "fulfilled") return "accepted";
  return "pending"; // cancelled / necunoscut
}

/*
 * "Necesită acțiune" - EXACT regula cerută, nimic altceva: status nou
 * SAU mesaje necitite. Fără nicio altă presupunere.
 */
export function isVendorOrderActionNeeded(order) {
  return (
    getVendorOrderStatus(order) === "new" ||
    Number(order?.messageUnreadCount) > 0
  );
}

export function formatVendorOrderTotal(order) {
  const total = toFiniteNumberOrNull(order?.total);
  if (total === null) return null;
  return `${total.toFixed(2)} RON`;
}

/*
 * Plată - `waitingForCardPayment` are prioritate ABSOLUTĂ (cerință
 * explicită: mesaj clar, fără sugestie de procesare) - restul derivă
 * STRICT din paymentMethod/paymentStatus, deja calculate de backend
 * (computeVendorOrderPaymentState), nimic recalculat aici.
 */
export function getVendorOrderPaymentLabel(order) {
  if (order?.waitingForCardPayment) {
    return "Așteaptă confirmarea plății";
  }

  const method = String(order?.paymentMethod || "").trim().toUpperCase();

  if (method === "COD") return "Ramburs la livrare";

  if (method === "CARD") {
    return order?.paymentStatus === "PAID"
      ? "Card (plătit)"
      : "Card";
  }

  return null;
}

const DEPOSIT_STATUS_LABEL_RO = {
  PENDING: "în așteptare",
  PAID: "plătit",
  FAILED: "eșuat",
  EXPIRED: "expirat",
  REFUNDED: "rambursat",
};

/*
 * Avans - afișat DOAR dacă status !== NOT_REQUESTED (cerință
 * explicită). Strict informativ - nu există nicio scriere aici.
 */
export function hasVendorOrderDeposit(order) {
  const status = order?.deposit?.status;
  return Boolean(status) && status !== "NOT_REQUESTED";
}

/*
 * View-model complet pentru avans (folosit de teste + de card) -
 * separat de summary-ul text, ca fiecare câmp (status/requestedAmount/
 * paidAmount/remainingCodAmount) să poată fi verificat independent.
 */
export function buildVendorOrderDepositDetails(order) {
  if (!hasVendorOrderDeposit(order)) return null;

  const deposit = order.deposit || {};
  const status = String(deposit.status || "").toUpperCase();

  const requestedAmount = toFiniteNumberOrNull(
    deposit.requestedAmount
  );

  const paidAmount = toFiniteNumberOrNull(deposit.paidAmount);

  const remainingCodAmount = toFiniteNumberOrNull(
    deposit.remainingCodAmount
  );

  return {
    status,
    statusLabel: DEPOSIT_STATUS_LABEL_RO[status] || status.toLowerCase(),
    requestedAmount,
    paidAmount,
    remainingCodAmount,
  };
}

/*
 * Text SCURT pentru card ("Avans plătit: 100 RON", "Avans în
 * așteptare: 50 RON", "Avans rambursat") - amount preferat: paidAmount
 * dacă există, altfel requestedAmount.
 */
export function formatVendorOrderDepositSummary(order) {
  const details = buildVendorOrderDepositDetails(order);
  if (!details) return null;

  const amount =
    details.paidAmount != null
      ? details.paidAmount
      : details.requestedAmount;

  const amountText =
    amount != null ? `: ${amount} RON` : "";

  const remainingText =
    details.remainingCodAmount != null
      ? ` (rest ramburs ${details.remainingCodAmount} RON)`
      : "";

  return `Avans ${details.statusLabel}${amountText}${remainingText}`;
}

function formatVendorOrderDate(order) {
  const raw = order?.createdAt;
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString("ro-RO");
}

function getOrderTitle(order) {
  const number = order?.orderNumber || order?.shortId;
  return number ? `Comandă #${number}` : "Comandă";
}

/*
 * Construiește O SINGURĂ "choice" pentru lista de carduri compacte -
 * randată de VendorOrderChoiceCard din AssistantMessage.jsx (nou,
 * dar reutilizează ACELEAȘI clase CSS quoteChoice* deja existente,
 * fără imagine - listele de comenzi nu au thumbnail la nivel de
 * listă, confirmat prin audit). `order` rămâne obiectul brut din
 * fetch, necesar pentru navigare (/vendor/orders/:id) și pentru
 * "Vezi conversația" (messageThreadId, dacă există).
 */
export function buildVendorOrderLeadCard(order) {
  const id = order?.id || null;
  const actionNeeded = isVendorOrderActionNeeded(order);
  const paymentLabel = getVendorOrderPaymentLabel(order);
  const depositSummary = formatVendorOrderDepositSummary(order);
  const unreadCount = Number(order?.messageUnreadCount) || 0;

  const itemsCount = toFiniteNumberOrNull(order?.itemsCount);

  const detailParts = [
    actionNeeded ? "Necesită acțiune" : null,
    order?.customerName || null,
    formatVendorOrderDate(order),
    formatVendorOrderTotal(order),
    paymentLabel,
    itemsCount !== null
      ? `${itemsCount} produs${itemsCount === 1 ? "" : "e"}`
      : null,
    unreadCount > 0
      ? `${unreadCount} mesaj${unreadCount === 1 ? "" : "e"} necitit${
          unreadCount === 1 ? "" : "e"
        }`
      : null,
    depositSummary,
  ].filter(Boolean);

  const description = [
    ...detailParts,
    getVendorOrderStatusLabel(order),
  ].join(" · ");

  return {
    id,
    vendorOrder: true,

    label: getOrderTitle(order),
    title: getOrderTitle(order),

    description,

    statusType: getVendorOrderStatusType(order),

    order,

    actionNeeded,
    waitingForCardPayment: Boolean(order?.waitingForCardPayment),
    messageThreadId: order?.messageThreadId || null,
  };
}

export function buildVendorOrderLeadCards(orders, limit = DEFAULT_LIMIT) {
  return pickTopVendorOrderLeads(orders, limit).map(
    buildVendorOrderLeadCard
  );
}

/*
 * Merge non-blocant al thread-meta (messageThreadId/messageUnreadCount)
 * peste lista de bază - EXACT pattern-ul deja folosit de Orders.jsx
 * (GET /orders/thread-meta), doar extras ca funcție pură/testabilă.
 */
export function mergeVendorOrderThreadMeta(orders, threadMetaById) {
  const list = Array.isArray(orders) ? orders : [];
  const meta = threadMetaById && typeof threadMetaById === "object"
    ? threadMetaById
    : {};

  return list.map((order) => {
    const entry = meta[order?.id];
    if (!entry) return order;

    return {
      ...order,
      messageThreadId:
        entry.messageThreadId ?? order.messageThreadId ?? null,
      messageUnreadCount:
        entry.messageUnreadCount ?? order.messageUnreadCount ?? 0,
    };
  });
}
