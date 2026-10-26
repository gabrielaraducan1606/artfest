// backend/src/services/conversationQuoteOffer.js
//
// Eligibilitatea „Trimite ofertă” direct dintr-o conversație vendor ↔ client.
// O singură regulă, folosită și la trimitere (vendorQuotesRoutes) și la
// afișarea butonului (threadMeta din vendorMessageRoutes).
//
// thread: MessageThread de tip CUSTOMER al vendorului curent, cu
//   userId + user { id, status, locked } + quoteRequest { status, orderId } (opțional).

const CLOSED_QUOTE_STATUSES = new Set(["ACCEPTED", "REJECTED", "CANCELLED", "EXPIRED"]);

/** Motivul pentru care conversația NU poate primi o ofertă (sau null). */
export function getConversationOfferBlockReason({ thread, vendorUserId }) {
  if (!thread) return "thread_not_found";
  if (thread.type && thread.type !== "CUSTOMER") return "not_customer_thread";
  // vizitator fără cont: acceptarea ofertei cere client autentificat
  if (!thread.userId || !thread.user) return "conversation_without_client";
  if (vendorUserId && String(thread.userId) === String(vendorUserId)) return "own_conversation";
  if (thread.user.status !== "ACTIVE" || thread.user.locked) return "client_inactive";
  return null;
}

/** Butonul apare dacă se poate trimite o ofertă (nouă sau revizuită) în conversație. */
export function canSendConversationOffer({ thread, vendorUserId }) {
  if (getConversationOfferBlockReason({ thread, vendorUserId })) return false;
  const quote = thread.quoteRequest;
  if (!quote) return true;
  return !quote.orderId && !CLOSED_QUOTE_STATUSES.has(String(quote.status || "").toUpperCase());
}
