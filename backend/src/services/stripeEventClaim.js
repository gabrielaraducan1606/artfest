// src/services/stripeEventClaim.js
//
// Dedupe / retry pentru webhook-urile Stripe, pe infrastructura EXISTENTĂ
// (modelul StripeEvent: eventId unic, receivedAt, processedAt, error) - fără
// schimbări de schemă.
//
// Problema veche: rândul StripeEvent se crea ÎNAINTE de handler, iar orice
// retrimitere a aceluiași event id era răspunsă cu 200 { duplicate: true },
// chiar dacă prima procesare eșuase (sau chiar dacă `create` cădea din alt
// motiv decât duplicat). Un handler care cădea la jumătate (ex. transfer
// făcut, ledger nescris) nu mai era reluat NICIODATĂ.
//
// Stări (derivate din coloanele existente):
//   PROCESSING  processedAt = null și error = null   (procesare începută)
//   COMPLETED   processedAt != null și error = null  (terminat cu succes)
//   FAILED      error != null                        (handler eșuat; și
//                                                     rândurile istorice,
//                                                     care aveau processedAt
//                                                     setat la eșec)
//
// Reguli:
//   - eveniment nou            -> se procesează;
//   - COMPLETED                -> duplicat real, 200 (nu se reprocesează);
//   - FAILED                   -> retry-ul îl REIA (revendicare atomică);
//   - PROCESSING recent        -> altă procesare în curs: 409, Stripe reîncearcă;
//   - PROCESSING vechi (stale) -> procesarea a murit: se reia (atomic);
//   - eroare DB la create care NU e conflict de unicitate (P2002) NU se mai
//     înghite ca "duplicat": se propagă (500 -> Stripe reîncearcă).
//
// Revendicarea e compare-and-set (updateMany cu starea observată în where):
// două livrări simultane ale aceluiași eveniment FAILED nu pot amândouă
// procesa.
//
// Siguranța reluării stă în idempotența handlerelor (verificată): chei de
// idempotență Stripe + verificare durabilă în ledger pentru transferuri,
// upsert pe shipmentId pentru SALE, PAID-guard pentru avans, upsert/guard
// pentru facturi/abonamente.

export const STRIPE_EVENT_STALE_MS = 10 * 60 * 1000;

export function getStripeEventState(row) {
  if (row?.error) return "FAILED";
  if (row?.processedAt) return "COMPLETED";
  return "PROCESSING";
}

export async function claimStripeEvent({
  prisma,
  event,
  now = new Date(),
  staleMs = STRIPE_EVENT_STALE_MS,
}) {
  try {
    await prisma.stripeEvent.create({
      data: {
        eventId: event.id,
        type: event.type,
        livemode: !!event.livemode,
        payload: event.data?.object ?? {},
      },
    });

    return { action: "process", reason: "new" };
  } catch (error) {
    // Doar conflictul de unicitate înseamnă "eveniment deja văzut".
    if (error?.code !== "P2002") throw error;
  }

  const existing = await prisma.stripeEvent.findUnique({
    where: { eventId: event.id },
    select: { processedAt: true, error: true, receivedAt: true },
  });

  if (!existing) {
    return { action: "in_progress", reason: "missing_after_conflict" };
  }

  const state = getStripeEventState(existing);

  if (state === "COMPLETED") {
    return { action: "duplicate", reason: "completed" };
  }

  if (state === "FAILED") {
    const claimed = await prisma.stripeEvent.updateMany({
      where: {
        eventId: event.id,
        error: existing.error,
        processedAt: existing.processedAt,
      },
      data: { error: null, processedAt: null, receivedAt: now },
    });

    return claimed.count === 1
      ? { action: "process", reason: "retry_failed" }
      : { action: "in_progress", reason: "claim_lost" };
  }

  // PROCESSING
  const ageMs = now.getTime() - new Date(existing.receivedAt).getTime();

  if (ageMs < staleMs) {
    return { action: "in_progress", reason: "processing" };
  }

  const claimed = await prisma.stripeEvent.updateMany({
    where: {
      eventId: event.id,
      processedAt: null,
      error: null,
      receivedAt: existing.receivedAt,
    },
    data: { receivedAt: now },
  });

  return claimed.count === 1
    ? { action: "process", reason: "retry_stale" }
    : { action: "in_progress", reason: "claim_lost" };
}

export async function markStripeEventCompleted({
  prisma,
  eventId,
  now = new Date(),
}) {
  return prisma.stripeEvent.updateMany({
    where: { eventId },
    data: { processedAt: now, error: null },
  });
}

export async function markStripeEventFailed({ prisma, eventId, error }) {
  const message = String(error?.message || error || "handler_failed").slice(
    0,
    2000
  );

  return prisma.stripeEvent.updateMany({
    where: { eventId },
    // processedAt rămâne null: eșecul nu e "procesat definitiv".
    data: { error: message, processedAt: null },
  });
}
