// backend/src/couriers/tracking/statusSyncWorker.js
//
// Sincronizarea statusurilor AWB Sameday (GET /api/client/status-sync, RO-RO)
// în timeline-ul ShipmentTrackingEvent - FAZA 1:
//   - ferestre consecutive de maximum 2 ore de la checkpoint
//     (CourierStatusSyncCursor.syncedUntil) până la „acum - lagMs”;
//   - TOATE paginile unei ferestre (răspunsul nu are total: oprire la o
//     pagină incompletă), apoi abia checkpoint-ul avansează la sfârșitul ei;
//   - orice eroare (pagină, timeout, autentificare, DB) -> checkpoint-ul
//     rămâne; rularea următoare reia aceeași fereastră, deduplicarea
//     (dedupeKey unic) previne duplicatele;
//   - o singură instanță: lease în Postgres pe rândul cursorului
//     (lockedUntil / lockedBy, update condiționat - funcționează și prin pgbouncer);
//   - Shipment.status se schimbă DOAR spre IN_TRANSIT (mapare confirmată,
//     fără downgrade); DELIVERED / REFUSED / RETURNED = doar timeline,
//     applied = false - fără ledger, comisioane, FULFILLED, refund;
//   - după un IN_TRANSIT aplicat: logica financiară comună
//     (services/shipmentSaleLedger.js - SALE doar COD / CARD offline, CARD
//     online doar din webhook), separat de status și idempotentă.
//   - marginile intervalului (inclusiv / exclusiv) NU sunt precizate în PDF
//     v3.6 („AWB Status”) sau Swagger -> fiecare cerere începe cu
//     overlapMs ÎNAINTEA ferestrei (cererea rămâne <= 2 ore: ferestrele se
//     planifică la 2h - overlapMs). Checkpoint-ul avansează tot la sfârșitul
//     ferestrei; evenimentele prinse de două ori sunt eliminate de dedupeKey.
// Pornit DOAR cu COURIER_STATUS_SYNC_ENABLED=true. Fără format de timestamp
// configurat (nedocumentat) nu face niciun request.

import crypto from "node:crypto";
import { CourierAuthError, CourierTimeoutError, CourierUnavailableError, isCourierError } from "../errors.js";
import { MAX_SYNC_WINDOW_MS, planSyncWindows, serializeSyncTimestamp, SYNC_TIMESTAMP_FORMATS } from "./statusSyncTime.js";
import { normalizeStatusEvent } from "./statusSyncEvents.js";
import {
  decideApplication,
  decideReturnApplication,
  interpretStatusEvent,
  MAPPABLE_STATUSES,
  parseReturnStatusMap,
  parseStatusMap,
  STATUS_FLOWS,
} from "./statusMapping.js";

export const STATUS_SYNC_FEED = "STATUS_SYNC";

const DEFAULTS = Object.freeze({
  countPerPage: 500, // implicitul din Swagger
  maxPages: 200,
  lagMs: 2 * 60 * 1000, // evenimentele foarte recente se iau la rularea următoare
  overlapMs: 60 * 1000, // suprapunere la marginea ferestrei (limite nedocumentate); dedupeKey elimină dublurile
  initialLookbackMs: MAX_SYNC_WINDOW_MS, // primul checkpoint: acum - 2h
  maxWindowsPerRun: 12, // max 24h recuperate per rulare (restul data viitoare)
  leaseMs: 10 * 60 * 1000,
  pageRetries: 1, // o reîncercare pe pagină la timeout / indisponibil
  retryDelayMs: 2_000,
  backoffBaseMs: 60 * 1000,
  backoffMaxMs: 60 * 60 * 1000,
});

export function isCourierStatusSyncEnabled(env = process.env) {
  return String(env.COURIER_STATUS_SYNC_ENABLED ?? "").trim().toLowerCase() === "true";
}

const errorCode = (e) => (isCourierError(e) ? e.code : e?.code && typeof e.code === "string" ? e.code : "unexpected_error");
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * Paginarea status-sync (Swagger: răspuns { currentPage, perPage, data }, fără
 * total). Dimensiunea paginii = perPage ÎNTORS de API (poate plafona sub
 * countPerPage cerut sau îl poate ignora), altfel countPerPage cerut. O pagină cu mai puține
 * elemente decât dimensiunea ei e ultima. Răspuns incoerent -> eroare
 * (checkpoint-ul rămâne, fereastra se reia; dedupeKey previne duplicatele):
 *   - currentPage întors diferit de pagina cerută;
 *   - mai multe elemente decât dimensiunea paginii.
 * @returns {number} dimensiunea efectivă a paginii
 */
