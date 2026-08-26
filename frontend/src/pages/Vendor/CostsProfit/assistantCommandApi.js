// src/pages/Vendor/CostsProfit/assistantCommandApi.js

import { api } from "../../../lib/api.js";

/**
 * Comandă conversațională de administrare Costuri & Profit
 * (analiză, editare bibliotecă, recalculare, editare costing,
 * apply-price). LLM-ul doar clasifică + extrage - niciodată nu
 * scrie în DB; endpointul întoarce fie un răspuns direct
 * (read-only), fie o dezambiguizare, fie un pendingAction ce
 * trebuie confirmat explicit înainte de orice scriere.
 */
export async function sendAssistantCommand({
  message,
  history = [],
  pendingContext = null,
}) {
  return api("/api/ai/assistant/command", {
    method: "POST",

    body: {
      message: String(message || "").trim(),

      history: Array.isArray(history)
        ? history.slice(-10)
        : [],

      ...(pendingContext ? { pendingContext } : {}),
    },
  });
}

/**
 * Rezolvă o dezambiguizare (vendorul a ales un produs/cost
 * dintr-o listă) fără să mai treacă prin LLM.
 */
export async function resolveAssistantCommand({
  commandType,
  productId,
  costItemId,
  params,
}) {
  return api("/api/ai/assistant/command/resolve", {
    method: "POST",

    body: {
      commandType,
      productId,
      costItemId,
      params: params || {},
    },
  });
}
