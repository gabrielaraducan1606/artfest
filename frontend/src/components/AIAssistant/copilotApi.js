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
 * BUGFIX (audit): POST /api/assistant/chat (backend/src/ai/../
 * assistantChatRoutes.js) e clasificatorul MAI VECHI, cu propriile
 * intenții (product_search cu maxPrice/color/occasion, image_search,
 * order_status, order_delivery, support, quote, chat, clarify).
 * copilotRouter.js îl menționează explicit ca fallback pentru
 * category EXISTING_FLOW/GENERAL_CONVERSATION (routeCopilotMessage
 * întoarce handled:false + delegateTo:"assistantChatRoutes" exact
 * pentru asta) - dar niciun client nu-l apela efectiv până acum,
 * ceea ce lăsa formulări libere de căutare (ex. "Mă ajuți să găsesc
 * ceva sub 100 lei?", care nu se potrivește cu regexurile locale
 * determinstice și pe care copilotul o clasifică drept
 * MARKETPLACE_SEARCH -> EXISTING_FLOW, handled:false) fără niciun
 * răspuns real - widget-ul arăta direct mesajul generic "Nu sunt
 * sigur ce ai vrut să spui". Acest wrapper închide bucla documentată,
 * dar niciodată legată în UI.
 */
export async function sendAssistantChat({
  message,
  conversation = [],
  activeFlow = null,
  currentPage = null,
  isVendor = false,
}) {
  const response = await fetch(
    "/api/assistant/chat",
    {
      method: "POST",
      credentials: "include",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        message: String(message || "").trim(),

        conversation: Array.isArray(conversation)
          ? conversation.slice(-12)
          : [],

        ...(activeFlow ? { activeFlow } : {}),
        ...(currentPage ? { currentPage } : {}),

        isVendor: Boolean(isVendor),
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
        "Asistentul AI nu a putut răspunde."
    );

    error.data = data;

    throw error;
  }

  return data?.result || null;
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
