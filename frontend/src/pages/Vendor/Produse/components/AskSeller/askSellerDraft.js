// „Ai întrebări? Întreabă vânzătorul” - reguli pure (fără rețea, fără React).

export const ASK_SELLER_REASONS = Object.freeze([
  { value: "MATERIALS", label: "Materiale și întreținere" },
  { value: "SAFETY", label: "Siguranța produsului" },
  { value: "OTHER", label: "Altă întrebare" },
]);

export const ASK_SELLER_MIN = 5;
export const ASK_SELLER_MAX = 2000;

/* Parametrul din URL care redeschide fereastra după autentificare. */
export const ASK_SELLER_QUERY_PARAM = "intrebare";

const KEY_PREFIX = "artfest:askSeller:";

function storage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function draftKey(productId) {
  return `${KEY_PREFIX}${String(productId || "")}`;
}

/*
 * Ciorna rămâne doar în tab-ul curent (sessionStorage), ca textul să nu se
 * piardă la autentificare. Se șterge după trimitere.
 */
export function saveAskSellerDraft(productId, draft, store = storage()) {
  if (!productId || !store) return false;
  try {
    const reason = typeof draft?.reason === "string" ? draft.reason : "";
    const message = typeof draft?.message === "string" ? draft.message.slice(0, ASK_SELLER_MAX) : "";
    store.setItem(draftKey(productId), JSON.stringify({ reason, message, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function loadAskSellerDraft(productId, store = storage(), maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!productId || !store) return null;
  try {
    const raw = store.getItem(draftKey(productId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.savedAt && Date.now() - parsed.savedAt > maxAgeMs) {
      store.removeItem(draftKey(productId));
      return null;
    }
    const reason = ASK_SELLER_REASONS.some((r) => r.value === parsed.reason) ? parsed.reason : "";
    const message = typeof parsed.message === "string" ? parsed.message.slice(0, ASK_SELLER_MAX) : "";
    if (!reason && !message) return null;
    return { reason, message };
  } catch {
    return null;
  }
}

export function clearAskSellerDraft(productId, store = storage()) {
  if (!productId || !store) return;
  try {
    store.removeItem(draftKey(productId));
  } catch {
    /* fără efect */
  }
}

export function validateAskSeller({ reason, message }) {
  if (!ASK_SELLER_REASONS.some((r) => r.value === reason)) {
    return "Alege motivul întrebării.";
  }
  const len = String(message || "").trim().length;
  if (len < ASK_SELLER_MIN) return "Scrie întrebarea ta (minimum 5 caractere).";
  if (len > ASK_SELLER_MAX) return `Maximum ${ASK_SELLER_MAX} de caractere.`;
  return "";
}

/* URL-ul de întoarcere după login: pagina produsului + ?intrebare=1 (păstrează restul query-ului). */
export function buildAskSellerReturnPath(pathname, search = "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  params.set(ASK_SELLER_QUERY_PARAM, "1");
  const qs = params.toString();
  return `${pathname || "/"}${qs ? `?${qs}` : ""}`;
}

/* URL-ul curent fără ?intrebare=1 (după ce fereastra s-a redeschis). */
export function stripAskSellerParam(pathname, search = "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  params.delete(ASK_SELLER_QUERY_PARAM);
  const qs = params.toString();
  return `${pathname || "/"}${qs ? `?${qs}` : ""}`;
}

export function hasAskSellerParam(search = "") {
  return new URLSearchParams(String(search || "").replace(/^\?/, "")).get(ASK_SELLER_QUERY_PARAM) === "1";
}

export function newClientMessageId() {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `ask_${Date.now().toString(36)}_${rnd}`;
}

/*
 * Mesajul de afișat pentru un răspuns de eroare al API-ului.
 * Întoarce { text, canSendToArtfest, needsLogin }.
 */
export function describeAskSellerError(err) {
  const status = Number(err?.status || 0);
  const data = err?.data && typeof err.data === "object" ? err.data : {};
  if (status === 401) {
    return { text: "Autentifică-te pentru a trimite întrebarea.", canSendToArtfest: false, needsLogin: true };
  }
  if (status === 422) {
    return {
      text:
        data.message ||
        "Mesajul nu poate fi trimis vânzătorului deoarece conține date de contact sau trimite în afara platformei.",
      canSendToArtfest: Boolean(data.canSendToArtfest),
      needsLogin: false,
    };
  }
  if (status === 429) {
    return { text: data.message || "Ai trimis multe întrebări într-un timp scurt. Încearcă puțin mai târziu.", canSendToArtfest: false, needsLogin: false };
  }
  if (status === 403 && data.error === "own_product") {
    return { text: "Acesta este produsul tău.", canSendToArtfest: false, needsLogin: false };
  }
  // 404 de la ruta noastră = produs indisponibil; orice alt 404 (ex. backend fără ruta nouă) nu e vina produsului
  if (status === 404 && data.error === "product_not_found") {
    return { text: "Produsul nu mai este disponibil.", canSendToArtfest: false, needsLogin: false };
  }
  if (status === 404) {
    return { text: "Trimiterea întrebărilor nu este încă disponibilă. Încearcă din nou mai târziu.", canSendToArtfest: false, needsLogin: false };
  }
  if (status === 503) {
    return { text: data.message || "Verificarea mesajelor este momentan indisponibilă. Încearcă din nou peste câteva secunde.", canSendToArtfest: false, needsLogin: false };
  }
  if (status === 400 && data.message) {
    return { text: data.message, canSendToArtfest: false, needsLogin: false };
  }
  return { text: "Nu am putut trimite mesajul. Încearcă din nou.", canSendToArtfest: false, needsLogin: false };
}
