// src/components/AiAssistant/assistantErrorMessages.js

/*
 * Coduri tehnice brute pe care backend-ul le poate întoarce ca
 * `data.error`/`data.code` (vezi authRequired/requireRole/
 * enforceTokenVersion din backend/src/api/auth.js,
 * vendorAccessRequired.js, enforcePolicyGate.js) - și pe care
 * quoteApi.js (apiRequest) le poate propaga chiar ca `error.message`,
 * pentru că folosește `data?.message || data?.error` ca mesaj de
 * eroare când răspunsul n-are un `message` uman. NU trebuie afișate
 * userului ca atare - mapate aici la texte în română.
 */
const AUTH_ERROR_CODE_MESSAGES = {
  unauthenticated: "Trebuie să fii autentificat pentru a continua.",
  unauthorized: "Trebuie să fii autentificat pentru a continua.",
  auth_required: "Trebuie să fii autentificat pentru a continua.",
  invalid_token: "Sesiunea ta a expirat. Te rog să te autentifici din nou.",
  forbidden: "Nu ai acces la această secțiune.",
  forbidden_vendor_mw: "Nu ai acces la această secțiune.",
};

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/*
 * Alege mesajul afișat userului pentru o eroare venită de la un apel
 * API din AI Assistant. Verifică ÎNTÂI codul tehnic explicit
 * (`data.error`/`data.code`), apoi (defensiv) dacă mesajul rezolvat
 * e el însuși unul dintre aceste coduri brute - altfel păstrează
 * mesajul real de la backend (deja gândit pentru user) sau, în lipsa
 * oricărui mesaj, alege un fallback pe baza statusului HTTP.
 */
export function humanizeAssistantErrorMessage(
  error,
  fallback = "A apărut o problemă. Te rog încearcă din nou."
) {
  const codeFromData = normalizeCode(
    error?.data?.error || error?.data?.code
  );

  if (codeFromData && AUTH_ERROR_CODE_MESSAGES[codeFromData]) {
    return AUTH_ERROR_CODE_MESSAGES[codeFromData];
  }

  const rawMessage = error?.data?.message || error?.message;
  const normalizedMessage = normalizeCode(rawMessage);

  if (
    normalizedMessage &&
    AUTH_ERROR_CODE_MESSAGES[normalizedMessage]
  ) {
    return AUTH_ERROR_CODE_MESSAGES[normalizedMessage];
  }

  if (typeof rawMessage === "string" && rawMessage.trim()) {
    return rawMessage;
  }

  if (error?.status === 401) {
    return AUTH_ERROR_CODE_MESSAGES.unauthenticated;
  }

  if (error?.status === 403) {
    return AUTH_ERROR_CODE_MESSAGES.forbidden;
  }

  return fallback;
}
