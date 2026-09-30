// backend/src/couriers/awb/codAmount.js

/*
 * Suma de încasat ramburs (COD) pentru UN Shipment - calculată EXCLUSIV pe
 * server, niciodată primită de la client.
 *
 * Reutilizează formula existentă din fluxul de avans
 * (vendorOrdersRoutes.js, request-deposit):
 *   remainingCodAmount = productsTotal + shippingAmount - depositRequestedAmount
 * unde productsTotal = Σ ShipmentItem.price × qty (price = prețul final
 * plătit de client, după reduceri) și shippingAmount = Shipment.price.
 *
 * Aici scădem avansul DOAR dacă e efectiv plătit (depositStatus = PAID,
 * depositPaidAmount) - identic cu valoarea validată la webhook-ul de
 * plată a avansului. Avans cerut dar neplătit blochează generarea AWB
 * (vezi awbService, blocker deposit_pending), nu intră în calcul.
 *
 * - CARD => 0 (plătit online / încasat de vendor);
 * - rezultatul nu e niciodată negativ;
 * - rotunjit la 2 zecimale.
 */

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function shipmentProductsTotal(items = []) {
  return round2(
    (items || []).reduce(
      (sum, it) => sum + Number(it?.price || 0) * Number(it?.qty || 0),
      0
    )
  );
}

/**
 * @param {{ paymentMethod: string }} order
 * @param {{ items: Array<{price:any, qty:any}>, price:any,
 *           depositStatus?: string, depositPaidAmount?: any }} shipment
 * @returns {{ codAmount:number, productsTotal:number, shippingAmount:number, depositPaid:number }}
 */
export function computeShipmentCodAmount(order, shipment) {
  const productsTotal = shipmentProductsTotal(shipment?.items);
  const shippingAmount = round2(shipment?.price);
  const depositPaid =
    String(shipment?.depositStatus || "") === "PAID"
      ? round2(shipment?.depositPaidAmount)
      : 0;

  const method = String(order?.paymentMethod || "").toUpperCase();
  if (method !== "COD") {
    return { codAmount: 0, productsTotal, shippingAmount, depositPaid };
  }

  const codAmount = Math.max(0, round2(productsTotal + shippingAmount - depositPaid));
  return { codAmount, productsTotal, shippingAmount, depositPaid };
}
