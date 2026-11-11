// backend/src/services/returnNotices.js
//
// Notificările PERSISTENTE ale returului Sameday STANDARD, per AWB:
//   confirmed - „ridicarea prin curier a fost comandată” (AWB de retur confirmat)
//   cancelled - „ridicarea a fost anulată” (anulare CONFIRMATĂ de Sameday)
//
// Fără tabel nou: starea stă în CourierAwb.providerMeta.returnNotices.<kind>
// (cheia naturală = AWB-ul), scrisă ATOMIC (UPDATE condiționat în SQL, nu
// citire-modificare-scriere) și DOAR cât AWB-ul nu are o anulare în curs /
// neconfirmată (cancelState) - acele scrieri folosesc CAS pe updatedAt, iar
// noi incrementăm mereu updatedAt, deci nu se pot suprascrie reciproc.
//
// Stări: PENDING -> SENDING -> SENT
//                          \-> RETRY (eșec SIGUR: serverul de email a refuzat,
//                                    nimic livrat) -> ... -> FAILED după MAX_ATTEMPTS
//                          \-> UNCERTAIN (timeout / conexiune ruptă / proces
//                                    oprit în SENDING: emailul POATE fi plecat)
//        SKIPPED (fără destinatar), SUPERSEDED (AWB anulat înainte de trimitere)
// Incert + Resend cu cheie de idempotență STABILĂ (< 23h) -> RETRY (Resend deduplică);
// payload identic la fiecare încercare (linkul se fixează la prima); in-app: câmpul
// inApp (DONE / PENDING), reluat separat de retryPendingInApp.
// UNCERTAIN și FAILED NU se retrimit automat (fără duplicate fără dovezi):
// Admin le poate retrimite EXPLICIT (resendReturnNotice, auditat).
// Notificările in-app au dedupeKey unic -> recrearea lor e mereu sigură.

import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma as defaultDb } from "../db.js";
import * as mailer from "../lib/mailer.js";
import { createUserNotification, createVendorNotification } from "./notifications.js";
import { returnNoticeEmailParts } from "./returnRequestService.js";

export const NOTICE_KINDS = Object.freeze(["confirmed", "cancelled"]);
export const MAX_ATTEMPTS = 5;
// așteptarea după eșecul încercării n (minute)
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];
// SENDING mai vechi de atât = proces întrerupt în timpul trimiterii
export const SENDING_STALE_MS = 10 * 60 * 1000;
const RESENDABLE = new Set(["UNCERTAIN", "FAILED"]);

const shortId = (id) => String(id || "").slice(-6).toUpperCase();

function assertKind(kind) {
  if (!NOTICE_KINDS.includes(kind)) throw new Error(`return notice kind invalid: ${kind}`);
}

/*
 * UPDATE atomic al lui providerMeta.returnNotices.<kind> (îmbinare cu patch),
 * condiționat de `whereSql` (fragment Prisma.sql pe aliasul "CourierAwb").
 * Niciodată pe un AWB cu anulare în curs / neconfirmată. -> număr de rânduri.
 */
async function patchNotice(db, awbId, kind, patch, whereSql = Prisma.sql`TRUE`) {
  assertKind(kind);
  const json = JSON.stringify(patch);
  return db.$executeRaw`
    UPDATE "CourierAwb"
       SET "providerMeta" = jsonb_set(
             COALESCE("providerMeta", '{}'::jsonb),
             '{returnNotices}',
             COALESCE("providerMeta"->'returnNotices', '{}'::jsonb)
               || jsonb_build_object(${kind}::text, COALESCE("providerMeta"->'returnNotices'->${kind}::text, '{}'::jsonb) || ${json}::jsonb),
             true),
           "updatedAt" = NOW()
     WHERE "id" = ${String(awbId)}
       AND ("providerMeta"->>'cancelState') IS NULL
       AND ${whereSql}`;
}

const stateIs = (kind, states) =>
  Prisma.sql`("providerMeta"->'returnNotices'->${kind}::text->>'state') IN (${Prisma.join(states)})`;
const noticeMissing = (kind) => Prisma.sql`("providerMeta"->'returnNotices'->${kind}::text) IS NULL`;

export function noticeOf(row, kind) {
  const n = row?.providerMeta?.returnNotices?.[kind];
  return n && typeof n === "object" ? n : null;
}

