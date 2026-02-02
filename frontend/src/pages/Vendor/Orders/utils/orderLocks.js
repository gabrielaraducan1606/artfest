// frontend/src/pages/Vendor/Orders/utils/orderLocks.js

export function isCourierAlreadyScheduled(o) {
  // cum ai avut tu: dacă există awb sau pickupDate
  return !!(o?.awb || o?.pickupDate);
}

// (optional) pregătit pentru viitor: curier cerut dar fără AWB
export function getPickupRequestedAt(order) {
  return (
    order?.pickupScheduledAt ||
    order?.shipmentPickupScheduledAt ||
    order?.shipment?.pickupScheduledAt ||
    null
  );
}

export function isAwaitingAwbLock(order) {
  const requestedAt = getPickupRequestedAt(order);
  const hasAwb = !!order?.awb;
  return !!requestedAt && !hasAwb;
}
