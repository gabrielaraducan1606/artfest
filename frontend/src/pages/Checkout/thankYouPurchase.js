// src/pages/Checkout/thankYouPurchase.js
//
// Logica pură a paginii /multumim (fără React) - testată în
// thankYouPurchase.test.js.
//
// /multumim e SINGURUL loc care raportează achiziția (GA4 purchase,
// conversia Google Ads, Meta Purchase). După plata cu cardul, Stripe
// trimite clientul aici (success_url, payments/orchestrator.js):
//   user:  /multumim?order=<id>&payment=success
//   guest: /multumim?order=<id>&token=<guestAccessToken>&payment=success
//          (sau &paymentToken=<token> din reminder-ul de plată)
// Webhook-ul Stripe poate ajunge cu câteva secunde după client, deci
// pentru CARD neconfirmat încă reîncercăm citirea comenzii de câteva ori.

export const PURCHASE_TRACKED_PREFIX = "purchase-tracked:";

export const CARD_CONFIRMATION_POLL = {
  intervalMs: 2500,
  maxAttempts: 8,
};

/*
 * Cum citim comanda: guest (token în URL) are prioritate față de sesiune -
 * comenzile guest nu aparțin niciunui cont, deci /api/user/orders/:id
 * le-ar întoarce 404 chiar dacă vizitatorul e autentificat.
 */
export function getThankYouOrderAccess(params, me) {
  const get = (key) => {
    const value = params?.get?.(key);
    return value ? String(value).trim() : "";
  };

  const orderId = get("order");
  if (!orderId) return null;

  const token = get("token");
  if (token) {
    return { kind: "guest", orderId, tokenParam: "token", token };
  }

  const paymentToken = get("paymentToken");
  if (paymentToken) {
    return {
      kind: "guest",
      orderId,
      tokenParam: "paymentToken",
      token: paymentToken,
    };
  }

  if (me) {
    return { kind: "user", orderId };
  }

  return null;
}

export function getOrderApiPath(access) {
  if (!access) return null;

  const id = encodeURIComponent(access.orderId);

  if (access.kind === "guest") {
    return `/api/guest/orders/${id}?${access.tokenParam}=${encodeURIComponent(
      access.token
    )}`;
  }

  return `/api/user/orders/${id}`;
}

export function getGuestOrderPath(access) {
  if (access?.kind !== "guest") return null;

  return `/comanda-guest/${encodeURIComponent(access.orderId)}?${
    access.tokenParam
  }=${encodeURIComponent(access.token)}`;
}

/*
 * Decizia de raportare, STRICT pe datele din backend:
 *   - COD: comanda plasată = achiziție;
 *   - CARD: doar cu plata confirmată (Order.status PAID sau paidAt);
 *   - comandă anulată sau total invalid: niciodată.
 */
export function getPurchaseDecision(data) {
  const paymentMethod = String(data?.paymentMethod || "")
    .trim()
    .toUpperCase();

  const orderStatus = String(data?.orderStatus || "")
    .trim()
    .toUpperCase();

  const total = Number(data?.total);
  const isCancelled = orderStatus === "CANCELLED";

  const isCod = paymentMethod === "COD";
  const isPaidCard =
    paymentMethod === "CARD" &&
    (orderStatus === "PAID" || Boolean(data?.paidAt));
  const isPendingCard =
    paymentMethod === "CARD" && !isPaidCard && !isCancelled;

  const shouldTrack =
    !isCancelled &&
    (isCod || isPaidCard) &&
    Number.isFinite(total) &&
    total > 0;

  return {
    paymentMethod,
    orderStatus,
    total,
    currency: data?.currency || "RON",
    isCod,
    isPaidCard,
    isPendingCard,
    isCancelled,
    shouldTrack,
  };
}

/*
 * Reîncercăm DOAR la întoarcerea din Stripe cu succes (payment=success)
 * și doar cât plata nu e confirmată - nu la o vizită oarecare.
 */
export function shouldPollForCardConfirmation(
  decision,
  { paymentReturn, attempt, maxAttempts = CARD_CONFIRMATION_POLL.maxAttempts }
) {
  return (
    paymentReturn === "success" &&
    decision?.isPendingCard === true &&
    attempt < maxAttempts
  );
}

/*
 * Deduplicare per comandă în acest browser (refresh, revenire pe
 * /multumim, retry de plată care aterizează din nou aici). GA4 și
 * Google Ads deduplică oricum după transaction_id.
 */
function safeStorage(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function wasPurchaseTracked(orderId, storage) {
  try {
    const s = safeStorage(storage);
    return Boolean(s?.getItem(`${PURCHASE_TRACKED_PREFIX}${orderId}`));
  } catch {
    return false;
  }
}

export function markPurchaseTracked(orderId, storage) {
  try {
    safeStorage(storage)?.setItem(
      `${PURCHASE_TRACKED_PREFIX}${orderId}`,
      new Date().toISOString()
    );
  } catch {
    // stocare indisponibilă - rămâne protecția per montare (ref)
  }
}

/*
 * Un singur punct de decizie + raportare: întoarce true dacă a raportat.
 * `track` primește payload-ul pentru trackPurchase (analytics.js).
 */
export function trackPurchaseOnce({
  orderId,
  data,
  trackedRef,
  track,
  storage,
}) {
  const decision = getPurchaseDecision(data);

  if (
    !orderId ||
    !decision.shouldTrack ||
    trackedRef?.current ||
    wasPurchaseTracked(orderId, storage)
  ) {
    return false;
  }

  if (trackedRef) trackedRef.current = true;

  track({
    id: orderId,
    total: decision.total,
    currency: decision.currency,
    shippingTotal: data?.shippingTotal,
    items: Array.isArray(data?.items) ? data.items : [],
  });

  markPurchaseTracked(orderId, storage);
  return true;
}
