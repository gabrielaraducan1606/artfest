// src/services/cardPaymentExpiry.js
//
// Expirarea comenzilor plătite cu CARDUL și nefinalizate: la 2 ore de la
// plasare, comanda se anulează și stocul se eliberează - DOAR după ce Stripe
// confirmă că nicio plată nu e reușită sau în curs și că nicio sesiune de
// plată a comenzii nu mai poate fi finalizată.
//
// Activare controlată (variabile de mediu):
//   CARD_PAYMENT_EXPIRY_ENABLED   "true" pornește job-ul (implicit oprit)
//   CARD_PAYMENT_EXPIRY_DRY_RUN   implicit "true": doar raportează, fără
//                                 scrieri și fără apeluri Stripe care
//                                 modifică ceva; "false" = expirare reală
//   CARD_PAYMENT_EXPIRY_START_AT  dată ISO, obligatorie: doar comenzile
//                                 plasate de atunci intră în regulă
//                                 (comenzile istorice nu sunt atinse)
// Regula (termen, sesiuni cu expires_at, refuzul reîncercării) se aplică
// doar când e activă de-a binelea: ENABLED=true, DRY_RUN=false, START_AT.
//
// Sesiunile Stripe ale unei comenzi: TOATE sesiunile Checkout cu
// metadata.orderId = comanda, găsite prin listarea sesiunilor create după
// plasarea comenzii (nu doar Order.stripeCheckoutSessionId - fiecare
// reîncercare a creat câte o sesiune nouă).
//
// Ordinea la expirare:
//   1. Stripe: nicio sesiune plătită / în curs; sesiunile deschise se
//      expiră, apoi se reverifică (o stare incertă => amânare);
//   2. o singură tranzacție, în aceeași ordine ca anularea clientului:
//      livrări PENDING -> REFUSED, stoc restaurat (istoric idempotent),
//      coduri de reducere eliberate, comanda PENDING -> CANCELLED
//      condiționat (dacă webhook-ul a marcat-o PAID între timp, totul se
//      anulează);
//   3. după commit: notificare în aplicație pentru vânzător și email
//      pentru client - doar procesul care a câștigat tranzacția ajunge aici.
// O plată târzie pe o sesiune necunoscută rămâne acoperită de webhook
// (refundBlockedOrderPayment: rambursare automată + email).
//
// Nu atinge comisioane, transferuri Stripe Connect sau facturare.

import { prisma as defaultPrisma } from "../db.js";
import { stripe as defaultStripe } from "../lib/stripe.js";
import { restoreOrderItemsStock } from "./inventory/inventoryService.js";

// emailul și notificarea se încarcă la nevoie: modulul e importat și de
// fluxul de plată (orchestrator), fără să depindă de mailer la încărcare
const loadNotifiers = async () => ({
  sendCardPaymentExpiredEmail: (await import("../lib/mailer.js")).sendCardPaymentExpiredEmail,
  createVendorNotification: (await import("./notifications.js")).createVendorNotification,
});

export const CARD_PAYMENT_WINDOW_MS = 2 * 60 * 60 * 1000;

// Stripe: expires_at între 30 de minute și 24 de ore de la crearea sesiunii
const STRIPE_SESSION_MIN_MS = 30 * 60 * 1000;
const STRIPE_SESSION_MAX_MS = 24 * 60 * 60 * 1000;
const SESSION_EXPIRY_MARGIN_MS = 60 * 1000;

// sub atât timp rămas până la termen nu se mai deschide o plată nouă: orice
// sesiune nouă ar trăi (minimul Stripe) dincolo de termenul comenzii
export const CARD_PAYMENT_RETRY_CUTOFF_MS = STRIPE_SESSION_MIN_MS + SESSION_EXPIRY_MARGIN_MS;

// fereastra de căutare a sesiunilor: ușor înainte de plasare (ceasuri diferite)
const SESSION_LOOKBACK_SECONDS = 5 * 60;
// peste atâtea sesiuni scanate nu mai putem confirma nimic => amânare
const MAX_SESSIONS_SCANNED = 5000;

// stări în care plata poate încă să se finalizeze sau e deja în procesare
const UNCERTAIN_INTENT_STATUSES = new Set(["processing", "requires_capture", "requires_action", "requires_confirmation"]);