function checkPage({ res, page, items, opts }) {
  const declaredPage = Number(res?.currentPage);
  if (res?.currentPage !== null && res?.currentPage !== undefined && (!Number.isInteger(declaredPage) || declaredPage !== page)) {
    throw Object.assign(new Error("pagina întoarsă diferă de cea cerută"), { code: "status_sync_page_mismatch" });
  }
  const declaredSize = Number(res?.perPage);
  // paginile sunt numerotate după dimensiunea folosită de API (cea întoarsă)
  const pageSize = Number.isInteger(declaredSize) && declaredSize > 0 ? declaredSize : opts.countPerPage;
  if (items.length > pageSize) {
    throw Object.assign(new Error("pagina are mai multe elemente decât dimensiunea declarată"), { code: "status_sync_page_inconsistent" });
  }
  return pageSize;
}

// suprapunerea validată: 0 .. 10 minute (mult sub fereastra de 2 ore)
export function overlapOf(opts) {
  const v = Number(opts?.overlapMs);
  return Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 10 * 60 * 1000) : 0;
}

function pageFingerprint(items) {
  const h = crypto.createHash("sha256");
  for (const it of items) h.update(JSON.stringify(it ?? null)).update("\n");
  return h.digest("hex");
}

async function fetchPage({ provider, ctx, window, page, format, opts, sleep }) {
  const params = {
    // cererea începe cu overlapMs înaintea ferestrei; durata totală <= 2 ore
    startTimestamp: serializeSyncTimestamp(new Date(window.start.getTime() - overlapOf(opts)), format),
    endTimestamp: serializeSyncTimestamp(window.end, format),
    page,
    countPerPage: opts.countPerPage,
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.fetchStatusSync(ctx, params);
    } catch (e) {
      const transient = e instanceof CourierTimeoutError || (e instanceof CourierUnavailableError && e.providerStatus !== 404);
      if (!transient || attempt >= opts.pageRetries) throw e;
      await sleep(opts.retryDelayMs * (attempt + 1));
    }
  }
}

/**
 * O rulare pentru un cont Sameday. Nu aruncă: întoarce sumarul.
 * @param {Object} deps
 * @param {Object} deps.store     couriers/tracking/statusSyncStore.js (sau unul simulat în teste)
 * @param {Object} deps.provider  providerul Sameday (fetchStatusSync)
 * @param {{ id: string, provider: string }} deps.account
 * @param {Object} deps.ctx       contextul autentificat al providerului
 * @param {{ statusSyncTimestampFormat?: string, statusMap?: Object }} deps.config
 * @returns {Promise<Object>} { status: "ok"|"skipped"|"locked"|"failed", ... }
 */
