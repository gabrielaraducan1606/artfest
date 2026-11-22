// src/lib/productCreateRequest.js
//
// Crearea unui produs, comună pentru ProductModal, Catalog și Smart Listing:
//   - cheia operațiunii (header `Idempotency-Key`): aceeași la orice
//     reîncercare a ACELEIAȘI creări (și după reîncărcarea paginii), nouă după
//     o creare confirmată sau la „produs nou”. Serverul întoarce produsul deja
//     creat în loc să facă unul dublu (services/productCreateIdempotency.js).
//     Se ține separat de ciorne (cheie proprie în localStorage), ca sistemul
//     de ciorne să rămână neschimbat.
//   - interpretarea erorilor de salvare: validare / fotografii / fără
//     confirmare (timeout, rețea, 502-504) / eroare reală de server / cheie
//     folosită deja - mesaje în română, cu codul de diagnostic, fără detalii
//     interne. Succesul se arată doar când serverul a întors produsul.

const PREFIX = "artfest-product-create-op";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KEY_RE = /^[A-Za-z0-9_-]{16,100}$/;

function storageKey(scope) {
  return `${PREFIX}:${String(scope || "default")}`;
}

export function newOperationKey() {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `op_${random}`;
}

/** Cheia operațiunii de creare pentru `scope` (o creează la nevoie). Fără stocare: cheie doar în memorie. */
export function getCreateOperationKey(storage, scope, now = Date.now()) {
  try {
    const saved = JSON.parse(storage?.getItem(storageKey(scope)) || "null");
    if (saved && KEY_RE.test(String(saved.key || "")) && now - Number(saved.createdAt || 0) < TTL_MS) return saved.key;
  } catch {
    // stocare indisponibilă / coruptă -> cheie nouă
  }
  const key = newOperationKey();
  try {
    storage?.setItem(storageKey(scope), JSON.stringify({ key, createdAt: now }));
  } catch {
    // fără stocare: cheia rămâne valabilă pentru reîncercările din această pagină
  }
  return key;
}

/** După o creare confirmată sau „produs nou”: următoarea creare primește altă cheie. */
export function clearCreateOperationKey(storage, scope) {
  try {
    storage?.removeItem(storageKey(scope));
  } catch {
    // nimic de șters
  }
}

export function idempotencyHeaders(key) {
  return key ? { "Idempotency-Key": key } : {};
}

/* ---------------- erorile de salvare ---------------- */

const UPLOAD_CODES = new Set(["invalid_product_images", "product_image_required", "invalid_images", "images_required"]);
const AMBIGUOUS_STATUSES = new Set([408, 502, 503, 504]);

function statusOf(error) {
  const value = Number(error?.status ?? error?.response?.status);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function dataOf(error) {
  return error?.data || error?.response?.data || {};
}

// un mesaj care e doar un cod tehnic (ex. „server_error”) nu ajunge la vânzător
const looksTechnical = (text) => !text || /^[a-z0-9_.:-]+$/i.test(String(text).trim()) || /Request failed/i.test(String(text));

/**
 * @returns {{ kind: "validation"|"upload"|"ambiguous"|"server"|"conflict"|"auth"|"plan", message: string, diagnosticId: string|null, productId?: string|null }}
 */
export function describeProductSaveError(error, { creating = true } = {}) {
  const status = statusOf(error);
  const data = dataOf(error);
  const code = String(data?.error || data?.code || "");
  const diagnosticId = data?.diagnosticId ? String(data.diagnosticId) : null;
  const serverMessage = looksTechnical(data?.message) ? "" : String(data.message);

  if (status === 402 || code === "upgrade_required") {
    return { kind: "plan", message: serverMessage || "Ai atins limita de produse a abonamentului.", diagnosticId };
  }
  if (status === 401 || status === 403) {
    return { kind: "auth", message: "Sesiunea a expirat sau contul nu poate salva produse. Autentifică-te din nou.", diagnosticId };
  }
  if (status === 409 && (code === "idempotency_key_reused" || code === "idempotency_product_deleted")) {
    return {
      kind: "conflict",
      message:
        code === "idempotency_product_deleted"
          ? "Produsul creat anterior din acest formular a fost șters. Salvează din nou pentru a crea un produs nou."
          : "Un produs a fost deja creat din acest formular, înainte de modificările tale. Îl găsești în lista de produse; salvează din nou pentru a crea un produs nou.",
      diagnosticId,
      productId: data?.productId || null,
    };
  }
  if (UPLOAD_CODES.has(code)) {
    return { kind: "upload", message: serverMessage || "Unele fotografii nu pot fi folosite. Încarcă-le din nou și salvează.", diagnosticId };
  }
  if (status && status >= 400 && status < 500 && !AMBIGUOUS_STATUSES.has(status)) {
    return {
      kind: "validation",
      message: serverMessage || `Verifică datele produsului și încearcă din nou.${code ? ` (cod: ${code})` : ""}`,
      diagnosticId,
    };
  }
  // fără răspuns / timeout / 502-504: salvarea poate fi reușit sau nu
  if (!status || AMBIGUOUS_STATUSES.has(status)) {
    return {
      kind: "ambiguous",
      message: creating
        ? "Nu am primit confirmarea salvării (serverul sau conexiunea nu au răspuns la timp). Salvează din nou: dacă produsul a fost deja creat, îl regăsim, fără să se creeze unul dublu."
        : "Nu am primit confirmarea salvării (serverul sau conexiunea nu au răspuns la timp). Verifică produsul și salvează din nou dacă modificările lipsesc.",
      diagnosticId,
    };
  }
  return {
    kind: "server",
    message: creating
      ? "A apărut o eroare pe server și nu am putut confirma salvarea produsului. Încearcă din nou peste câteva momente; nu se va crea un produs dublu."
      : "A apărut o eroare pe server și nu am putut confirma salvarea modificărilor. Încearcă din nou peste câteva momente.",
    diagnosticId,
  };
}

/** Textul complet pentru vânzător (cu codul de diagnostic, dacă există). */
export function productSaveErrorText(error, options) {
  const described = describeProductSaveError(error, options);
  return described.diagnosticId ? `${described.message}\nCod de diagnostic: ${described.diagnosticId}` : described.message;
}

/** Mesajul după o salvare REUȘITĂ, când verificarea rulează după răspuns. */
export const PRODUCT_SAVED_IN_REVIEW = "Produsul a fost salvat și este în curs de verificare.";

export function isModerationQueued(saved) {
  return Boolean(saved?.moderationQueued) && String(saved?.moderationStatus || "").toUpperCase() !== "APPROVED";
}