export const CARD_EXPIRY_CANCEL_REASON = "card_payment_expired";

export function cardPaymentExpiryConfig(env = process.env) {
  const enabled = String(env.CARD_PAYMENT_EXPIRY_ENABLED || "").trim().toLowerCase() === "true";
  const dryRun = String(env.CARD_PAYMENT_EXPIRY_DRY_RUN ?? "true").trim().toLowerCase() !== "false";
  const rawStart = String(env.CARD_PAYMENT_EXPIRY_START_AT || "").trim();
  const startAt = rawStart ? new Date(rawStart) : null;
  const validStart = startAt && !Number.isNaN(startAt.getTime()) ? startAt : null;

  return {
    enabled,
    dryRun,
    startAt: validStart,
    // regula se aplică efectiv (termen pentru comenzi + sesiuni limitate)
    active: enabled && !dryRun && Boolean(validStart),
  };
}

/**
 * Termenul de plată al comenzii, sau null dacă regula nu i se aplică
 * (regulă inactivă, comandă de dinainte de START_AT, sau nu e CARD).
 */
export function cardPaymentDeadline(order, config = cardPaymentExpiryConfig()) {
  if (!config.active || !order?.createdAt) return null;
  if (String(order.paymentMethod || "").toUpperCase() !== "CARD") return null;
  const createdAt = new Date(order.createdAt);
  if (createdAt < config.startAt) return null;
  return new Date(createdAt.getTime() + CARD_PAYMENT_WINDOW_MS);
}

/**
 * expires_at (secunde) pentru o sesiune nouă: termenul comenzii, dar nu
 * mai devreme decât minimul Stripe (30 min) și nu peste 24h. Dacă minimul
 * Stripe depășește termenul, job-ul expiră explicit sesiunea la termen.
 */
export function sessionExpiresAt(deadline, now = new Date()) {
  const min = now.getTime() + STRIPE_SESSION_MIN_MS + SESSION_EXPIRY_MARGIN_MS;
  const max = now.getTime() + STRIPE_SESSION_MAX_MS - SESSION_EXPIRY_MARGIN_MS;
  const target = Math.min(Math.max(deadline.getTime(), min), max);
  return Math.floor(target / 1000);
}

/* ===================== Stripe: sesiunile și plățile comenzii ===================== */

const intentId = (value) => (value && typeof value === "object" ? value.id : value) || null;

/**
 * Toate sesiunile Checkout ale comenzii (metadata.orderId), create după
 * plasarea ei, plus Order.stripeCheckoutSessionId dacă lipsește din listă.
 */
