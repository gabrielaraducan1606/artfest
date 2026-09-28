// src/components/AIAssistant/quotes/quoteRequestIntentEvent.js

/*
 * "vreau o ofertă" scris LIBER în AiAssistant, pe pagina unui produs
 * (/produs/:id) sau a unui magazin (/magazin/:slug), trebuie să
 * pornească EXACT același handler ca butonul existent de pe pagină
 * (ProductDetails.jsx -> onRequestQuote, ProfilMagazin.jsx ->
 * handleVendorMessage) - aceleași verificări (login, owner, vendor
 * valid), același productId/vendorId real și aceleași întrebări
 * quoteSchema. Asistentul NU construiește singur payload-ul cererii:
 * doar anunță intenția, iar pagina (care are produsul/magazinul
 * încărcat complet) o preia prin event.preventDefault() și își
 * apelează propriul handler, care emite "artfest:quote-request" ca
 * la click.
 *
 * Modul fără dependențe, ca paginile să-l poată importa fără să
 * tragă în bundle tot codul asistentului.
 */

export const QUOTE_REQUEST_INTENT_EVENT =
  "artfest:quote-request-intent";

/*
 * Returnează true dacă o pagină montată a preluat intenția (a apelat
 * event.preventDefault()), false altfel (nicio pagină potrivită,
 * utilizatorul e owner-ul produsului/magazinului etc.).
 */
export function dispatchQuoteRequestIntent(
  entity,
  target = typeof window !== "undefined" ? window : null
) {
  if (!target || !entity?.type || !entity?.id) {
    return false;
  }

  const event = new CustomEvent(
    QUOTE_REQUEST_INTENT_EVENT,
    {
      cancelable: true,
      detail: {
        entityType: String(entity.type),
        entityId: String(entity.id),
      },
    }
  );

  // dispatchEvent întoarce false dacă un listener a apelat preventDefault()
  return target.dispatchEvent(event) === false;
}

/*
 * Folosit de pagini ca să preia DOAR intenția pentru entitatea pe
 * care chiar o afișează (evită o pagină rămasă montată/alt id).
 */
export function isQuoteIntentForEntity(
  event,
  entityType,
  entityIds
) {
  const detail = event?.detail || {};

  if (detail.entityType !== entityType) {
    return false;
  }

  const ids = (Array.isArray(entityIds) ? entityIds : [entityIds])
    .filter((id) => id !== null && id !== undefined && id !== "")
    .map(String);

  return ids.includes(String(detail.entityId));
}
