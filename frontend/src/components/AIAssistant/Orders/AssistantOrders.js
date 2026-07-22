// src/components/AiAssistant/orders/assistantOrders.js

import {
  DeliveryIcon,
  TrackingIcon,
} from "./OrderIcons.jsx";

/* =========================================================
   Acțiuni disponibile momentan
========================================================= */

export const ORDER_ACTIONS = [
  {
    id: "track-order",
    title: "Urmărește o comandă",
    description:
      "Vezi statusul și informațiile comenzilor tale.",
    icon: TrackingIcon,
  },

  {
    id: "order-delivery",
    title: "Detalii despre livrare",
    description:
      "Vezi metoda și statusul livrării comenzilor tale.",
    icon: DeliveryIcon,
  },

  /*
   * DEZACTIVAT TEMPORAR
   *
   * {
   *   id: "order-invoices",
   *   title: "Facturile mele",
   *   description: "Vezi și descarcă facturile comenzilor.",
   *   icon: InvoiceIcon,
   * },
   */

  /*
   * DEZACTIVAT TEMPORAR
   *
   * {
   *   id: "return",
   *   title: "Creează un retur",
   *   description: "Selectează comanda și produsul de returnat.",
   *   icon: ReturnIcon,
   * },
   */
];

/* =========================================================
   Pornire flow
========================================================= */

export function startOrderFlow({
  actionId,
}) {
  switch (actionId) {
    case "track-order":
    case "order-delivery": {
      /*
       * Momentan folosim pagina dedicată
       * comenzilor utilizatorului.
       */
      window.location.href =
        "/comenzile-mele";

      return true;
    }

    default:
      return false;
  }
}

/* =========================================================
   Alegeri din conversație
========================================================= */

export function handleOrderChoice() {
  return false;
}

/* =========================================================
   Răspunsuri temporare
========================================================= */

export function getOrderTemporaryResponse() {
  return null;
}

/* =========================================================
   Upload imagini
========================================================= */

export function getOrderImageUploadResponse() {
  return null;
}

/* =========================================================
   Placeholder input
========================================================= */

export function getOrderInputPlaceholder() {
  return null;
}