export async function runStatusSync({
  store,
  provider,
  account,
  ctx,
  config = {},
  now = () => new Date(),
  instanceId = `sync-${crypto.randomUUID()}`,
  onImportantEvent = async () => {},
  sleep = defaultSleep,
  log = console,
  options = {},
}) {
  const opts = { ...DEFAULTS, ...options };
  const summary = { status: "ok", windows: 0, pages: 0, events: 0, inserted: 0, duplicates: 0, applied: 0, returnApplied: 0, unlinked: 0, unmapped: 0, returnFlow: 0, ledgerIncomplete: 0, invalid: 0 };

  const format = config.statusSyncTimestampFormat;
  if (!SYNC_TIMESTAMP_FORMATS.includes(format)) {
    log.warn?.("[status-sync] oprit: formatul timestamp-urilor nu e confirmat / configurat");
    return { ...summary, status: "skipped", reason: "timestamp_format_unconfirmed" };
  }
  const statusMap = parseStatusMap(config.statusMap);
  const returnStatusMap = parseReturnStatusMap(config.returnStatusMap);

  const startedAt = now();
  const cursor = await store.getOrCreateCursor({
    courierAccountId: account.id,
    feed: STATUS_SYNC_FEED,
    initialSyncedUntil: new Date(startedAt.getTime() - opts.initialLookbackMs),
  });
  if (cursor.nextRunAfter && new Date(cursor.nextRunAfter) > startedAt) {
    return { ...summary, status: "skipped", reason: "backoff" };
  }
  if (!(await store.acquireLease({ cursorId: cursor.id, instanceId, now: startedAt, leaseMs: opts.leaseMs }))) {
    return { ...summary, status: "locked" };
  }

  try {
    const windows = planSyncWindows({
      from: new Date(cursor.syncedUntil),
      until: new Date(startedAt.getTime() - opts.lagMs),
      // fereastra + suprapunerea <= 2 ore (limita documentată)
      windowMs: MAX_SYNC_WINDOW_MS - overlapOf(opts),
      maxWindows: opts.maxWindowsPerRun,
    });

    for (const window of windows) {
      let previousFingerprint = null;
      for (let page = 1; ; page++) {
        if (page > opts.maxPages) throw Object.assign(new Error("prea multe pagini"), { code: "status_sync_too_many_pages" });
        const res = await fetchPage({ provider, ctx, window, page, format, opts, sleep });
        const items = Array.isArray(res?.items) ? res.items : [];
        const pageSize = checkPage({ res, page, items, opts });
        // aceeași pagină întoarsă din nou (paginare ignorată) -> oprire, checkpoint neavansat
        const fingerprint = items.length ? pageFingerprint(items) : null;
        if (fingerprint && fingerprint === previousFingerprint) {
          throw Object.assign(new Error("pagină repetată"), { code: "status_sync_page_repeated" });
        }
        previousFingerprint = fingerprint;
        summary.pages++;
        await processItems({ store, items, statusMap, returnStatusMap, account, summary, onImportantEvent, log });
        if (items.length < pageSize) break;
      }
      // fereastra + toate paginile + toate evenimentele procesate -> abia acum
      await store.advanceCursor({ cursorId: cursor.id, instanceId, syncedUntil: window.end, now: now(), leaseMs: opts.leaseMs });
      summary.windows++;
    }

    await store.finishRun({ cursorId: cursor.id, instanceId, now: now() });
    if (summary.unlinked) log.warn?.(`[status-sync] ${summary.unlinked} evenimente fără AWB Artfest (ignorate)`);
    return summary;
  } catch (e) {
    const code = errorCode(e);
    const failures = (cursor.failures || 0) + 1;
    const delay = Math.min(opts.backoffBaseMs * 2 ** (failures - 1), opts.backoffMaxMs);
    log.error?.(`[status-sync] rulare oprită (${code}); checkpoint neschimbat, reluare după backoff`);
    await store
      .recordFailure({ cursorId: cursor.id, instanceId, code, failures, nextRunAfter: new Date(now().getTime() + delay) })
      .catch(() => log.error?.("[status-sync] nu am putut salva eșecul"));
    return { ...summary, status: "failed", errorCode: code, authError: e instanceof CourierAuthError };
  }
}

