// src/components/Courier/trackingTimelineView.js
//
// Afișarea istoricului tracking-ului (evenimentele status-sync, deja filtrate
// de server). Fără ID-uri Sameday interpretate aici: eticheta vine de la
// curier, iar „a actualizat statusul” doar din câmpul applied.

const DATE_FMT = new Intl.DateTimeFormat("ro-RO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Bucharest",
});

/** Data de afișat: occurredAt (ISO) sau textul primit de la curier. */
export function trackingEventDate(ev) {
  if (ev?.occurredAt) {
    const d = new Date(ev.occurredAt);
    if (!Number.isNaN(d.getTime())) return DATE_FMT.format(d);
  }
  return ev?.dateText ? String(ev.dateText) : "—";
}

/** Rândul secundar: locație, punct easybox / PUDO, motiv, colet. */
export function trackingEventDetails(ev, { showParcel = false } = {}) {
  const parts = [];
  if (ev?.location) parts.push(ev.location);
  if (ev?.pointType) parts.push(ev.pointType === "PUDO" ? "punct PUDO" : "easybox");
  if (ev?.reason) parts.push(`Motiv: ${ev.reason}`);
  if (showParcel && ev?.parcelNumber) parts.push(`Colet ${ev.parcelNumber}`);
  return parts.join(" · ");
}

/** Etichetele mici ale evenimentului. */
export function trackingEventTags(ev) {
  const tags = [];
  if (ev?.inReturn) tags.push({ key: "return", label: "În retur", tone: "warning" });
  if (ev?.applied) tags.push({ key: "applied", label: "A actualizat statusul", tone: "success" });
  return tags;
}

/** Afișăm numărul coletului doar când expedierea are mai multe colete în istoric. */
export function hasMultipleParcels(events) {
  return new Set((events || []).map((e) => e?.parcelNumber).filter(Boolean)).size > 1;
}

/** Cel mai recent eveniment primul (lista vine cronologic de la server). */
export function newestFirst(events) {
  return Array.isArray(events) ? [...events].reverse() : [];
}

export const TRACKING_EMPTY_MESSAGE =
  "Nu există încă evenimente de la curier. Istoricul se completează automat când sincronizarea cu Sameday este activă.";
