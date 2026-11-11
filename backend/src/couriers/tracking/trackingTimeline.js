// backend/src/couriers/tracking/trackingTimeline.js
//
// Istoricul tracking-ului unei expedieri (ShipmentTrackingEvent, scris de
// status-sync) pentru afișare - DOAR citire. Include și evenimentele care nu
// au schimbat statusul expedierii (applied = false).
//
// Câmpurile trec printr-un allow-list per audiență:
//   - vendor: dată, etichetă, stare, motiv, locație, colet, tip punct (easybox /
//     PUDO), retur, „a actualizat statusul”;
//   - admin: în plus statusId / reasonId / mappedStatus / oohId / lockerId /
//     numărul AWB (utile pentru completarea statusMap după confirmarea Sameday).
// Nu ies niciodată: dedupeKey, statusDateRaw ca atare (doar ca text de afișare
// când data nu e interpretabilă), id-urile interne CourierAwb.

export const TIMELINE_LIMIT = 200;

// PDF v3.6 (OOH): oohType 0 = easybox, 1 = PUDO
function pointTypeOf(oohType) {
  if (oohType === 0) return "easybox";
  if (oohType === 1) return "PUDO";
  return null;
}

const iso = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : d ? String(d) : null);

/**
 * @param {Object} row ShipmentTrackingEvent (+ courierAwb.awbNumber opțional)
 * @param {{ audience: "vendor"|"admin" }} opts
 */
export function publicTrackingEvent(row, { audience = "vendor" } = {}) {
  if (!row) return null;
  const occurredAt = iso(row.occurredAt);
  const base = {
    id: row.id,
    occurredAt,
    // data neinterpretabilă (format nedocumentat) -> textul primit, doar pentru afișare
    dateText: occurredAt ? null : row.statusDateRaw ? String(row.statusDateRaw).slice(0, 64) : null,
    label: row.statusLabel || row.status || null,
    state: row.statusState || null,
    reason: row.reason || null,
    location: row.logisticLocationName || row.transitLocation || null,
    parcelNumber: row.parcelNumber || null,
    pointType: pointTypeOf(row.oohType),
    inReturn: row.inReturn === true,
    applied: row.applied === true,
  };
  if (audience !== "admin") return base;
  return {
    ...base,
    statusId: Number.isInteger(row.statusId) ? row.statusId : null,
    reasonId: Number.isInteger(row.reasonId) ? row.reasonId : null,
    mappedStatus: row.mappedStatus || null,
    oohId: Number.isInteger(row.oohId) ? row.oohId : null,
    lockerId: Number.isInteger(row.lockerId) ? row.lockerId : null,
    awbNumber: row.courierAwb?.awbNumber || null,
    recordedAt: iso(row.createdAt),
  };
}

const timeOf = (row) => {
  const t = row.occurredAt ? new Date(row.occurredAt).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Ordine cronologică: data evenimentului; fără dată -> după momentul înregistrării. */
export function sortTimeline(rows) {
  return [...rows].sort((a, b) => {
    const ta = timeOf(a) ?? new Date(a.createdAt).getTime();
    const tb = timeOf(b) ?? new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

/**
 * Evenimentele unei expedieri (cele mai recente TIMELINE_LIMIT), cronologic.
 * Autorizarea (vendor / admin) e responsabilitatea apelantului.
 */
export async function loadShipmentTimeline(db, shipmentId, { audience = "vendor" } = {}) {
  const rows = await db.shipmentTrackingEvent.findMany({
    where: { shipmentId: String(shipmentId) },
    orderBy: { createdAt: "desc" },
    take: TIMELINE_LIMIT,
    include: audience === "admin" ? { courierAwb: { select: { awbNumber: true } } } : undefined,
  });
  return sortTimeline(rows).map((r) => publicTrackingEvent(r, { audience }));
}

/**
 * Vendor: DOAR expedierea proprie (id + vendorId), altfel null (-> 404).
 */
export async function loadVendorShipmentTimeline(db, { vendorId, shipmentId }) {
  if (!vendorId || !shipmentId) return null;
  const shipment = await db.shipment.findFirst({
    where: { id: String(shipmentId), vendorId: String(vendorId) },
    select: { id: true },
  });
  if (!shipment) return null;
  return { shipmentId: shipment.id, events: await loadShipmentTimeline(db, shipment.id, { audience: "vendor" }) };
}

const SEARCH_RE = /^[A-Za-z0-9_-]{3,64}$/;

/**
 * Admin: căutare după AWB (Shipment.awb / CourierAwb.awbNumber), număr de
 * comandă sau id-ul expedierii. Maxim 5 expedieri.
 * @returns {Promise<null|Object[]>} null = termen invalid
 */
export async function searchAdminTimelines(db, query) {
  const q = String(query ?? "").trim();
  if (!SEARCH_RE.test(q)) return null;
  const shipments = await db.shipment.findMany({
    where: {
      OR: [{ id: q }, { awb: q }, { courierAwbs: { some: { awbNumber: q } } }, { order: { orderNumber: q } }],
    },
    select: {
      id: true,
      awb: true,
      status: true,
      direction: true,
      orderId: true,
      order: { select: { orderNumber: true } },
      vendor: { select: { displayName: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const out = [];
  for (const s of shipments) {
    out.push({
      shipmentId: s.id,
      orderId: s.orderId,
      orderNumber: s.order?.orderNumber || null,
      vendorName: s.vendor?.displayName || null,
      awb: s.awb || null,
      status: s.status,
      direction: s.direction,
      events: await loadShipmentTimeline(db, s.id, { audience: "admin" }),
    });
  }
  return out;
}