async function processItems({ store, items, statusMap, returnStatusMap = new Map(), account, summary, onImportantEvent, log }) {
  const events = [];
  for (const item of items) {
    summary.events++;
    const ev = normalizeStatusEvent(item, { provider: account.provider });
    if (ev) events.push(ev);
    else summary.invalid++;
  }
  if (!events.length) return;

  // legătura sigură eveniment -> AWB Artfest: număr AWB sau număr de colet salvat la creare
  const links = await store.findAwbsByParcelNumbers([...new Set(events.map((e) => e.parcelNumber))]);

  for (const ev of events) {
    const link = links.get(ev.parcelNumber);
    if (!link) {
      summary.unlinked++;
      continue; // nimic modificat; nu știm a cui e coletul
    }
    const { flow, mappedStatus, returnEvent } = interpretStatusEvent({ statusMap, returnStatusMap, statusId: ev.statusId, inReturn: ev.inReturn, direction: link.shipment?.direction });
    if (!mappedStatus && !returnEvent) summary.unmapped++;
    if (flow === STATUS_FLOWS.RETURN) summary.returnFlow++;
    const { dedupeKey, ...data } = ev;
    const saved = await store.insertEvent({
      ...data,
      dedupeKey,
      shipmentId: link.shipmentId,
      courierAwbId: link.courierAwbId,
      mappedStatus,
    });
    if (saved.inserted) summary.inserted++;
    else summary.duplicates++;

    // RETUR (Shipment RETURN, mapare confirmată în returnStatusMap): doar status
    // operațional pe expedierea de retur - fără refund, fără CLOSED, fără ledger
    if (returnEvent) {
      const rd = decideReturnApplication({ returnEvent, shipment: link.shipment, isCurrentAwb: link.isCurrentAwb, awbCancelState: link.awbCancelState });
      if (rd.apply && typeof store.applyReturnStatus === "function") {
        const ok = await store.applyReturnStatus({
          shipmentId: link.shipmentId,
          eventId: saved.id,
          awbNumber: link.awbNumber,
          courierAwbId: link.courierAwbId,
          toStatus: rd.toStatus,
          fromStatuses: rd.fromStatuses,
        });
        if (ok) {
          summary.returnApplied++;
          link.shipment = { ...link.shipment, status: rd.toStatus };
        }
      }
      if (saved.inserted) {
        try {
          await onImportantEvent({ shipmentId: link.shipmentId, returnEvent, statusId: ev.statusId, occurredAt: ev.occurredAt, applied: rd.apply, direction: "RETURN" });
        } catch {
          log.error?.("[status-sync] hook-ul de notificare a eșuat (ignorat)");
        }
      }
      continue;
    }

    const decision = decideApplication({
      mappedStatus,
      shipment: link.shipment,
      isCurrentAwb: link.isCurrentAwb,
      inReturn: ev.inReturn,
      awbCancelState: link.awbCancelState,
    });
    if (decision.apply) {
      // condiționat (idempotent): doar dacă Shipment-ul e încă înainte de predare
      if (await store.applyInTransit({ shipmentId: link.shipmentId, eventId: saved.id, awbNumber: link.awbNumber, courierAwbId: link.courierAwbId })) {
        summary.applied++;
        link.shipment = { ...link.shipment, status: "IN_TRANSIT" };
        // ledger DUPĂ status (separat, idempotent): un eșec nu anulează predarea
        // reală; rămâne pentru reconciliere (services/shipmentLedgerReconcile.js)
        if (typeof store.ensureSaleLedgers === "function") {
          try {
            const ledger = await store.ensureSaleLedgers({ shipmentId: link.shipmentId });
            if (ledger && ledger.ok === false) summary.ledgerIncomplete++;
          } catch {
            summary.ledgerIncomplete++;
            log.error?.("[status-sync] ledger SALE eșuat (de reconciliat)");
          }
        }
      }
    }

    // hook pentru notificări (faza 1: fără emailuri reale) - doar evenimente noi și importante
    if (saved.inserted && mappedStatus && MAPPABLE_STATUSES.includes(mappedStatus)) {
      try {
        await onImportantEvent({ shipmentId: link.shipmentId, mappedStatus, statusId: ev.statusId, occurredAt: ev.occurredAt, applied: decision.apply });
      } catch {
        log.error?.("[status-sync] hook-ul de notificare a eșuat (ignorat)");
      }
    }
  }
}

/**
 * Jobul periodic (setInterval, ca celelalte joburi din server.js). OPRIT
 * implicit: pornește doar cu COURIER_STATUS_SYNC_ENABLED=true. O rulare la
 * `intervalMs` (implicit 15 min); o rulare încă în curs pe instanța curentă
 * nu se suprapune; între instanțe protejează lease-ul din DB.
 * @param {() => Promise<Object>} runOnce  ex. runPlatformStatusSync
 * @returns {{ stop: Function } | null}
 */
export function startCourierStatusSyncJob({ runOnce, env = process.env, intervalMs = 15 * 60 * 1000, log = console } = {}) {
  if (!isCourierStatusSyncEnabled(env)) {
    log.info?.("[status-sync] job oprit (COURIER_STATUS_SYNC_ENABLED != true)");
    return null;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runOnce();
      if (r?.status === "failed") log.warn?.(`[status-sync] eșuat: ${r.errorCode}`);
    } catch (e) {
      log.error?.(`[status-sync] eroare neașteptată: ${e?.name || "Error"}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}
