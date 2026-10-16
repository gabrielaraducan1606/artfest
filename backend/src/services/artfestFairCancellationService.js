// backend/src/services/artfestFairCancellationService.js
//
// Târgul Artfest - anularea de către Admin a unei participări deja APPROVED.
//
// Separată de „Respinge”: REJECTED rămâne doar pentru înscrierile care nu au
// fost niciodată aprobate; APPROVED -> CANCELLED doar de aici; CANCELLED e final.
//
// Totul într-o singură tranzacție, cu lock-urile în aceeași ordine ca
// trimiterea inventarului și recepția (fără blocaje reciproce):
//   1. lock pe înscriere (același ca la trimiterea inventarului);
//   2. lock pe fiecare produs (sortat), apoi pe fiecare linie (sortat);
//   3. liniile se recitesc după lock-uri.
//
// Inventarul:
//   DRAFT                      -> CANCELLED (nu are rezervare online);
//   SUBMITTED, neexpediat      -> CANCELLED + rezervarea online eliberată
//                                 (releaseOnlineReservation: sigur, cu SKIPPED);
//   SUBMITTED, deja expediat   -> rămâne SUBMITTED („în tranzit”), rezervarea
//                                 rămâne activă; se tratează la recepție + retur;
//   RECEIVED                   -> rămâne RECEIVED, blocată imediat de la vânzare
//                                 (motivul anterior, dacă exista, se păstrează);
//   REJECTED / CANCELLED / CLOSED -> neschimbate.
//
// Taxa și costul returului: aplicația NU mută bani și NU modifică decontul;
// regula derivată din cauză e doar întoarsă Adminului.

import { prisma } from "../db.js";
import {
  CANCELLATION_CAUSES,
  CANCELLATION_RULES,
  PARTICIPATION_CANCELLED_BLOCK_REASON,
} from "../config/artfestFair.js";
import {
  FairError,
  cancellationRulesFor,
  getRegistrationForAdmin,
  writeRegistrationEvent,
} from "./artfestFairService.js";
import { lockProductForFair } from "./fairProductLock.js";
import {
  cleanText,
  lockLine,
  releaseOnlineReservation,
  requireIdempotencyKey,
  writeEvent,
} from "./artfestFairReceptionService.js";

const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
const AFFECTED_STATUSES = ["DRAFT", "SUBMITTED", "RECEIVED"];

export async function lockRegistration(tx, registrationId) {
  // aceeași cheie ca la trimiterea inventarului (artfestFairInventoryService.submitInventory)
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-fair-submit:${registrationId}`}))`;
}

function parseInput(body = {}) {
  const fields = {};
  const cause = String(body.cause || "").trim();
  if (!CANCELLATION_CAUSES.includes(cause)) fields.cause = "Alege cauza anulării.";

  let reason = null;
  try {
    reason = cleanText(body.reason);
  } catch {
    fields.reason = "Motivul poate avea maximum 2000 de caractere.";
  }
  if (!fields.reason && (!reason || reason.length < 3)) fields.reason = "Motivul intern este obligatoriu.";

  let messageForVendor = null;
  try {
    messageForVendor = cleanText(body.messageForVendor);
  } catch {
    fields.messageForVendor = "Mesajul poate avea maximum 2000 de caractere.";
  }

  if (typeof body.goodsAlreadyShipped !== "boolean") {
    fields.goodsAlreadyShipped = "Spune dacă produsele au fost deja expediate.";
  }

  if (Object.keys(fields).length) {
    throw new FairError(400, "invalid_cancellation", "Verifică datele anulării.", { fields });
  }
  return { cause, reason, messageForVendor, goodsAlreadyShipped: body.goodsAlreadyShipped };
}

/* ===================== Previzualizare (modalul Admin) ===================== */

export function summarizeLines(lines, goodsAlreadyShipped) {
  const summary = { draftToCancel: 0, submittedToCancel: 0, inTransit: 0, atArtfest: 0, rejectedAtArtfest: 0 };
  for (const line of lines) {
    if (line.status === "DRAFT") summary.draftToCancel += 1;
    else if (line.status === "SUBMITTED") {
      if (goodsAlreadyShipped) summary.inTransit += 1;
      else summary.submittedToCancel += 1;
    } else if (line.status === "RECEIVED") summary.atArtfest += 1;
    if ((line.rejectedQty || 0) > (line.rejectedReturnedQty || 0)) summary.rejectedAtArtfest += 1;
  }
  summary.linesToCancel = summary.draftToCancel + summary.submittedToCancel;
  return summary;
}

export async function previewCancellation({ id, db = prisma }) {
  const registration = await db.artfestFairRegistration.findUnique({
    where: { id: String(id || "") },
    select: { id: true, status: true },
  });
  if (!registration) throw new FairError(404, "registration_not_found", "Înscrierea nu există.");

  const lines = await db.artfestFairInventoryItem.findMany({
    where: { registrationId: registration.id },
    select: { status: true, rejectedQty: true, rejectedReturnedQty: true },
  });

  return {
    status: registration.status,
    canCancel: registration.status === "APPROVED",
    rules: CANCELLATION_RULES,
    ifNotShipped: summarizeLines(lines, false),
    ifShipped: summarizeLines(lines, true),
  };
}

/* ===================== Anularea ===================== */

