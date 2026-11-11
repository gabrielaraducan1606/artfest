// src/pages/Checkout/delivery/useShippingQuote.js
//
// Cere prețul transportului de la server (cu debounce; cererea anterioară
// e anulată), când livrarea Sameday e activă. Vezi shippingQuote.js.

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../lib/api";
import { buildQuoteRequest, QUOTE_DEBOUNCE_MS, readQuote } from "./shippingQuote.js";

const IDLE = { status: "idle", byGroup: {}, missing: [] };

/**
 * @param {Object} options
 * @param {boolean} options.enabled
 * @param {boolean} options.isGuest       guest -> /guest/quote cu produsele din coș
 * @param {Array}   options.guestItems
 * @param {string[]} options.groupKeys    serviceId-urile magazinelor
 * @param {Object}  options.selections
 * @param {string[]} options.methods
 * @param {Object}  options.address
 * @param {string}  options.cartKey       semnătura coșului (re-cerere la schimbare)
 */
export function useShippingQuote({ enabled, isGuest, guestItems, groupKeys, selections, methods, address, cartKey }) {
  const request = useMemo(
    () => (enabled && groupKeys.length ? buildQuoteRequest({ groupKeys, selections, methods, address, guestItems: isGuest ? guestItems : null }) : null),
    [enabled, groupKeys, selections, methods, address, isGuest, guestItems]
  );
  const requestKey = request ? JSON.stringify([isGuest, cartKey, request.body]) : "";
  const [state, setState] = useState(IDLE);

  useEffect(() => {
    if (!request) {
      setState(IDLE);
      return undefined;
    }
    const { body, missing } = request;
    setState((prev) => ({ ...prev, status: "loading", missing }));
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await api(isGuest ? "/api/checkout/guest/quote" : "/api/checkout/quote", {
          method: "POST",
          body,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setState({ status: "ready", byGroup: readQuote(data), missing });
      } catch {
        // eroare (ex. locație indisponibilă): prețul se confirmă la plasare,
        // iar erorile pe magazin apar la trimiterea comenzii
        if (!controller.signal.aborted) setState({ status: "error", byGroup: {}, missing });
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // requestKey rezumă toate datele cererii
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return state;
}
