// backend/src/couriers/tracking/statusSyncStore.js
//
// Persistența sincronizării de statusuri (modelele CourierStatusSyncCursor și
// ShipmentTrackingEvent). Folosit de statusSyncWorker.js; în teste se
// înlocuiește cu un store simulat.

import { Prisma } from "@prisma/client";
import { prisma as defaultDb } from "../../db.js";
import { getCourierProvider } from "../registry.js";
import { openCredentials } from "../credentials/store.js";
import { findPlatformCourierAccount, platformConfig } from "../platformAccount.js";
import { samedayEnvironmentIssue } from "../samedayEnvironment.js";
import { awbCancelStateOf } from "../awb/activeAwbGuard.js";
import { ensureShipmentSaleLedgers } from "../../services/shipmentSaleLedger.js";
import { runStatusSync } from "./statusSyncWorker.js";

const PRE_TRANSIT = ["PENDING", "PREPARING", "READY_FOR_PICKUP", "PICKUP_SCHEDULED", "AWB"];

const isUniqueViolation = (e) => e?.code === "P2002";

/**
 * @param {Object} [db]
 * @param {{ courierAccountId: string, environment: string }|null} [scope]
 *   contul sincronizat + mediul lui: evenimentele se leagă DOAR de AWB-urile
 *   create cu ACEST cont, în ACEST mediu (providerMeta.environment) - un
 *   eveniment DEMO nu atinge niciodată un AWB production și invers.
 *   runPlatformStatusSync trimite mereu scope-ul.
 */