export async function cancelParticipation({ id, body = {}, idempotencyKey, adminId, db = prisma, now = new Date() }) {
  const key = requireIdempotencyKey(idempotencyKey);
  const input = parseInput(body);

  const outcome = await db.$transaction(async (tx) => {
    const found = await tx.artfestFairRegistration.findUnique({
      where: { id: String(id || "") },
      select: { id: true },
    });
    if (!found) throw new FairError(404, "registration_not_found", "Înscrierea nu există.");

    await lockRegistration(tx, found.id);

    // recitită sub lock
    const registration = await tx.artfestFairRegistration.findUnique({
      where: { id: found.id },
      select: { id: true, fairId: true, vendorId: true, status: true },
    });

    if (registration.status === "CANCELLED") {
      // aceeași anulare retrimisă (dublu click / retry)
      const previous = await tx.artfestFairRegistrationEvent.findFirst({
        where: { registrationId: registration.id, type: "CANCELLED", metadata: { path: ["idempotencyKey"], equals: key } },
      });
      if (previous) return { replayed: true, summary: previous.metadata?.summary || null };
    }
    if (registration.status !== "APPROVED") {
      const message =
        registration.status === "CANCELLED"
          ? "Participarea este deja anulată."
          : "Doar o participare aprobată poate fi anulată. Pentru o înscriere neaprobată folosește „Respinge”.";
      throw new FairError(409, "invalid_transition", message, { currentStatus: registration.status });
    }

    const candidates = await tx.artfestFairInventoryItem.findMany({
      where: { registrationId: registration.id, status: { in: AFFECTED_STATUSES } },
      select: { id: true, productId: true },
    });

    const productIds = [...new Set(candidates.map((l) => l.productId).filter(Boolean))].sort();
    for (const productId of productIds) await lockProductForFair(tx, productId);
    const lineIds = candidates.map((l) => l.id).sort();
    for (const lineId of lineIds) await lockLine(tx, lineId);

    const lines = await tx.artfestFairInventoryItem.findMany({ where: { id: { in: lineIds } } });
    const summary = summarizeLines(lines, input.goodsAlreadyShipped);
    const actorUserId = adminId || null;

    for (const line of lines.sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (line.status === "DRAFT") {
        const res = await tx.artfestFairInventoryItem.updateMany({
          where: { id: line.id, status: "DRAFT" },
          data: { status: "CANCELLED", cancelledAt: now },
        });
        if (res.count !== 1) throw new FairError(409, "inventory_conflict", "Inventarul s-a modificat între timp. Încearcă din nou.");
        await writeEvent(tx, line, "REGISTRATION_CANCELLED", {
          before: { status: "DRAFT" },
          after: { status: "CANCELLED" },
          actorUserId,
        });
        continue;
      }

      if (line.status === "SUBMITTED" && !input.goodsAlreadyShipped) {
        const releaseData = await releaseOnlineReservation(tx, line, { actorUserId, now });
        const res = await tx.artfestFairInventoryItem.updateMany({
          where: { id: line.id, status: "SUBMITTED" },
          data: { status: "CANCELLED", cancelledAt: now, ...releaseData },
        });
        if (res.count !== 1) throw new FairError(409, "inventory_conflict", "Inventarul s-a modificat între timp. Încearcă din nou.");
        await writeEvent(tx, line, "REGISTRATION_CANCELLED", {
          before: { status: "SUBMITTED" },
          after: { status: "CANCELLED", onlineReservation: line.onlineReservationMode, released: true },
          actorUserId,
        });
        continue;
      }

      if (line.status === "SUBMITTED") {
        // coletul e pe drum: rezervarea rămâne, produsul nu redevine cumpărabil online
        await writeEvent(tx, line, "REGISTRATION_CANCELLED", {
          before: { status: "SUBMITTED" },
          after: { status: "SUBMITTED", inTransit: true, onlineReservation: line.onlineReservationMode, released: false },
          actorUserId,
        });
        continue;
      }

      if (line.status === "RECEIVED") {
        if (!line.saleBlockedAt) {
          const res = await tx.artfestFairInventoryItem.updateMany({
            where: { id: line.id, saleBlockedAt: null },
            data: { saleBlockedAt: now, saleBlockedReason: PARTICIPATION_CANCELLED_BLOCK_REASON, saleBlockedById: actorUserId },
          });
          if (res.count !== 1) throw new FairError(409, "inventory_conflict", "Inventarul s-a modificat între timp. Încearcă din nou.");
          await writeEvent(tx, line, "SALE_BLOCKED", { after: { reason: PARTICIPATION_CANCELLED_BLOCK_REASON }, actorUserId });
        }
        await writeEvent(tx, line, "REGISTRATION_CANCELLED", {
          before: { status: "RECEIVED", saleBlockedReason: line.saleBlockedReason || null },
          after: {
            status: "RECEIVED",
            saleBlocked: true,
            // blocarea anterioară (alt motiv) se păstrează, nu se suprascrie
            keptPreviousBlock: Boolean(line.saleBlockedAt),
          },
          actorUserId,
        });
      }
    }

    const updated = await tx.artfestFairRegistration.updateMany({
      where: { id: registration.id, status: "APPROVED" },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledById: actorUserId,
        cancellationCause: input.cause,
        cancellationReason: input.reason,
        cancellationMessageForVendor: input.messageForVendor,
        cancellationGoodsShipped: input.goodsAlreadyShipped,
      },
    });
    if (updated.count !== 1) {
      throw new FairError(409, "invalid_transition", "Statusul înscrierii s-a schimbat între timp.");
    }

    await writeRegistrationEvent(tx, registration, "CANCELLED", {
      actorUserId,
      reason: input.reason,
      vendorMessage: input.messageForVendor,
      before: { status: "APPROVED" },
      after: { status: "CANCELLED" },
      metadata: {
        idempotencyKey: key,
        cause: input.cause,
        goodsAlreadyShipped: input.goodsAlreadyShipped,
        rules: cancellationRulesFor(input.cause),
        summary,
      },
    });

    return { replayed: false, summary };
  }, TX_OPTIONS);

  const item = await getRegistrationForAdmin({ id, db });
  return { ...outcome, item, rules: item.cancellation?.rules || null };
}
