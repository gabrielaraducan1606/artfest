// frontend/src/features/quotes/conversationOffer.js
//
// „Trimite ofertă” din orice conversație vendor ↔ client - regula comună
// pentru pagina Mesaje și mini-fereastra de mesaje (vendor).

export const CONVERSATION_QUOTE_SOURCE = "CONVERSATION";

// cererea creată dintr-o conversație (sau încă inexistentă): vendorul alege descrierea + cantitatea
export function isConversationQuoteRequest(quoteRequest) {
  return !quoteRequest || quoteRequest?.requestData?.source === CONVERSATION_QUOTE_SOURCE;
}

/*
 * Serverul trimite threadMeta.canSendOffer (client cu cont activ + cerere
 * deschisă sau inexistentă). Fără câmp (backend mai vechi): regula de
 * dinainte, doar pentru conversațiile care au deja o cerere de ofertă.
 */
export function resolveCanSendQuoteOffer({ threadMeta, quoteRequest }) {
  if (typeof threadMeta?.canSendOffer === "boolean") return threadMeta.canSendOffer;
  return (
    Boolean(quoteRequest?.id) &&
    !quoteRequest?.orderId &&
    !["ACCEPTED", "CANCELLED", "EXPIRED"].includes(String(quoteRequest?.status || "").trim().toUpperCase())
  );
}

// titlul afișat pe cardul cererii / ofertei
export function quoteRequestTitle(quoteRequest) {
  return quoteRequest?.product?.title || quoteRequest?.requestData?.title || "Produs personalizat";
}