export async function listOrderCheckoutSessions({ order, stripe = defaultStripe }) {
  const gte = Math.floor(new Date(order.createdAt).getTime() / 1000) - SESSION_LOOKBACK_SECONDS;
  const sessions = new Map();
  let scanned = 0;
  let startingAfter;

  for (;;) {
    const page = await stripe.checkout.sessions.list({
      created: { gte },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const session of page.data || []) {
      scanned += 1;
      if (String(session?.metadata?.orderId || "") === String(order.id)) sessions.set(session.id, session);
    }
    if (!page.has_more || !page.data?.length) break;
    if (scanned >= MAX_SESSIONS_SCANNED) {
      const error = new Error("stripe_session_scan_limit");
      error.code = "stripe_session_scan_limit";
      throw error;
    }
    startingAfter = page.data[page.data.length - 1].id;
  }

  if (order.stripeCheckoutSessionId && !sessions.has(order.stripeCheckoutSessionId)) {
    const known = await stripe.checkout.sessions.retrieve(String(order.stripeCheckoutSessionId));
    if (known) sessions.set(known.id, known);
  }

  return [...sessions.values()];
}

/**
 * Starea plății comenzii în Stripe (doar citiri).
 * @returns {{ state: "paid" | "processing" | "unpaid", openSessions, sessions, intents }}
 */
export async function inspectOrderPayment({ order, stripe = defaultStripe }) {
  const sessions = await listOrderCheckoutSessions({ order, stripe });

  const intentIds = new Set(sessions.map((s) => intentId(s.payment_intent)).filter(Boolean));
  if (order.stripePaymentIntentId) intentIds.add(String(order.stripePaymentIntentId));
  const intents = [];
  for (const id of intentIds) intents.push(await stripe.paymentIntents.retrieve(id));

  const paid =
    sessions.some((s) => s.payment_status === "paid") || intents.some((pi) => pi?.status === "succeeded");
  // sesiune finalizată fără plată confirmată (ex. metodă asincronă) sau plată încă în lucru
  const processing =
    sessions.some((s) => s.status === "complete" && s.payment_status !== "paid") ||
    intents.some((pi) => UNCERTAIN_INTENT_STATUSES.has(pi?.status));

  return {
    state: paid ? "paid" : processing ? "processing" : "unpaid",
    openSessions: sessions.filter((s) => s.status === "open"),
    sessions,
    intents,
  };
}

/**
 * Închide toate sesiunile deschise ale comenzii și confirmă că plata nu
 * mai poate fi finalizată. Nu atinge sesiunile plătite / în procesare.
 * @returns {{ state: "closed" | "paid" | "processing" | "uncertain", reason?, expiredSessionIds }}
 */
export async function closeOrderPaymentSessions({ order, stripe = defaultStripe }) {
  const first = await inspectOrderPayment({ order, stripe });
  if (first.state !== "unpaid") return { state: first.state, expiredSessionIds: [] };

  const expiredSessionIds = [];
  for (const session of first.openSessions) {
    try {
      await stripe.checkout.sessions.expire(session.id);
      expiredSessionIds.push(session.id);
    } catch (error) {
      // sesiunea s-a închis între timp (expirată / finalizată) - reverificarea decide
      console.warn("[card expiry] session expire failed:", session.id, error?.message || error);
    }
  }

  // reverificare completă: nimic plătit / în curs, nicio sesiune deschisă
  const second = await inspectOrderPayment({ order, stripe });
  if (second.state !== "unpaid") return { state: second.state, expiredSessionIds };
  if (second.openSessions.length) {
    return { state: "uncertain", reason: "session_still_open", expiredSessionIds };
  }
  return { state: "closed", expiredSessionIds };
}

/* ===================== anulări manuale ===================== */

/** CARD, încă neplătită (și neanulată). */
export function isUnpaidCardOrder(order) {
  return (
    String(order?.paymentMethod || "").toUpperCase() === "CARD" &&
    !["PAID", "CANCELLED", "FULFILLED"].includes(order?.status) &&
    !order?.paidAt &&
    !order?.stripeChargeId
  );
}

/**
 * Anulare manuală (client / vendor / Admin) a unei comenzi CARD
 * neplătite: înainte de a elibera stocul, nicio sesiune Stripe a comenzii
 * nu mai trebuie să poată fi plătită. Sesiunile deschise se închid; o plată
 * reușită sau în curs (ori o verificare imposibilă) oprește anularea.
 * Independentă de CARD_PAYMENT_EXPIRY_ENABLED.
 *
 * @returns null dacă anularea poate continua, altfel { status, error, message }
 */
export async function guardUnpaidCardCancellation({ order, stripe = defaultStripe }) {
  let result;
  try {
    result = await closeOrderPaymentSessions({ order, stripe });
  } catch (error) {
    console.error("[card cancel] Stripe check failed:", order?.id, error?.message || error);
    return {
      status: 503,
      error: "card_payment_check_failed",
      message: "Nu am putut verifica plata cu cardul a comenzii. Te rugăm să încerci din nou peste câteva minute.",
    };
  }

  if (result.state === "closed") return null;
  if (result.state === "paid") {
    return {
      status: 409,
      error: "card_payment_confirming",
      message:
        "Plata cu cardul pentru această comandă a fost finalizată și este în curs de confirmare. Te rugăm să încerci din nou peste câteva minute.",
    };
  }
  return {
    status: 409,
    error: "card_payment_in_progress",
    message: "O plată cu cardul pentru această comandă este în curs de procesare. Te rugăm să încerci din nou peste câteva minute.",
  };
}

/** Comanda a fost anulată automat pentru că plata CARD nu a fost finalizată la termen. */
export function isCardPaymentExpiredOrder(order) {
  return (
    order?.status === "CANCELLED" &&
    (order.shipments || []).some((s) => s?.cancelReason === CARD_EXPIRY_CANCEL_REASON)
  );
}

/* ===================== coduri de reducere ===================== */

/**
 * Eliberează utilizările codurilor de reducere consumate EFECTIV de comandă
 * (un DiscountCodeRedemption există doar dacă codul a fost folosit).
 * Idempotent: rândul se șterge o singură dată, iar usedCount scade doar
 * pentru rândul șters.
 */
export async function releaseOrderDiscountCodes(tx, orderId) {
  const redemptions = await tx.discountCodeRedemption.findMany({
    where: { orderId },
    select: { id: true, discountCodeId: true },
  });

  let released = 0;
  for (const redemption of redemptions) {
    const removed = await tx.discountCodeRedemption.deleteMany({ where: { id: redemption.id } });
    if (removed.count !== 1) continue;
    await tx.discountCode.updateMany({
      where: { id: redemption.discountCodeId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    released += 1;
  }
  return released;
}

/* ===================== expirarea unei comenzi ===================== */

const ORDER_INCLUDE = {
  user: { select: { email: true } },
  shipments: {
    select: {
      id: true,
      vendorId: true,
      status: true,
      direction: true,
      items: { select: { id: true, shipmentId: true, productId: true, qty: true, variantIdSnapshot: true } },
    },
  },
};

function eligibility(order, config, now) {
  if (!order) return "order_not_found";
  if (String(order.paymentMethod || "").toUpperCase() !== "CARD") return "not_card";
  if (order.status !== "PENDING" || order.paidAt || order.stripeChargeId) return "not_pending_unpaid";
  const deadline = cardPaymentDeadline(order, { ...config, active: Boolean(config.startAt) });
  if (!deadline) return "before_start_at";
  if (deadline > now) return "not_due";
  const outbound = order.shipments.filter((s) => String(s.direction || "OUTBOUND") !== "RETURN");
  // livrările anulate deja (ex. de vendor) nu blochează expirarea celorlalte
  const open = outbound.filter((s) => !CANCELLED_SHIPMENT_STATUSES.includes(s.status));
  if (!open.length || open.some((s) => s.status !== "PENDING")) return "shipments_not_pending";
  return null;
}

const CANCELLED_SHIPMENT_STATUSES = ["REFUSED", "RETURNED"];

function appendNote(adminNotes, text, now) {
  const line = `[${now.toISOString()} | card-expiry] ${text}`;
  const old = String(adminNotes || "").trim();
  return old ? `${old}\n${line}` : line;
}

/**
 * Expiră o comandă CARD neplătită, dacă e scadentă și Stripe confirmă că
 * plata nu mai poate fi finalizată.
 *
 * @returns {{ orderId, result: "expired" | "deferred" | "skipped" | "would_expire" | "would_defer", reason? }}
 */
export async function expireUnpaidCardOrder({
  orderId,
  now = new Date(),
  config = cardPaymentExpiryConfig(),
  dryRun = config.dryRun,
  prisma = defaultPrisma,
  stripe = defaultStripe,
}) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
  const notEligible = eligibility(order, config, now);
  if (notEligible) return { orderId, result: "skipped", reason: notEligible };

  if (dryRun) {
    // doar citiri: nicio sesiune expirată, nicio scriere
    const inspection = await inspectOrderPayment({ order, stripe });
    return inspection.state === "unpaid"
      ? { orderId, result: "would_expire", openSessions: inspection.openSessions.length }
      : { orderId, result: "would_defer", reason: inspection.state };
  }

  const stripeState = await closeOrderPaymentSessions({ order, stripe });
  if (stripeState.state !== "closed") {
    return { orderId, result: "deferred", reason: stripeState.reason || stripeState.state };
  }

  const outbound = order.shipments.filter(
    (s) => String(s.direction || "OUTBOUND") !== "RETURN" && s.status === "PENDING"
  );
  let releasedCodes = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // aceeași ordine ca anularea clientului: livrări, stoc, comandă
      const shipments = await tx.shipment.updateMany({
        where: { id: { in: outbound.map((s) => s.id) }, status: "PENDING" },
        data: {
          status: "REFUSED",
          refusedAt: now,
          cancelReason: CARD_EXPIRY_CANCEL_REASON,
          cancelReasonNote: "Plata cu cardul nu a fost finalizată în 2 ore de la plasarea comenzii.",
        },
      });
      if (shipments.count !== outbound.length) throw new Error("order_already_changed");

      await restoreOrderItemsStock(
        tx,
        outbound.flatMap((s) => s.items),
        { reason: "PAYMENT_EXPIRED" }
      );

      releasedCodes = await releaseOrderDiscountCodes(tx, order.id);

      // condiționat: dacă webhook-ul a marcat-o PAID între timp -> P2025 -> totul se anulează
      await tx.order.update({
        where: { id: order.id, status: "PENDING", paidAt: null, stripeChargeId: null },
        data: {
          status: "CANCELLED",
          adminNotes: appendNote(
            order.adminNotes,
            `Comandă anulată automat: plata CARD nefinalizată în 2 ore. Sesiuni Stripe expirate: ${
              stripeState.expiredSessionIds.join(", ") || "-"
            }. Coduri de reducere eliberate: ${releasedCodes}.`,
            now
          ),
        },
      });
    });
  } catch (error) {
    if (error?.message === "order_already_changed" || error?.code === "P2025") {
      return { orderId, result: "skipped", reason: "order_changed_concurrently" };
    }
    throw error;
  }

  await notifyCardPaymentExpired({ order, outbound });
  return { orderId, result: "expired", releasedCodes, expiredSessions: stripeState.expiredSessionIds.length };
}

