// src/pages/Admin/AdminDesktop/tabs/useAdminHelpRequests.js

import { useCallback, useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import { isGpsrHelpTicket } from "../../../../utils/gpsrAddressHelp.js";
import {
  gpsrHelpTicketsUrl,
  helpProductsUrl,
  helpTicketMessagesUrl,
  helpTicketsUrl,
  isHelpProduct,
  isHelpTicketBody,
  isHelpTicketCandidate,
  splitHelpTicketBody,
} from "./adminHelpRequests.js";

/**
 * Datele secțiunii. Citirea mesajelor nu marchează tichetele ca citite.
 * Numărul din filă contează doar ce are nevoie de o acțiune.
 */
export function useAdminHelpRequests({ refreshKey }) {
  const [state, setState] = useState({ loading: true, error: "", products: [], tickets: [], gpsrTickets: [] });
  const [resolved, setResolved] = useState({});

  useEffect(() => {
    let alive = true;

    Promise.allSettled([api(helpProductsUrl()), api(helpTicketsUrl()), api(gpsrHelpTicketsUrl())]).then(async ([products, tickets, gpsrTickets]) => {
      if (!alive) return;

      const productItems = products.status === "fulfilled" ? products.value?.items || [] : [];
      const candidates = tickets.status === "fulfilled" ? (tickets.value?.items || []).filter(isHelpTicketCandidate) : [];

      const gpsrCandidates = gpsrTickets.status === "fulfilled" ? (gpsrTickets.value?.items || []).filter(isGpsrHelpTicket) : [];

      const firstMessages = await Promise.allSettled(candidates.map((ticket) => api(helpTicketMessagesUrl(ticket.id))));
      const gpsrMessages = await Promise.allSettled(gpsrCandidates.map((ticket) => api(helpTicketMessagesUrl(ticket.id))));
      if (!alive) return;

      const gpsrItems = gpsrCandidates.map((ticket, index) => ({
        ticket,
        first: gpsrMessages[index].status === "fulfilled" ? gpsrMessages[index].value?.items?.[0] || null : null,
      }));

      const ticketItems = candidates
        .map((ticket, index) => ({
          ticket,
          first: firstMessages[index].status === "fulfilled" ? firstMessages[index].value?.items?.[0] || null : null,
        }))
        // subiectul poate fi scris și manual: rămân doar cele trimise din formular
        .filter((item) => isHelpTicketBody(item.first?.body, item.ticket));

      // o cerere pe un produs salvat are și tichet (pentru răspuns în Suport): o arătăm o
      // singură dată, pe cardul produsului, cu legătura spre conversație
      const helpProducts = productItems.filter(isHelpProduct);
      const productIds = new Set(helpProducts.map((product) => product.id));
      const ticketByProduct = new Map();
      const standaloneTickets = [];
      for (const item of ticketItems) {
        const productId = splitHelpTicketBody(item.first?.body).context.productId;
        if (productId && productIds.has(productId)) {
          if (!ticketByProduct.has(productId)) ticketByProduct.set(productId, item.ticket);
        } else {
          standaloneTickets.push(item);
        }
      }

      setState({
        loading: false,
        error: products.status === "rejected" || tickets.status === "rejected" || gpsrTickets.status === "rejected" ? "Nu am putut încărca toate solicitările. Reîncarcă pagina." : "",
        products: helpProducts.map((product) => (ticketByProduct.has(product.id) ? { ...product, helpTicket: ticketByProduct.get(product.id) } : product)),
        tickets: standaloneTickets,
        gpsrTickets: gpsrItems,
      });
    });

    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const resolveProduct = useCallback(async (product) => {
    const data = await api(`/api/admin/products/${encodeURIComponent(product.id)}/review-request/resolve`, { method: "PATCH" });
    setResolved((current) => ({ ...current, [product.id]: { ...product, ...(data?.product || {}) } }));
    return data?.product || null;
  }, []);

  // finalizate acum: rămân vizibile până la reîncărcare, marcate ca atare
  const products = [
    ...state.products.filter((product) => !resolved[product.id]),
    ...Object.values(resolved),
  ];

  const openCount =
    products.filter((product) => product.reviewRequest?.open).length +
    [...state.tickets, ...state.gpsrTickets].filter((item) => item.ticket.status !== "closed").length;
  // necitite de adminul curent (același calcul ca numărul din Suport)
  const unreadCount = [...state.tickets, ...state.gpsrTickets].filter((item) => item.ticket.unread === true).length;

  return { ...state, products, openCount, unreadCount, resolveProduct };
}