/** Intenția de notificare (o singură dată per AWB și tip). tx = client Prisma / tranzacție. */
export async function queueReturnNotice(tx, { awbId, kind, returnRequestId, now = new Date() }) {
  const n = await patchNotice(
    tx,
    awbId,
    kind,
    { state: "PENDING", attempts: 0, returnRequestId, createdAt: now.toISOString(), nextAttemptAt: now.toISOString() },
    noticeMissing(kind)
  );
  return n === 1;
}

/** Confirmarea încă netrimisă, pe un AWB anulat: nu se mai trimite. -> starea anterioară. */
export async function supersedeConfirmedNotice(tx, row) {
  const prev = noticeOf(row, "confirmed")?.state || null;
  if (prev === "PENDING" || prev === "RETRY") {
    await patchNotice(tx, row.id, "confirmed", { state: "SUPERSEDED", supersededAt: new Date().toISOString() }, stateIs("confirmed", ["PENDING", "RETRY"]));
  }
  return prev;
}

/*
 * Eșec SIGUR (nimic livrat) vs INCERT. Sigur: serverul SMTP a răspuns cu cod de
 * eroare, conectare / autentificare / configurare imposibile, sau API-ul Resend
 * a întors eroare (mailer: deliveryDefinitelyFailed). Restul (timeout, socket
 * închis în timpul trimiterii, erori necunoscute) = incert.
 */
export function isDefiniteSendFailure(err) {
  if (!err) return false;
  // clasificarea explicită a mailer-ului (Resend: classifyResendFailure) are prioritate
  if (err.deliveryUncertain === true) return false;
  if (err.deliveryDefinitelyFailed === true) return true;
  // SMTP: serverul a RĂSPUNS cu cod de eroare -> mesaj neacceptat
  const rc = Number(err.responseCode);
  if (Number.isFinite(rc) && rc >= 400) return true;
  // eșec ÎNAINTE de trimitere; ECONNECTION NU e aici (poate apărea și după DATA)
  return ["EAUTH", "EENVELOPE", "EDNS", "ECONFIG", "ECONNREFUSED", "ENOTFOUND"].includes(String(err.code || ""));
}

async function inAppNotifications({ rr, kind, awbId, awbNumber }) {
  const cancelled = kind === "cancelled";
  const title = cancelled
    ? `Retur #${shortId(rr.id)}: ridicarea prin curier a fost anulată`
    : `Retur #${shortId(rr.id)}: ridicarea prin curier a fost comandată`;
  const meta = { kind: cancelled ? "return_awb_cancelled" : "return_awb_created", returnRequestId: rr.id, awbNumber: awbNumber || null };
  if (rr.userId) {
    await createUserNotification(rr.userId, {
      dedupeKey: `${cancelled ? "return_awb_cancelled" : "return_awb_created"}:${rr.id}:${awbId}`,
      type: "order",
      title,
      body: cancelled
        ? `AWB-ul de retur ${awbNumber || ""} a fost anulat. Nu preda coletul cu această etichetă; te anunțăm când ridicarea este comandată din nou.`.replace(/\s+/g, " ")
        : `AWB-ul de retur ${awbNumber || ""} a fost generat. Pregătește coletul și eticheta; curierul te va contacta pentru ridicare.`.replace(/\s+/g, " "),
      link: `/comanda/${rr.orderId}#retur`,
      meta,
    });
  }
  await createVendorNotification(rr.vendorId, {
    dedupeKey: `${cancelled ? "return_awb_cancelled_vendor" : "return_awb_created_vendor"}:${rr.id}:${awbId}`,
    type: "order",
    title,
    body: cancelled
      ? `AWB-ul de retur ${awbNumber || ""} a fost anulat de echipa Artfest. Ridicarea de la client nu mai are loc pe acest AWB.`.replace(/\s+/g, " ")
      : `AWB-ul de retur ${awbNumber || ""} a fost generat de echipa Artfest. După ridicarea de la client, coletul va fi livrat la adresa ta de ridicare.`.replace(/\s+/g, " "),
    link: `/vendor/orders/${rr.orderId}`,
    meta,
  });
}

/** Cheia de idempotență Resend: STABILĂ per AWB + tip (nu se regenerează la retry). */
export function noticeIdempotencyKey(awbId, kind) {
  return `return-notice/${String(awbId)}/${kind}`;
}

