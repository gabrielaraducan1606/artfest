// src/services/productModerationQueue.js
//
// Moderarea AI a produselor, ASINCRONĂ, printr-o coadă persistentă în Postgres
// (tabela ProductModerationJob, fără Redis). Modelul urmează coada de
// sincronizare externă (integrations/core/syncQueue.js).
//
// Fluxul:
//   1. Ruta de creare / editare salvează produsul (PENDING, nepublic - ca până
//      acum) și, în ACEEAȘI tranzacție, pune jobul în coadă (enqueueModerationJob).
//   2. Răspunsul HTTP pleacă imediat; nu mai așteaptă OpenAI.
//   3. Procesorul (startProductModerationWorker) preia jobul cu
//      FOR UPDATE SKIP LOCKED (o singură instanță per job), calculează verdictul
//      cu ACELEAȘI reguli (computeSavedProductModeration) și îl aplică într-o
//      tranzacție scurtă, cu rândul produsului blocat.
//
// Garanții:
//   - un singur job în așteptare per produs (activeKey = productId cât e QUEUED);
//     o editare nouă îl reîmprospătează, nu adaugă altul;
//   - verdictul se aplică DOAR dacă produsul are același conținut (contentHash),
//     aceeași stare de moderare ca la salvare (statusSnapshot) și nu există un
//     job mai nou în așteptare. Altfel jobul se încheie SKIPPED: o decizie
//     manuală (Admin) sau o editare ulterioară nu e suprascrisă niciodată;
//   - restart Render: jobul e în DB; un job RUNNING abandonat se reia după
//     STALE_RUNNING_MS; încercările sunt limitate (maxAttempts), apoi DEAD -
//     produsul rămâne PENDING (coada Admin), deci nu devine public;
//   - AI indisponibil: reîncercare cu pauză; la ultima încercare se aplică
//     verdictul existent (PENDING + AI_ANALYSIS_UNAVAILABLE -> Admin), ca înainte;
//   - produsele existente nu sunt atinse: nu se creează joburi decât la salvări noi.
//
// Activare (vezi docs în raportul de deploy):
//   PRODUCT_MODERATION_ASYNC=on     - rutele pun moderarea în coadă (implicit off = sincron, ca înainte)
//   PRODUCT_MODERATION_WORKER=on|off - procesorul (implicit pornește doar dacă ASYNC=on)
// Ambele cer tabelele migrației 20261122120000_product_moderation_queue: fără ele
// rutele rămân pe moderarea sincronă și procesorul nu pornește.

import crypto from "node:crypto";
import {
  buildModerationApplyData,
  computeSavedProductModeration,
  hashModerationText,
  isProductAiModerationEnabled,
} from "./productAiModeration.js";

export const STALE_RUNNING_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 15 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];
const LOG = "[product-moderation-queue]";

/* ---------------- configurare ---------------- */

const flag = (value) => String(value ?? "").trim().toLowerCase();
const isOn = (value) => ["1", "true", "on", "yes"].includes(flag(value));
const isOff = (value) => ["0", "false", "off", "no"].includes(flag(value));

export function isAsyncModerationRequested(env = process.env) {
  return isOn(env.PRODUCT_MODERATION_ASYNC);
}

export function isModerationWorkerRequested(env = process.env) {
  if (isOff(env.PRODUCT_MODERATION_WORKER)) return false;
  if (isOn(env.PRODUCT_MODERATION_WORKER)) return true;
  return isAsyncModerationRequested(env);
}

function maxAttemptsFrom(env = process.env) {
  const value = Number(env.PRODUCT_MODERATION_JOB_MAX_ATTEMPTS);
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value : DEFAULT_MAX_ATTEMPTS;
}

/* ---------------- tabelele există? (fără ele: totul rămâne sincron) ---------------- */

const readiness = { ready: false, checkedAt: 0, pending: null };
const READINESS_RECHECK_MS = 60 * 1000;

export async function checkProductQueueTables(db) {
  const rows = await db.$queryRaw`
    SELECT to_regclass('"ProductModerationJob"') IS NOT NULL AS "jobs",
           to_regclass('"ProductCreateRequest"') IS NOT NULL AS "requests"`;
  const row = rows?.[0] || {};
  return Boolean(row.jobs) && Boolean(row.requests);
}

