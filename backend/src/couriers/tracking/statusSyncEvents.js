// backend/src/couriers/tracking/statusSyncEvents.js
//
// Un element din status-sync (provider.fetchStatusSync) -> rândul de timeline
// ShipmentTrackingEvent, DOAR cu câmpuri documentate în Swagger și utile.
// NU se păstrează: dischargeClientCode (codul de deschidere a lockerului),
// consolidationHash, coordonatele curierului, createdBy, măsurătorile coletului.

import crypto from "node:crypto";
import { parseStatusDate } from "./statusSyncTime.js";

const cut = (v, max) => (v == null ? null : String(v).slice(0, max) || null);

/**
 * Cheia de deduplicare: același eveniment Sameday revenit (aceeași fereastră
 * reluată, ferestre adiacente) -> aceeași cheie. Doar câmpuri documentate:
 * provider | parcelAwbNumber | statusId | statusDate (valoarea BRUTĂ primită) |
 * reasonId (același status la același moment, cu alt motiv = alt eveniment).
 * @returns {string} sha256 hex (64)
 */
export function trackingEventDedupeKey({ provider = "SAMEDAY", parcelNumber, statusId, statusDateRaw, reasonId = null }) {
  return crypto
    .createHash("sha256")
    .update([provider, parcelNumber, statusId, statusDateRaw, reasonId ?? ""].join("|"))
    .digest("hex");
}

/**
 * @returns {Object|null} null dacă lipsesc câmpurile fără de care evenimentul
 *   nu poate fi identificat sigur (parcelAwbNumber, statusId, statusDate)
 */
export function normalizeStatusEvent(item, { provider = "SAMEDAY" } = {}) {
  const parcelNumber = cut(item?.parcelAwbNumber, 120);
  const statusId = Number.isInteger(item?.statusId) ? item.statusId : null;
  const statusDateRaw = cut(item?.statusDate, 64);
  if (!parcelNumber || statusId == null || !statusDateRaw) return null;
  const reasonId = Number.isInteger(item?.reasonId) ? item.reasonId : null;

  // PDF v3.6: oohDetails cu prioritate (la PUDO doar el); lockerDetails doar ca rezervă (easybox)
  const ooh = item?.oohDetails || null;
  const locker = item?.lockerDetails || null;

  return {
    provider,
    parcelNumber,
    statusId,
    status: cut(item?.status, 120),
    statusLabel: cut(item?.statusLabel, 255),
    statusState: cut(item?.statusState, 120),
    statusDateRaw,
    occurredAt: parseStatusDate(statusDateRaw),
    reasonId,
    reason: cut(item?.reason, 255),
    inReturn: item?.inReturn === true,
    transitLocation: cut(item?.transitLocation, 255),
    logisticLocationId: Number.isInteger(item?.location?.logisticLocationId) ? item.location.logisticLocationId : null,
    logisticLocationName: cut(item?.location?.logisticLocationName, 255),
    oohId: Number.isInteger(ooh?.oohId) ? ooh.oohId : null,
    oohType: ooh?.oohType === 0 || ooh?.oohType === 1 ? ooh.oohType : null,
    lockerId: Number.isInteger(locker?.lockerId) ? locker.lockerId : null,
    dedupeKey: trackingEventDedupeKey({ provider, parcelNumber, statusId, statusDateRaw, reasonId }),
  };
}
