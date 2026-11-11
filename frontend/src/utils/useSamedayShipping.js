// src/utils/useSamedayShipping.js
//
// Livrarea Sameday la checkout e activă? (GET /api/shipping/options, o dată
// per sesiune de pagină). Folosit de editorul de produs: greutatea coletului
// e obligatorie la produsele noi doar când tariful Sameday se calculează.

import { useEffect, useState } from "react";
import { fetchDeliveryOptions } from "../pages/Checkout/delivery/deliveryApi.js";

let pending = null;

export function loadSamedayShippingEnabled() {
  if (!pending) {
    pending = fetchDeliveryOptions()
      .then((options) => Boolean(options?.enabled))
      .catch(() => {
        pending = null;
        return false;
      });
  }
  return pending;
}

export function useSamedayShipping() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadSamedayShippingEnabled().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