// Resend păstrează cheia 24h; sub acest prag o retrimitere cu aceeași cheie e deduplicată
export const IDEMPOTENT_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;

/*
 * Notificările in-app (dedupeKey unic -> recrearea e sigură). -> true / false.
 * Eșecul NU oprește emailul; e marcat inApp = "PENDING" și reluat de reconciliere.
 */
async function tryInApp({ rr, kind, awbId, awbNumber }) {
  try {
    await inAppNotifications({ rr, kind, awbId, awbNumber });
    return true;
  } catch (e) {
    console.error("[return-notices] notificare in-app eșuată (va fi reluată):", rr.id, kind, e?.message || e);
    return false;
  }
}

/**
 * Trimite O notificare scadentă (PENDING / RETRY cu nextAttemptAt trecut).
 * Revendicare atomică -> două procese nu trimit același email.
 *  - eșec SIGUR (refuzat, nimic livrat)                      -> RETRY ... FAILED
 *  - INCERT, dar cu idempotență Resend (aceeași cheie, < 23h) -> RETRY (Resend deduplică)
 *  - INCERT fără idempotență (SMTP / fereastra depășită)      -> UNCERTAIN (fără retry automat)
 * @returns {Promise<{state:string}|null>} null = nimic de trimis acum
 */
export async function dispatchReturnNotice({ db = defaultDb, awbId, kind, now = new Date() }) {
  assertKind(kind);
  const row = await db.courierAwb.findUnique({
    where: { id: String(awbId || "") },
    select: { id: true, status: true, awbNumber: true, providerMeta: true, shipment: { select: { direction: true, returnRequestId: true } } },
  });
  const notice = noticeOf(row, kind);
  if (!row || !notice || row.shipment?.direction !== "RETURN") return null;

  // confirmarea unui AWB care nu mai e activ (anulat) nu se mai trimite
  if (kind === "confirmed" && row.status !== "CREATED") {
    await supersedeConfirmedNotice(db, row);
    return { state: "SUPERSEDED" };
  }
  if (kind === "cancelled" && row.status !== "CANCELLED") return null;

  const claimId = crypto.randomUUID();
  const attempts = Number(notice.attempts || 0) + 1;
  const idempotencyKey = notice.idempotencyKey || noticeIdempotencyKey(row.id, kind);
  const firstAttemptAt = notice.firstAttemptAt || now.toISOString();
  const claimed = await patchNotice(
    db,
    row.id,
    kind,
    { state: "SENDING", claimId, claimedAt: now.toISOString(), attempts, idempotencyKey, firstAttemptAt },
    Prisma.sql`${stateIs(kind, ["PENDING", "RETRY"])}
      AND COALESCE(("providerMeta"->'returnNotices'->${kind}::text->>'nextAttemptAt')::timestamptz, '-infinity'::timestamptz) <= ${now.toISOString()}::timestamptz`
  );
  if (claimed !== 1) return null;

  const mine = Prisma.sql`("providerMeta"->'returnNotices'->${kind}::text->>'claimId') = ${claimId}`;
  const finish = (patch) => patchNotice(db, row.id, kind, { ...patch, claimId: null }, mine);

  const rr = await db.returnRequest.findUnique({
    where: { id: String(row.shipment.returnRequestId || notice.returnRequestId || "") },
    select: { id: true, userId: true, orderId: true, vendorId: true, status: true },
  });
  if (!rr) {
    await finish({ state: "SKIPPED", inApp: "DONE", lastError: "return_request_missing" });
    return { state: "SKIPPED" };
  }
  // „ridicare comandată” perimată: cererea a fost închisă / respinsă între timp
  if (kind === "confirmed" && rr.status !== "PICKUP_REQUESTED") {
    await finish({ state: "SUPERSEDED", inApp: "DONE", lastError: `request_status_${String(rr.status).toLowerCase()}` });
    return { state: "SUPERSEDED" };
  }

  const inAppOk = await tryInApp({ rr, kind, awbId: row.id, awbNumber: row.awbNumber });
  const inApp = inAppOk ? "DONE" : "PENDING";

  const parts = await returnNoticeEmailParts({ db, returnRequestId: rr.id, kind });
  if (!parts?.to) {
    await finish({ state: "SKIPPED", inApp, lastError: "no_recipient" });
    return { state: "SKIPPED" };
  }
  // payload IDENTIC la fiecare încercare (Resend respinge aceeași cheie cu alt conținut):
  // linkul (cu token semnat, diferit la fiecare generare) se fixează la prima încercare
  const link = notice.link || parts.link || null;
  if (!notice.link && link) await patchNotice(db, row.id, kind, { link }, mine);

  try {
    await mailer.sendReturnStatusEmail({ ...parts, link, idempotencyKey });
  } catch (err) {
    const message = String(err?.message || err || "email_failed").slice(0, 300);
    const backoff = new Date(now.getTime() + BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1] * 60_000).toISOString();
    if (isDefiniteSendFailure(err)) {
      const final = attempts >= MAX_ATTEMPTS;
      await finish({ state: final ? "FAILED" : "RETRY", inApp, lastError: message, lastOutcome: "definite_failure", ...(final ? {} : { nextAttemptAt: backoff }) });
      return { state: final ? "FAILED" : "RETRY" };
    }
    const withinWindow = now.getTime() - Date.parse(firstAttemptAt) < IDEMPOTENT_RETRY_WINDOW_MS;
    if (err?.idempotentRetrySafe === true && withinWindow && attempts < MAX_ATTEMPTS) {
      // poate a plecat, dar retrimiterea cu ACEEAȘI cheie e deduplicată de Resend
      await finish({ state: "RETRY", inApp, lastError: message, lastOutcome: "uncertain_idempotent", nextAttemptAt: backoff });
      return { state: "RETRY" };
    }
    // poate a plecat și nu avem garanție de deduplicare: fără retrimitere automată
    await finish({ state: "UNCERTAIN", inApp, lastError: message, lastOutcome: "uncertain" });
    return { state: "UNCERTAIN" };
  }

  // marcarea poate eșua (DB) -> rămâne SENDING -> UNCERTAIN la recuperare, NU retrimis
  await finish({ state: "SENT", inApp, sentAt: new Date().toISOString(), lastError: null, lastOutcome: "sent" });
  return { state: "SENT" };
}