async function notifyCardPaymentExpired({ order, outbound }) {
  const displayNo = order.orderNumber || order.id;
  const { sendCardPaymentExpiredEmail, createVendorNotification } = await loadNotifiers();

  for (const vendorId of [...new Set(outbound.map((s) => s.vendorId).filter(Boolean))]) {
    try {
      await createVendorNotification(vendorId, {
        dedupeKey: `order_card_payment_expired:${order.id}:${vendorId}`,
        type: "order",
        title: "Comandă expirată",
        body: `Comanda #${displayNo} a fost anulată automat: clientul nu a finalizat plata cu cardul în 2 ore. Produsele au revenit în stoc.`,
        link: "/vendor/orders",
        meta: { kind: "order_card_payment_expired", orderId: order.id },
      });
    } catch (error) {
      console.error("[card expiry] vendor notification failed:", order.id, vendorId, error?.message || error);
    }
  }

  const to = order.user?.email || order.customerEmail || order.shippingAddress?.email || null;
  if (!to) return;
  try {
    await sendCardPaymentExpiredEmail({
      to,
      order,
      userId: order.userId || null,
    });
  } catch (error) {
    console.error("[card expiry] customer email failed:", order.id, error?.message || error);
  }
}

/* ===================== job ===================== */

/**
 * Comenzile scadente (cele mai vechi întâi), în loturi. Fără START_AT nu
 * face nimic - comenzile istorice nu intră niciodată retroactiv.
 */