/** Recitește (cel mult o dată pe minut cât lipsesc) dacă tabelele există. */
export async function refreshProductQueueReadiness(db, now = Date.now()) {
  if (readiness.ready) return true;
  if (readiness.pending) return readiness.pending;
  if (readiness.checkedAt && now - readiness.checkedAt < READINESS_RECHECK_MS) return false;
  readiness.pending = checkProductQueueTables(db)
    .catch((error) => {
      console.error(LOG, "verificarea tabelelor a eșuat:", error?.message || error);
      return false;
    })
    .then((ready) => {
      readiness.ready = ready;
      readiness.checkedAt = Date.now();
      readiness.pending = null;
      return ready;
    });
  return readiness.pending;
}

export function productQueueTablesReady() {
  return readiness.ready;
}

/** Doar pentru teste. */
export function setProductQueueReadinessForTests(ready) {
  readiness.ready = Boolean(ready);
  readiness.checkedAt = Date.now();
  readiness.pending = null;
}

/** Rutele pun moderarea în coadă? (flag + tabele + moderarea AI pornită) */
export async function shouldQueueModeration(db, env = process.env) {
  if (!isAsyncModerationRequested(env) || !isProductAiModerationEnabled(env)) return false;
  return refreshProductQueueReadiness(db);
}

/* ---------------- amprente ---------------- */

function normalizeImages(images) {
  return (Array.isArray(images) ? images : []).map((url) => String(url || "").trim()).filter(Boolean);
}

