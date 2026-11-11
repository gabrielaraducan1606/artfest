// backend/src/couriers/tracking/statusSyncNotifications.js
//
// Hook-ul onImportantEvent al status-sync -> notificare IN-APP pentru vânzător
// (infrastructura existentă: services/notifications.js createVendorNotification,
// dedupeKey unic). Fără email.
//
// Doar „Colet preluat de curier”: evenimentul Sameday mapat explicit la
// IN_TRANSIT (publicConfig.statusMap), aplicat pe expedierea OUTBOUND (Shipment
// trecut efectiv în IN_TRANSIT). Fără statusMap configurat nu există niciun
// eveniment mapat -> nicio notificare (nimic ghicit). DELIVERED / REFUSED /
// RETURNED nu sunt aplicate de status-sync în faza 1 -> nu se notifică de aici
// (livrarea marcată manual are deja fluxul ei). Retururile: fără notificare aici.

export function pickedUpDedupeKey(shipmentId, awb) {
  return `vendor_shipment_picked_up:${shipmentId}:${awb || "noawb"}`;
}

/**
 * @param {{ db: any, notifyVendor: (vendorId: string, data: Object) => Promise<any> }} deps
 * @returns {(evt: Object) => Promise<any>}
 */
export function createStatusSyncNotifier({ db, notifyVendor }) {
  return async function onImportantEvent(evt = {}) {
    if (evt.direction === "RETURN") return null;
    if (evt.mappedStatus !== "IN_TRANSIT" || evt.applied !== true || !evt.shipmentId) return null;

    const shipment = await db.shipment.findUnique({
      where: { id: String(evt.shipmentId) },
      select: { id: true, vendorId: true, awb: true, status: true, direction: true, orderId: true, order: { select: { orderNumber: true } } },
    });
    // doar dacă preluarea a fost efectiv aplicată (aplicarea e condiționată)
    if (!shipment?.vendorId || shipment.direction !== "OUTBOUND" || shipment.status !== "IN_TRANSIT") return null;

    const displayNo = shipment.order?.orderNumber || shipment.orderId;
    return notifyVendor(shipment.vendorId, {
      dedupeKey: pickedUpDedupeKey(shipment.id, shipment.awb),
      type: "shipping",
      title: `Colet preluat de curier - comanda #${displayNo}`,
      body: shipment.awb ? `Sameday a preluat coletul cu AWB ${shipment.awb}.` : "Sameday a preluat coletul.",
      link: `/vendor/orders/${shipment.orderId}`,
      meta: {
        kind: "shipment_picked_up",
        source: "status_sync",
        orderId: shipment.orderId,
        shipmentId: shipment.id,
        awb: shipment.awb || null,
        statusId: evt.statusId ?? null,
        occurredAt: evt.occurredAt || null,
      },
    });
  };
}