export async function runCardPaymentExpiryJob({
  now = new Date(),
  config = cardPaymentExpiryConfig(),
  dryRun = config.dryRun,
  prisma = defaultPrisma,
  stripe = defaultStripe,
  limit = 50,
} = {}) {
  if (!config.startAt) {
    console.warn("[card expiry] CARD_PAYMENT_EXPIRY_START_AT lipsește - nimic de făcut");
    return { results: [] };
  }

  const candidates = await prisma.order.findMany({
    where: {
      paymentMethod: "CARD",
      status: "PENDING",
      paidAt: null,
      stripeChargeId: null,
      createdAt: { gte: config.startAt, lte: new Date(now.getTime() - CARD_PAYMENT_WINDOW_MS) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
    take: limit,
  });

  const results = [];
  for (const { id } of candidates) {
    try {
      results.push(await expireUnpaidCardOrder({ orderId: id, now, config, dryRun, prisma, stripe }));
    } catch (error) {
      console.error("[card expiry] order failed:", id, error?.message || error);
      results.push({ orderId: id, result: "deferred", reason: error?.code || error?.message || "error" });
    }
  }

  const summary = results.reduce((acc, r) => ({ ...acc, [r.result]: (acc[r.result] || 0) + 1 }), {});
  console.log(`[card expiry]${dryRun ? " [VERIFICARE]" : ""} ${candidates.length} comenzi scadente:`, JSON.stringify(summary));
  return { results };
}
