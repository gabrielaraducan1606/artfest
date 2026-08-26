// src/components/AIAssistant/copilotApi.js

/*
 * Wrapper pentru routerul general al copilot-ului Artfest
 * (FAZA 4-7, backend/src/ai/copilotRouter.js) - loc NEUTRU,
 * reutilizat atât de AiAssistant.jsx (client) cât și de
 * VendorAIAssistant/VendorAssistant.jsx (vendor), la fel cum
 * vendorPlatformApi.js e deja reutilizat de amândouă.
 */
export async function sendCopilotAsk({
  message,
  history = [],
  currentPage = null,
  currentEntity = null,
  conversationContext = null,
}) {
  const response = await fetch(
    "/api/assistant/copilot/ask",
    {
      method: "POST",
      credentials: "include",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        message: String(message || "").trim(),

        history: Array.isArray(history)
          ? history.slice(-10)
          : [],

        ...(currentPage ? { currentPage } : {}),

        /*
         * currentEntity e doar HINT de rezolvare pentru backend
         * (vezi copilotRouter.js) - NU e de încredere pentru
         * autorizare, ownership-ul se verifică din nou server-side
         * indiferent ce trimitem aici.
         */
        ...(currentEntity ? { currentEntity } : {}),

        ...(conversationContext
          ? { conversationContext }
          : {}),
      }),
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
        data?.error ||
        "Copilotul Artfest nu a putut răspunde."
    );

    error.data = data;

    throw error;
  }

  return data;
}

/*
 * PROACTIVE COPILOT - insight-uri calculate live pentru vendorul
 * autentificat (GET /api/assistant/copilot/insights, STRICT
 * read-only, vezi backend/src/ai/insightsService.js). Folosit doar
 * din VendorAssistant.jsx - nu are sens pentru widget-ul de client.
 */
export async function fetchVendorInsights() {
  const response = await fetch(
    "/api/assistant/copilot/insights",
    {
      method: "GET",
      credentials: "include",
    }
  );

  let data = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
        data?.error ||
        "Nu am putut calcula insight-urile."
    );

    error.data = data;

    throw error;
  }

  return Array.isArray(data?.insights) ? data.insights : [];
}
