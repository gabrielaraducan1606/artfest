// src/pages/Home/homeActions.js
//
// Acțiuni comune ale homepage-ului (hero, direcții, explicația cererilor):
// deschiderea formularului de cerere gratuită și ancora secțiunii de
// evenimente. Fără React - folosibil și din teste.

/*
 * Formularul de cerere trăiește în CustomerRequestsSection (modal +
 * fluxul guest -> login -> formular). Butoanele din alte secțiuni îl
 * deschid prin acest eveniment; secțiunea răspunde cu preventDefault()
 * ca semn că l-a preluat.
 */
export const CREATE_REQUEST_EVENT = "artfest:create-customer-request";

/* Fallback când secțiunea nu e montată: pagina /cereri are același flux. */
export const CREATE_REQUEST_FALLBACK_URL =
  "/cereri?action=create-customer-request&mode=manual";

/* Ținta butonului „Pregătesc un eveniment” din hero. */
export const EVENTS_ANCHOR_ID = "pregatesc-un-eveniment";

/**
 * Cere deschiderea formularului de cerere gratuită.
 * @returns {boolean} true dacă secțiunea de cereri l-a preluat
 */
export function openCreateCustomerRequest(mode = "manual", target = globalThis.window) {
  if (!target?.dispatchEvent || typeof CustomEvent !== "function") return false;

  const event = new CustomEvent(CREATE_REQUEST_EVENT, {
    detail: { mode: mode === "ai" ? "ai" : "manual" },
    cancelable: true,
  });

  // dispatchEvent întoarce false dacă un ascultător a apelat preventDefault()
  return target.dispatchEvent(event) === false;
}