export function createPrismaStatusSyncStore(db = defaultDb, scope = null) {
  const scopeSql = scope
    ? Prisma.sql` AND a."courierAccountId" = ${String(scope.courierAccountId)} AND (a."providerMeta"->>'environment') = ${String(scope.environment)}`
    : Prisma.empty;
  return {
    async getOrCreateCursor({ courierAccountId, feed, initialSyncedUntil }) {
      return db.courierStatusSyncCursor.upsert({
        where: { courierAccountId_feed: { courierAccountId, feed } },
        create: { courierAccountId, feed, syncedUntil: initialSyncedUntil },
        update: {},
      });
    },

    // lease: o singură instanță per cursor (update condiționat, atomic în Postgres)
    async acquireLease({ cursorId, instanceId, now, leaseMs }) {
      const res = await db.courierStatusSyncCursor.updateMany({
        where: { id: cursorId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        data: { lockedUntil: new Date(now.getTime() + leaseMs), lockedBy: instanceId, lastRunAt: now },
      });
      return res.count === 1;
    },

    async advanceCursor({ cursorId, instanceId, syncedUntil, now, leaseMs }) {
      const res = await db.courierStatusSyncCursor.updateMany({
        where: { id: cursorId, lockedBy: instanceId },
        data: { syncedUntil, lockedUntil: new Date(now.getTime() + leaseMs) },
      });
      if (res.count !== 1) throw Object.assign(new Error("lease pierdut"), { code: "status_sync_lease_lost" });
    },

    async finishRun({ cursorId, instanceId, now }) {
      await db.courierStatusSyncCursor.updateMany({
        where: { id: cursorId, lockedBy: instanceId },
        data: { lockedUntil: null, lockedBy: null, lastSuccessAt: now, lastErrorCode: null, failures: 0, nextRunAfter: null },
      });
    },

    async recordFailure({ cursorId, instanceId, code, failures, nextRunAfter }) {
      await db.courierStatusSyncCursor.updateMany({
        where: { id: cursorId, lockedBy: instanceId },
        data: { lockedUntil: null, lockedBy: null, lastErrorCode: String(code).slice(0, 64), failures, nextRunAfter },
      });
    },

    /**
     * parcelAwbNumber -> AWB-ul Artfest, DOAR prin potrivire exactă cu numărul
     * AWB sau cu un număr de colet salvat la creare (providerMeta.parcelNumbers).
     * Fără reguli presupuse despre formatul numerelor.
     * @returns {Promise<Map<string, Object>>}
     */
    async findAwbsByParcelNumbers(parcels) {
      const out = new Map();
      if (!parcels.length) return out;
      const rows = await db.$queryRaw`
        SELECT a.id, a."shipmentId", a."awbNumber", a.status::text AS status,
               a."providerMeta"->'parcelNumbers' AS "parcelNumbers",
               jsonb_build_object('cancelState', a."providerMeta"->'cancelState', 'cancelAttemptedAt', a."providerMeta"->'cancelAttemptedAt') AS "cancelMeta",
               s.awb AS "shipmentAwb", s.status::text AS "shipmentStatus", s.direction::text AS direction
          FROM "CourierAwb" a
          JOIN "Shipment" s ON s.id = a."shipmentId"
         WHERE a.provider = 'SAMEDAY'
           AND a."awbNumber" IS NOT NULL${scopeSql}
           AND (a."awbNumber" = ANY(${parcels}::text[])
                OR (jsonb_typeof(a."providerMeta"->'parcelNumbers') = 'array'
                    AND jsonb_exists_any(a."providerMeta"->'parcelNumbers', ${parcels}::text[])))`;
      for (const row of rows) {
        const own = new Set([row.awbNumber, ...(Array.isArray(row.parcelNumbers) ? row.parcelNumbers.map(String) : [])]);
        const link = {
          courierAwbId: row.id,
          shipmentId: row.shipmentId,
          awbNumber: row.awbNumber,
          isCurrentAwb: row.status === "CREATED" && row.shipmentAwb === row.awbNumber,
          awbCancelState: awbCancelStateOf({ providerMeta: row.cancelMeta }),
          shipment: { status: row.shipmentStatus, direction: row.direction },
        };
        for (const p of parcels) if (own.has(p) && (!out.has(p) || link.isCurrentAwb)) out.set(p, link);
      }
      return out;
    },

    // idempotent: dedupeKey unic -> un eveniment revenit nu creează rând nou
    async insertEvent(data) {
      try {
        const row = await db.shipmentTrackingEvent.create({ data, select: { id: true } });
        return { inserted: true, id: row.id };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const row = await db.shipmentTrackingEvent.findUnique({ where: { dedupeKey: data.dedupeKey }, select: { id: true } });
        return { inserted: false, id: row?.id ?? null };
      }
    },

    // FAZA 1: doar IN_TRANSIT, doar din stările de dinainte de predare, doar pe AWB-ul curent.
    // Rândul CourierAwb e blocat (FOR UPDATE) cât durează tranzacția: o anulare
    // (rezervare cancelState) nu se poate intercala; AWB anulat / în curs de
    // anulare / înlocuit -> nimic aplicat.
    async applyInTransit({ shipmentId, eventId, awbNumber, courierAwbId }) {
      return db.$transaction(async (tx) => {
        const [awb] = await tx.$queryRaw`
          SELECT status::text AS status, "shipmentId", "awbNumber", "providerMeta"
            FROM "CourierAwb" WHERE id = ${courierAwbId} FOR UPDATE`;
        if (!awb || awb.status !== "CREATED" || awb.shipmentId !== shipmentId || awb.awbNumber !== awbNumber) return false;
        if (awbCancelStateOf(awb)) return false;
        const res = await tx.shipment.updateMany({
          where: { id: shipmentId, awb: awbNumber, direction: "OUTBOUND", status: { in: PRE_TRANSIT } },
          data: { status: "IN_TRANSIT" },
        });
        if (res.count !== 1) return false;
        if (eventId) await tx.shipmentTrackingEvent.update({ where: { id: eventId }, data: { applied: true } });
        return true;
      });
    },

    // RETUR: status operațional pe Shipment RETURN (AWB curent, fără downgrade,
    // condiționat). Fără refund, fără CLOSED pe cerere, fără ledger: cererea de
    // retur (PICKUP_REQUESTED după AWB) se închide tot manual, la recepție.
    async applyReturnStatus({ shipmentId, eventId, awbNumber, courierAwbId, toStatus, fromStatuses }) {
      if (!["PICKUP_SCHEDULED", "IN_TRANSIT", "DELIVERED"].includes(toStatus) || !Array.isArray(fromStatuses) || !fromStatuses.length) return false;
      return db.$transaction(async (tx) => {
        const [awb] = await tx.$queryRaw`
          SELECT status::text AS status, "shipmentId", "awbNumber", "providerMeta"
            FROM "CourierAwb" WHERE id = ${courierAwbId} FOR UPDATE`;
        if (!awb || awb.status !== "CREATED" || awb.shipmentId !== shipmentId || awb.awbNumber !== awbNumber) return false;
        if (awbCancelStateOf(awb)) return false;
        const res = await tx.shipment.updateMany({
          where: { id: shipmentId, awb: awbNumber, direction: "RETURN", status: { in: fromStatuses } },
          data: { status: toStatus },
        });
        if (res.count !== 1) return false;
        if (eventId) await tx.shipmentTrackingEvent.update({ where: { id: eventId }, data: { applied: true } });
        return true;
      });
    },

    // după IN_TRANSIT aplicat: aceeași logică financiară ca la căile manuale
    // (COD / CARD offline -> SALE; CARD online doar din webhook; fără Stripe)
    async ensureSaleLedgers({ shipmentId }) {
      return ensureShipmentSaleLedgers({ shipmentId, db });
    },
  };
}

/**
 * O rulare pentru contul Sameday al Artfest (PLATFORM). Fără cont configurat
 * sau fără format de timestamp confirmat -> nimic (niciun request).
 * Configurația (publicConfig): statusSyncTimestampFormat, statusMap, returnStatusMap.
 */
export async function runPlatformStatusSync({ db = defaultDb, ...rest } = {}) {
  const account = await findPlatformCourierAccount(db);
  if (!account || account.provider !== "SAMEDAY" || account.status !== "ACTIVE") {
    return { status: "skipped", reason: "platform_account_unavailable" };
  }
  const environment = platformConfig(account).environment;
  // apărare: mediul contului explicit și permis acum (altfel nicio cerere)
  if (samedayEnvironmentIssue(environment)) return { status: "skipped", reason: "environment_not_allowed" };
  const cfg = account.publicConfig || {};
  return runStatusSync({
    store: createPrismaStatusSyncStore(db, { courierAccountId: account.id, environment }),
    provider: getCourierProvider(account.provider),
    account,
    ctx: {
      accountId: account.id,
      credentials: openCredentials(account),
      publicConfig: { ...cfg, environment },
    },
    config: { statusSyncTimestampFormat: cfg.statusSyncTimestampFormat, statusMap: cfg.statusMap, returnStatusMap: cfg.returnStatusMap },
    ...rest,
  });
}
