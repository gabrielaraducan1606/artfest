// backend/src/integrations/core/syncQueue.js
//
// Coada persistentă a sincronizărilor (ExternalSyncJob, în Postgres).
//
//   - idempotență la adăugare: dedupeKey unic cât timp jobul e activ
//     (QUEUED / RUNNING); același lucru nu se pune de două ori în coadă;
//   - preluare sigură între instanțe: UPDATE ... FOR UPDATE SKIP LOCKED;
//   - reîncercări cu pauză crescătoare pentru erorile tranzitorii
//     (IntegrationError.retryable), DEAD după maxAttempts sau la erori
//     definitive; cheia de deduplicare se eliberează la final;
//   - joburile blocate (proces oprit în timpul rulării) se reiau;
//   - conexiunile pe pauză / deconectate nu primesc joburi la rulare.
//
// Workerul NU pornește automat: EXTERNAL_SYNC_WORKER_ENABLED=true (implicit
// oprit) și pornirea explicită din server (încă neconectată).

import crypto from "node:crypto";

import { isRetryable } from "./errors.js";

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const STALE_RUNNING_MS = 15 * 60 * 1000;

export function isSyncWorkerEnabled(env = process.env) {
  return String(env.EXTERNAL_SYNC_WORKER_ENABLED || "").trim().toLowerCase() === "true";
}

export function backoffMs(attempts) {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS);
}

/**
 * Adaugă un job. Cu dedupeKey: dacă există deja un job activ cu aceeași
 * cheie, nu se creează altul (întoarce { deduped: true }). Sigur și în
 * tranzacția apelantului (ON CONFLICT DO NOTHING, fără eroare P2002).
 */
export async function enqueueJob(db, { connectionId, type, payload = null, dedupeKey = null, runAfter = new Date(), priority = 0, maxAttempts = 8 }) {
  const created = await db.externalSyncJob.createMany({
    // câmpurile JSON goale se omit (Prisma nu acceptă null simplu pe Json)
    data: [{ connectionId, type, ...(payload == null ? {} : { payload }), dedupeKey, runAfter, priority, maxAttempts }],
    skipDuplicates: true,
  });
  if (created.count === 1) return { deduped: false };
  return { deduped: true };
}

/**
 * Preia până la `limit` joburi scadente (prioritate, apoi vechime) și le
 * marchează RUNNING. Două instanțe nu pot prelua același job.
 */
export async function claimJobs(db, { workerId, limit = 10, now = new Date() }) {
  return db.$queryRaw`
    UPDATE "ExternalSyncJob" AS j
    SET "status" = 'RUNNING',
        "lockedAt" = ${now},
        "lockedBy" = ${workerId},
        "startedAt" = ${now},
        "attempts" = j."attempts" + 1,
        "updatedAt" = ${now}
    WHERE j."id" IN (
      SELECT q."id"
      FROM "ExternalSyncJob" AS q
      JOIN "ExternalStoreConnection" AS c ON c."id" = q."connectionId"
      WHERE q."status" = 'QUEUED'
        AND q."runAfter" <= ${now}
        AND c."isPaused" = false
        AND c."status" <> 'DISCONNECTED'
      ORDER BY q."priority" DESC, q."runAfter" ASC
      LIMIT ${limit}
      FOR UPDATE OF q SKIP LOCKED
    )
    RETURNING j.*`;
}

export async function completeJob(db, job, result = null, now = new Date()) {
  await db.externalSyncJob.updateMany({
    where: { id: job.id, status: "RUNNING" },
    data: { status: "SUCCEEDED", dedupeKey: null, finishedAt: now, lockedAt: null, lockedBy: null, ...(result == null ? {} : { result }) },
  });
  await db.externalStoreConnection.updateMany({
    where: { id: job.connectionId },
    data: { lastSyncAt: now, lastSuccessAt: now },
  });
}

/**
 * Eroare tranzitorie -> din nou QUEUED, mai târziu; definitivă sau prea
 * multe încercări -> DEAD. Ultima eroare rămâne pe job și pe conexiune.
 */
export async function failJob(db, job, error, now = new Date()) {
  const retry = isRetryable(error) && job.attempts < job.maxAttempts;
  const code = String(error?.code || "sync_error").slice(0, 64);
  const message = String(error?.message || "Eroare de sincronizare").slice(0, 1000);

  await db.externalSyncJob.updateMany({
    where: { id: job.id, status: "RUNNING" },
    data: retry
      ? { status: "QUEUED", runAfter: new Date(now.getTime() + backoffMs(job.attempts)), lockedAt: null, lockedBy: null, lastErrorCode: code, lastErrorMessage: message }
      : { status: "DEAD", dedupeKey: null, finishedAt: now, lockedAt: null, lockedBy: null, lastErrorCode: code, lastErrorMessage: message },
  });
  await db.externalStoreConnection.updateMany({
    where: { id: job.connectionId },
    data: { lastSyncAt: now, lastErrorAt: now, lastErrorCode: code, lastErrorMessage: message },
  });
  return { retried: retry };
}

/** Joburi RUNNING abandonate (proces oprit): înapoi în coadă. */
export async function recoverStaleJobs(db, { now = new Date(), staleMs = STALE_RUNNING_MS } = {}) {
  const result = await db.externalSyncJob.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - staleMs) } },
    data: { status: "QUEUED", lockedAt: null, lockedBy: null, runAfter: now },
  });
  return result.count;
}

/**
 * O rundă a workerului: recuperează joburile blocate, preia joburi și
 * rulează handler-ul tipului fiecăruia.
 * @param {Record<string, (ctx: { db, job }) => Promise<any>>} handlers
 */
export async function runWorkerOnce({ db, handlers, workerId = `worker_${crypto.randomBytes(4).toString("hex")}`, limit = 10, now = new Date() }) {
  await recoverStaleJobs(db, { now });
  const jobs = await claimJobs(db, { workerId, limit, now });
  const outcomes = [];

  for (const job of jobs) {
    const handler = handlers[job.type];
    try {
      if (!handler) {
        const error = new Error(`Tip de job fără handler: ${job.type}`);
        error.code = "job_type_unsupported";
        throw error;
      }
      const result = await handler({ db, job });
      await completeJob(db, job, result ?? null);
      outcomes.push({ id: job.id, type: job.type, status: "SUCCEEDED" });
    } catch (error) {
      const { retried } = await failJob(db, job, error);
      outcomes.push({ id: job.id, type: job.type, status: retried ? "RETRY" : "DEAD", code: error?.code || null });
    }
  }

  return outcomes;
}
