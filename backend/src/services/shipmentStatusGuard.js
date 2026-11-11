// backend/src/services/shipmentStatusGuard.js
//
// Statusuri FINALE pentru coletul de vânzare (Shipment OUTBOUND): livrat,
// returnat, refuzat / anulat. Din ele vendorul NU mai poate muta expedierea
// prin acțiuni generice (new / preparing / confirmed / shipped / fulfilled,
// programare curier, predare) - altfel ar apărea regresii de status și SALE
// pentru expedieri anulate (decizia userului, 2026-11-03).
//
// Expedierile RETURN au flux separat: regula NU li se aplică.
// Corecțiile unui status greșit se fac doar printr-un flux Admin auditat
// (propus, neimplementat), nu prin tranziții generice.

export const SHIPMENT_FINAL_STATUSES = Object.freeze(["DELIVERED", "RETURNED", "REFUSED"]);

export function isFinalOutboundShipment(shipment) {
  if (String(shipment?.direction || "OUTBOUND") !== "OUTBOUND") return false;
  return SHIPMENT_FINAL_STATUSES.includes(String(shipment?.status || ""));
}

export const SHIPMENT_STATUS_FINAL_ERROR = "shipment_status_final";

export function shipmentStatusFinalBody(shipment) {
  return {
    error: SHIPMENT_STATUS_FINAL_ERROR,
    message:
      "Expedierea este deja livrată, returnată sau anulată. Statusul ei nu mai poate fi modificat din comenzi; pentru o corecție contactează echipa Artfest.",
    status: shipment?.status || null,
  };
}
