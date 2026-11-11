// src/components/Returns/returnPickupAvailability.js
//
// GET /api/shipping/return-options -> { homePickup } (o dată per pagină).
import { useEffect, useState } from "react";
import { api } from "../../lib/api";

// „Ridicare de la adresă” disponibilă? (server: RETURN_COURIER_PICKUP_ENABLED +
// nomenclator + cont Artfest configurat). Eroare / necunoscut -> indisponibilă.
let returnOptionsPending = null;
function loadReturnPickupAvailable() {
  if (!returnOptionsPending) {
    returnOptionsPending = api("/api/shipping/return-options")
      .then((r) => Boolean(r?.homePickup))
      .catch(() => {
        returnOptionsPending = null;
        return false;
      });
  }
  return returnOptionsPending;
}

export function useReturnPickupAvailable() {
  const [available, setAvailable] = useState(null); // null = se verifică
  useEffect(() => {
    let alive = true;
    loadReturnPickupAvailable().then((v) => alive && setAvailable(v));
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

