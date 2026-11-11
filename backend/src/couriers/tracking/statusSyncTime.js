// backend/src/couriers/tracking/statusSyncTime.js
//
// Timpul pentru GET /api/client/status-sync (Sameday):
//   - ferestre CONSECUTIVE de maximum 2 ore (PDF v3.6 + Swagger: „The maximum
//     interval between the 2 timestamps is 2 hours”);
//   - serializarea startTimestamp / endTimestamp, izolată AICI: Swagger spune
//     doar `string($timestamp)`, iar exemplul din PDF e o imagine -> formatul
//     NU e confirmat. Fără format configurat explicit, sincronizarea refuză să
//     pornească (nu ghicim). Integrarea live rămâne NECONFIRMATĂ până la un
//     request read-only aprobat.

export const MAX_SYNC_WINDOW_MS = 2 * 60 * 60 * 1000;

// formatele candidate (de ales DUPĂ confirmarea Sameday); niciunul implicit
export const SYNC_TIMESTAMP_FORMATS = Object.freeze(["unix_seconds", "unix_ms", "iso8601"]);

export class SyncTimestampFormatError extends Error {
  constructor() {
    super("Formatul timestamp-urilor pentru status-sync nu e configurat (nedocumentat în PDF v3.6 / Swagger).");
    this.code = "status_sync_timestamp_format_unconfirmed";
  }
}

/**
 * @param {Date} date
 * @param {string|null|undefined} format  unul din SYNC_TIMESTAMP_FORMATS
 * @returns {string}
 */
export function serializeSyncTimestamp(date, format) {
  if (!SYNC_TIMESTAMP_FORMATS.includes(format)) throw new SyncTimestampFormatError();
  const ms = date.getTime();
  if (format === "unix_seconds") return String(Math.floor(ms / 1000));
  if (format === "unix_ms") return String(ms);
  return new Date(ms).toISOString();
}

/**
 * Ferestrele [start, end) de procesat, consecutive și fără goluri: fiecare
 * începe exact unde s-a terminat precedenta, maximum 2 ore (sau `windowMs`).
 * Limitate la `maxWindows` per rulare (restul la rularea următoare).
 * @returns {{ start: Date, end: Date }[]}
 */
export function planSyncWindows({ from, until, windowMs = MAX_SYNC_WINDOW_MS, maxWindows = 12 }) {
  const size = Math.min(Math.max(1, Number(windowMs) || MAX_SYNC_WINDOW_MS), MAX_SYNC_WINDOW_MS);
  const windows = [];
  let start = from.getTime();
  const stop = until.getTime();
  while (start < stop && windows.length < maxWindows) {
    const end = Math.min(start + size, stop);
    windows.push({ start: new Date(start), end: new Date(end) });
    start = end;
  }
  return windows;
}

/**
 * statusDate -> Date DOAR când e neambiguu (ISO cu fus orar explicit sau
 * epoch numeric); altfel null (formatul nu e documentat - nu presupunem fusul
 * orar). Valoarea brută se păstrează separat (statusDateRaw) și intră în cheia
 * de deduplicare.
 */
export function parseStatusDate(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (/^\d{10}$/.test(text)) return new Date(Number(text) * 1000);
  if (/^\d{13}$/.test(text)) return new Date(Number(text));
  if (/T.*([zZ]|[+-]\d{2}:?\d{2})$/.test(text)) {
    const ms = Date.parse(text);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  return null;
}