/** Conținutul moderat: textul relevant + imaginile, în ordine. */
export function moderationContentHash(product = {}) {
  return crypto
    .createHash("sha256")
    .update(`${hashModerationText(product)}|${JSON.stringify(normalizeImages(product.images))}`)
    .digest("hex");
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

/** Starea de moderare după salvare; orice schimbare a ei (Admin, alt flux) oprește aplicarea. */
export function moderationStatusSnapshot(product = {}) {
  return {
    moderationStatus: String(product.moderationStatus || ""),
    reviewedAt: iso(product.reviewedAt),
    reviewedByUserId: product.reviewedByUserId || null,
    approvedAt: iso(product.approvedAt),
  };
}

export function sameStatusSnapshot(product, snapshot) {
  const current = moderationStatusSnapshot(product);
  const saved = snapshot && typeof snapshot === "object" ? snapshot : {};
  return (
    current.moderationStatus === String(saved.moderationStatus || "") &&
    current.reviewedAt === (saved.reviewedAt || null) &&
    current.reviewedByUserId === (saved.reviewedByUserId || null) &&
    current.approvedAt === (saved.approvedAt || null)
  );
}

/*
 * Coloanele sunt TIMESTAMP(3) fără fus orar, iar Prisma le scrie în UTC. În SQL-ul
 * brut, un Date ar fi trimis ca timestamptz și convertit cu fusul sesiunii (ex.
 * Europe/Bucharest -> +2 h): un job blocat n-ar mai părea niciodată abandonat.
 * Trimitem explicit ora UTC, fără fus, exact ca Prisma.
 */
export function utcTimestamp(date) {
  return new Date(date).toISOString().replace("Z", "");
}

/* ---------------- punerea în coadă (în tranzacția salvării) ---------------- */

/**
 * Pune (sau reîmprospătează) jobul de moderare al produsului salvat. Trebuie
 * apelat cu clientul tranzacției care a scris produsul, ca jobul și produsul
 * să existe împreună sau deloc.
 * @param {object} db  clientul tranzacției
 * @param {{ product: object, reason: "create"|"update"|"gpsr", previouslyRejectedByAdmin?: boolean }} input
 */
export async function enqueueModerationJob(db, { product, reason, previouslyRejectedByAdmin = false, env = process.env, now = new Date() }) {
  if (!product?.id) throw new Error("enqueueModerationJob: produs lipsă");
  const id = `pmj_${crypto.randomUUID()}`;
  const snapshot = JSON.stringify(moderationStatusSnapshot(product));
  const contentHash = moderationContentHash(product);
  const maxAttempts = maxAttemptsFrom(env);
  const ts = utcTimestamp(now);
  const rows = await db.$queryRaw`
    INSERT INTO "ProductModerationJob"
      ("id", "productId", "reason", "status", "activeKey", "contentHash", "statusSnapshot",
       "previouslyRejectedByAdmin", "attempts", "maxAttempts", "runAfter", "createdAt", "updatedAt")
    VALUES
      (${id}, ${product.id},
       CASE WHEN EXISTS (
         SELECT 1 FROM "ProductModerationJob" AS r
          WHERE r."productId" = ${product.id} AND r."status" = 'RUNNING'::"ProductModerationJobStatus" AND r."reason" = 'resubmit'
       ) THEN 'resubmit' ELSE ${String(reason).slice(0, 32)} END,
       'QUEUED'::"ProductModerationJobStatus", ${product.id},
       ${contentHash}, ${snapshot}::jsonb, ${Boolean(previouslyRejectedByAdmin)}, 0, ${maxAttempts}, ${ts}::timestamp, ${ts}::timestamp, ${ts}::timestamp)
    ON CONFLICT ("activeKey") DO UPDATE SET
      -- o retrimitere „Am făcut modificările” rămâne retrimitere chiar dacă vânzătorul editează între timp
      "reason" = CASE WHEN "ProductModerationJob"."reason" = 'resubmit' THEN 'resubmit' ELSE EXCLUDED."reason" END,
      "contentHash" = EXCLUDED."contentHash",
      "statusSnapshot" = EXCLUDED."statusSnapshot",
      "previouslyRejectedByAdmin" = "ProductModerationJob"."previouslyRejectedByAdmin" OR EXCLUDED."previouslyRejectedByAdmin",
      "attempts" = 0,
      "maxAttempts" = EXCLUDED."maxAttempts",
      "runAfter" = EXCLUDED."runAfter",
      "lastErrorCode" = NULL,
      "lastErrorMessage" = NULL,
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "id"`;
  return rows?.[0]?.id || id;
}

/* ---------------- procesorul ---------------- */

/**
 * Preia cel mult un job scadent. Sare peste produsele care au deja un job în lucru.
 */
export async function claimModerationJob(db, { workerId, now = new Date() }) {
  const ts = utcTimestamp(now);
  const rows = await db.$queryRaw`
    UPDATE "ProductModerationJob" AS j
       SET "status" = 'RUNNING'::"ProductModerationJobStatus",
           "activeKey" = NULL,
           "attempts" = j."attempts" + 1,
           "lockedAt" = ${ts}::timestamp,
           "lockedBy" = ${workerId},
           "startedAt" = COALESCE(j."startedAt", ${ts}::timestamp),
           "updatedAt" = ${ts}::timestamp
     WHERE j."id" = (
       SELECT q."id" FROM "ProductModerationJob" AS q
        WHERE q."status" = 'QUEUED'::"ProductModerationJobStatus"
          AND q."runAfter" <= ${ts}::timestamp
          AND NOT EXISTS (
            SELECT 1 FROM "ProductModerationJob" AS r
             WHERE r."productId" = q."productId" AND r."status" = 'RUNNING'::"ProductModerationJobStatus"
          )
        ORDER BY q."runAfter" ASC, q."createdAt" ASC
        LIMIT 1
        FOR UPDATE OF q SKIP LOCKED
     )
    RETURNING j.*`;
  return rows?.[0] || null;
}

async function finishJob(db, job, { status, outcome, error = null, now = new Date() }) {
  await db.productModerationJob.updateMany({
    where: { id: job.id, status: "RUNNING", lockedBy: job.lockedBy },
    data: {
      status,
      outcome: outcome ? String(outcome).slice(0, 40) : null,
      activeKey: null,
      lockedAt: null,
      lockedBy: null,
      finishedAt: now,
      ...(error ? { lastErrorCode: String(error.code || "error").slice(0, 64), lastErrorMessage: String(error.message || error).slice(0, 1000) } : {}),
    },
  });
}

/**
 * Reprogramează jobul. Dacă între timp a apărut un job mai nou în așteptare
 * pentru același produs, acesta e cel valabil -> jobul curent se încheie SKIPPED.
 */
async function retryJob(db, job, { error, now = new Date() }) {
  const delay = RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? RETRY_DELAYS_MS.at(-1);
  try {
    await db.productModerationJob.updateMany({
      where: { id: job.id, status: "RUNNING", lockedBy: job.lockedBy },
      data: {
        status: "QUEUED",
        activeKey: job.productId,
        runAfter: new Date(now.getTime() + delay),
        lockedAt: null,
        lockedBy: null,
        lastErrorCode: String(error?.code || "retry").slice(0, 64),
        lastErrorMessage: String(error?.message || error || "").slice(0, 1000),
      },
    });
    return "retry";
  } catch (e) {
    if (e?.code !== "P2002") throw e;
    await finishJob(db, job, { status: "SKIPPED", outcome: "superseded", now });
    return "superseded";
  }
}

class RetryableModerationError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const PRODUCT_SELECT_FOR_MODERATION = {
  include: { additionalCategories: true },
};

/** Verdict de blocare pe o retrimitere: solicitarea Adminului redevine deschisă (confirmedAt null). */
export function reopenBlockedChangeRequest(data) {
  const request = data?.aiModeration?.changeRequest;
  if (data?.moderationStatus !== "CHANGES_REQUESTED" || !request?.confirmedAt || request.resolvedAt) return data;
  data.aiModeration = { ...data.aiModeration, changeRequest: { ...request, confirmedAt: null } };
  return data;
}

/**
 * După o retrimitere acceptată (nu blocată) - exact ce făcea ruta sincronă:
 * confirmarea scrisă pe notificarea solicitării (istoric) + câte o notificare
 * per admin (dedupeKey per solicitare: o reîncercare nu dublează nimic).
 */
export async function finishChangesConfirmation(db, productId, hooks = {}) {
  const product = await db.product.findUnique({
    where: { id: productId },
    include: { service: { include: { vendor: true, profile: true } } },
  });
  const request = product?.aiModeration?.changeRequest;
  if (!product || !request?.id || !request.confirmedAt || request.resolvedAt) return false;
  if (String(product.moderationStatus) === "CHANGES_REQUESTED") return false;

  const { changeRequestNotificationKey } = hooks.changeRequestNotificationKey ? hooks : await import("./productChangeRequest.js");
  const { notifyAdminsProductChangesDone } = hooks.notifyAdminsProductChangesDone ? hooks : await import("./notifications.js");

  const notification = await db.notification.findUnique({
    where: { dedupeKey: changeRequestNotificationKey(product.id, request.id) },
    select: { id: true, meta: true },
  });
  if (notification) {
    await db.notification.update({
      where: { id: notification.id },
      data: { meta: { ...(notification.meta || {}), confirmedAt: request.confirmedAt } },
    });
  }
  await notifyAdminsProductChangesDone({
    product,
    changeRequest: request,
    storeName: product.service?.profile?.displayName || product.service?.vendor?.displayName || "",
  });
  return true;
}

/**
 * Procesează un job preluat. Nu aruncă: orice eroare -> reîncercare / DEAD.
 * @returns {Promise<{ outcome: string }>}
 */
export async function processModerationJob(db, job, { client, env = process.env, now = () => new Date(), hooks = {} } = {}) {
  try {
    const product = await db.product.findUnique({ where: { id: job.productId }, ...PRODUCT_SELECT_FOR_MODERATION });

    if (!product) {
      await finishJob(db, job, { status: "SKIPPED", outcome: "product_deleted", now: now() });
      return { outcome: "product_deleted" };
    }
    if (moderationContentHash(product) !== job.contentHash) {
      await finishJob(db, job, { status: "SKIPPED", outcome: "content_changed", now: now() });
      return { outcome: "content_changed" };
    }
    if (!sameStatusSnapshot(product, job.statusSnapshot)) {
      await finishJob(db, job, { status: "SKIPPED", outcome: "status_changed", now: now() });
      return { outcome: "status_changed" };
    }

    // moderarea poate fi oprită între timp (kill switch): produsul rămâne cum e (PENDING -> Admin)
    if (!isProductAiModerationEnabled(env)) {
      await finishJob(db, job, { status: "SKIPPED", outcome: "moderation_disabled", now: now() });
      return { outcome: "moderation_disabled" };
    }

    // calculul lent (AI) - în afara oricărei tranzacții
    const aiModeration = await computeSavedProductModeration({
      prisma: db,
      product,
      previous: product.aiModeration || null,
      previouslyRejectedByAdmin: Boolean(job.previouslyRejectedByAdmin),
      client,
      env,
    });

    const aiUnavailable = (aiModeration?.reasons || []).includes("AI_ANALYSIS_UNAVAILABLE");
    if (aiUnavailable && job.attempts < job.maxAttempts) {
      throw new RetryableModerationError("analiza AI indisponibilă", "ai_unavailable");
    }

    // aplicarea: scurtă, cu rândul produsului blocat (o editare / decizie Admin concurentă așteaptă sau câștigă)
    const applied = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${product.id} FOR UPDATE`;
      const fresh = await tx.product.findUnique({
        where: { id: product.id },
        select: { id: true, title: true, description: true, category: true, materialMain: true, technique: true, styleTags: true, occasionTags: true, dimensions: true, careInstructions: true, specialNotes: true, optionsSchema: true, customSchema: true, repeatedGroups: true, quoteSchema: true, images: true, moderationStatus: true, reviewedAt: true, reviewedByUserId: true, approvedAt: true, aiModeration: true },
      });
      if (!fresh) return "product_deleted";
      if (moderationContentHash(fresh) !== job.contentHash) return "content_changed";
      if (!sameStatusSnapshot(fresh, job.statusSnapshot)) return "status_changed";
      const newer = await tx.productModerationJob.findFirst({ where: { activeKey: product.id }, select: { id: true } });
      if (newer) return "superseded";
      const data = buildModerationApplyData(aiModeration, fresh.aiModeration);
      // „Am făcut modificările” blocat de verificarea automată: solicitarea se redeschide (ca în fluxul sincron)
      if (job.reason === "resubmit") reopenBlockedChangeRequest(data);
      await tx.product.update({ where: { id: product.id }, data });
      return "applied";
    });

    if (applied !== "applied") {
      await finishJob(db, job, { status: "SKIPPED", outcome: applied, now: now() });
      return { outcome: applied };
    }

    // retrimitere acceptată (nu blocată): confirmarea pe notificarea solicitării + adminii notificați
    if (job.reason === "resubmit") {
      await finishChangesConfirmation(db, product.id, hooks).catch((error) => {
        console.error(LOG, `produs ${product.id}: notificările „modificări făcute” au eșuat:`, error?.message || error);
      });
    }

    const outcome = aiUnavailable ? "ai_unavailable" : String(aiModeration?.decision || "applied").toLowerCase();
    await finishJob(db, job, { status: "SUCCEEDED", outcome, now: now() });
    return { outcome };
  } catch (error) {
    if (job.attempts < job.maxAttempts) {
      const result = await retryJob(db, job, { error, now: now() }).catch((e) => {
        console.error(LOG, `job ${job.id}: reprogramarea a eșuat:`, e?.message || e);
        return "retry_failed";
      });
      if (!(error instanceof RetryableModerationError)) console.error(LOG, `job ${job.id} (produs ${job.productId}) încercarea ${job.attempts}:`, error?.message || error);
      return { outcome: result };
    }
    console.error(LOG, `job ${job.id} (produs ${job.productId}) DEAD după ${job.attempts} încercări:`, error?.message || error);
    await finishJob(db, job, { status: "DEAD", outcome: "failed", error, now: now() }).catch(() => {});
    return { outcome: "dead" };
  }
}

/**
 * Joburi RUNNING abandonate (proces oprit / restart Render): înapoi în coadă
 * dacă mai au încercări și nu există deja un job mai nou; altfel DEAD / SKIPPED.
 */
export async function recoverStaleModerationJobs(db, { now = new Date(), staleMs = STALE_RUNNING_MS } = {}) {
  const stale = await db.productModerationJob.findMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(now.getTime() - staleMs) } },
    select: { id: true, productId: true, attempts: true, maxAttempts: true, lockedBy: true },
    take: 50,
  });
  let recovered = 0;
  for (const job of stale) {
    if (job.attempts >= job.maxAttempts) {
      await finishJob(db, job, { status: "DEAD", outcome: "abandoned", error: { code: "stale", message: "procesul s-a oprit în timpul jobului" }, now });
      continue;
    }
    const result = await retryJob(db, job, { error: { code: "stale", message: "reluat după oprirea procesului" }, now: new Date(now.getTime() - RETRY_DELAYS_MS[0]) });
    if (result === "retry") recovered += 1;
  }
  return { stale: stale.length, recovered };
}

/*
 * După cât timp un job RUNNING e considerat abandonat. Niciodată sub durata
 * maximă a unei analize (4 × timeoutul AI + 30 s; 12 fotografii = 2 loturi):
 * un procesor lent, dar viu, nu trebuie să-și vadă jobul preluat de altul.
 */
export function moderationStaleMs(env = process.env) {
  const aiTimeout = Number(env.PRODUCT_AI_MODERATION_TIMEOUT_MS) > 0 ? Number(env.PRODUCT_AI_MODERATION_TIMEOUT_MS) : 30 * 1000;
  const floor = aiTimeout * 4 + 30 * 1000;
  const configured = Number(env.PRODUCT_MODERATION_STALE_MS) > 0 ? Number(env.PRODUCT_MODERATION_STALE_MS) : STALE_RUNNING_MS;
  return Math.max(configured, floor);
}

/** O trecere: recuperare + joburile scadente, pe rând (un singur job simultan per proces). */
export async function runModerationWorkerOnce(db, { client, env = process.env, workerId, maxJobs = 20, now = () => new Date() } = {}) {
  const staleMs = moderationStaleMs(env);
  await recoverStaleModerationJobs(db, { now: now(), staleMs });
  const results = [];
  for (let i = 0; i < maxJobs; i += 1) {
    const job = await claimModerationJob(db, { workerId, now: now() });
    if (!job) break;
    results.push({ jobId: job.id, productId: job.productId, ...(await processModerationJob(db, job, { client, env, now })) });
  }
  return results;
}

/* ---------------- pornirea în server.js ---------------- */

let worker = null;

/** Clientul OpenAI fără reîncercări interne (reîncercarea e a jobului, cu pauză). */
export function withoutSdkRetries(client) {
  return typeof client?.withOptions === "function" ? client.withOptions({ maxRetries: 0 }) : client;
}

export function startProductModerationWorker({ db, client, env = process.env, intervalMs } = {}) {
  if (worker) return worker;
  if (!isModerationWorkerRequested(env)) return null;

  const workerId = `pmw_${process.pid}_${crypto.randomBytes(3).toString("hex")}`;
  const every = Number(env.PRODUCT_MODERATION_WORKER_INTERVAL_MS) || intervalMs || DEFAULT_INTERVAL_MS;
  const aiClient = withoutSdkRetries(client);
  let running = false;
  let again = false;

  const tick = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      if (!(await refreshProductQueueReadiness(db))) return;
      do {
        again = false;
        const results = await runModerationWorkerOnce(db, { client: aiClient, env, workerId });
        for (const r of results) console.info(LOG, `produs ${r.productId}: ${r.outcome}`);
      } while (again);
    } catch (error) {
      console.error(LOG, "trecere eșuată:", error?.message || error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, every);
  timer.unref?.();
  setTimeout(tick, 5000).unref?.();
  console.log(`${LOG} procesor pornit (${workerId}, la ${Math.round(every / 1000)} s)`);

  worker = { workerId, tick, stop: () => clearInterval(timer) };
  return worker;
}

/** După un commit cu job nou: procesează imediat, fără a aștepta intervalul (jobul e deja în DB). */
export function kickProductModerationWorker() {
  if (!worker) return;
  setImmediate(() => worker?.tick());
}