/**
 * Notificările in-app nefinalizate (eșuate, sau proces oprit în timpul
 * trimiterii) -> reluate, independent de email (dedupeKey -> fără duplicate).
 */
export async function retryPendingInApp({ db = defaultDb, limit = 50 } = {}) {
  const rows = await db.$queryRaw`
    SELECT a."id", k.kind FROM "CourierAwb" a
     CROSS JOIN (VALUES ('confirmed'), ('cancelled')) AS k(kind)
     WHERE (a."providerMeta"->>'cancelState') IS NULL
       AND (a."providerMeta"->'returnNotices'->k.kind) IS NOT NULL
       AND (a."providerMeta"->'returnNotices'->k.kind->>'state') NOT IN ('PENDING', 'SENDING', 'SUPERSEDED')
       AND COALESCE(a."providerMeta"->'returnNotices'->k.kind->>'inApp', '') <> 'DONE'
     LIMIT ${limit}`;
  let done = 0;
  for (const { id, kind } of rows) {
    const awb = await db.courierAwb.findUnique({
      where: { id },
      select: { id: true, awbNumber: true, providerMeta: true, shipment: { select: { returnRequestId: true } } },
    });
    const rr = awb?.shipment?.returnRequestId
      ? await db.returnRequest.findUnique({ where: { id: awb.shipment.returnRequestId }, select: { id: true, userId: true, orderId: true, vendorId: true } })
      : null;
    // „ridicare anulată” fără mesaj către client (SKIPPED de la anulare) -> nimic in-app
    const skipped = noticeOf(awb, kind)?.state === "SKIPPED" && noticeOf(awb, kind)?.lastError !== "no_recipient";
    const ok = !rr || skipped ? true : await tryInApp({ rr, kind, awbId: id, awbNumber: awb.awbNumber });
    if (ok) {
      await patchNotice(db, id, kind, { inApp: "DONE" }, Prisma.sql`TRUE`);
      done++;
    }
  }
  return done;
}

/**
 * SENDING abandonat (proces oprit / restart în timpul trimiterii): emailul POATE
 * fi plecat. Cu Resend + cheie de idempotență stabilă, în fereastra de 23h ->
 * RETRY (retrimiterea cu aceeași cheie e deduplicată); altfel (SMTP, fereastră
 * depășită) -> UNCERTAIN, fără retrimitere automată.
 */
export async function markStaleSendingNotices({ db = defaultDb, now = new Date(), idempotentProvider = null } = {}) {
  const idem = idempotentProvider ?? (typeof mailer.currentMailProvider === "function" && mailer.currentMailProvider() === "resend");
  const cutoff = new Date(now.getTime() - SENDING_STALE_MS).toISOString();
  const windowStart = new Date(now.getTime() - IDEMPOTENT_RETRY_WINDOW_MS).toISOString();
  let total = 0;
  for (const kind of NOTICE_KINDS) {
    total += await db.$executeRaw`
      UPDATE "CourierAwb"
         SET "providerMeta" = jsonb_set("providerMeta", ARRAY['returnNotices', ${kind}::text],
               ("providerMeta"->'returnNotices'->${kind}::text)
                 || CASE
                      WHEN ${idem}::boolean
                       AND ("providerMeta"->'returnNotices'->${kind}::text->>'idempotencyKey') IS NOT NULL
                       AND COALESCE(("providerMeta"->'returnNotices'->${kind}::text->>'firstAttemptAt'), '') > ${windowStart}
                       AND COALESCE(("providerMeta"->'returnNotices'->${kind}::text->>'attempts')::int, 0) < ${MAX_ATTEMPTS}
                      THEN jsonb_build_object('state', 'RETRY', 'claimId', NULL, 'nextAttemptAt', ${now.toISOString()}::text,
                             'lastError', 'interrupted_while_sending', 'lastOutcome', 'uncertain_idempotent')
                      ELSE jsonb_build_object('state', 'UNCERTAIN', 'claimId', NULL, 'lastError', 'interrupted_while_sending', 'lastOutcome', 'uncertain')
                    END, false),
             "updatedAt" = NOW()
       WHERE ("providerMeta"->>'cancelState') IS NULL
         AND ("providerMeta"->'returnNotices'->${kind}::text->>'state') = 'SENDING'
         AND ("providerMeta"->'returnNotices'->${kind}::text->>'claimedAt') < ${cutoff}`;
  }
  return total;
}

/** Admin: retrimitere EXPLICITĂ a unei notificări UNCERTAIN / FAILED (auditată). */
export async function resendReturnNotice({ db = defaultDb, returnRequestId, awbId, kind, adminUserId, now = new Date() }) {
  assertKind(kind);
  const row = await db.courierAwb.findFirst({
    where: { id: String(awbId || ""), shipment: { returnRequestId: String(returnRequestId || ""), direction: "RETURN" } },
    select: { id: true, providerMeta: true },
  });
  const notice = noticeOf(row, kind);
  if (!row || !notice) return { ok: false, code: "notice_not_found" };
  if (!RESENDABLE.has(notice.state)) return { ok: false, code: "notice_not_resendable", state: notice.state };
  const n = await patchNotice(
    db,
    row.id,
    kind,
    {
      state: "PENDING",
      nextAttemptAt: now.toISOString(),
      resends: [...(Array.isArray(notice.resends) ? notice.resends : []), { by: adminUserId || null, at: now.toISOString(), from: notice.state }].slice(-10),
    },
    stateIs(kind, [...RESENDABLE])
  );
  if (n !== 1) return { ok: false, code: "notice_changed" };
  const out = await dispatchReturnNotice({ db, awbId: row.id, kind, now });
  return { ok: true, state: out?.state || "PENDING" };
}

/** Starea notificărilor unui AWB, pentru Admin (fără câmpuri interne). */
export function publicNotices(providerMeta) {
  const all = providerMeta?.returnNotices || {};
  return Object.fromEntries(
    NOTICE_KINDS.filter((k) => all[k]).map((k) => [
      k,
      {
        state: all[k].state,
        attempts: all[k].attempts || 0,
        sentAt: all[k].sentAt || null,
        lastError: all[k].lastError || null,
        nextAttemptAt: all[k].state === "RETRY" ? all[k].nextAttemptAt || null : null,
        resendable: RESENDABLE.has(all[k].state),
      },
    ])
  );
}
