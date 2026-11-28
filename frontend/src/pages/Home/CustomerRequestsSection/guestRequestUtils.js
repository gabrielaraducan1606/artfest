// src/pages/Home/CustomerRequestsSection/guestRequestUtils.js
//
// Cereri de ofertă fără cont (vizitatori, ex. QR de pe flyere) - funcții
// pure (fără React / API, testabile în Node) pentru formular, pagina de
// confirmare și pagina de acces. Regulile reale sunt pe server (customerRequestGuestService.js);
// aici doar ghidăm vizitatorul înainte de trimitere.

export const DRAFT_STORAGE_KEY = "artfest_customer_request_draft";
export const CONFIRM_TOKEN_STORAGE_KEY = "artfest_customer_request_confirm";
export const LINK_ACCOUNT_STORAGE_KEY = "artfest_customer_request_linked";
const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

/* URL-ul pentru QR / linkuri: formularul se deschide direct, fără cont. */
export const QR_REQUEST_PATH = "/cereri?action=create-customer-request&mode=manual&src=flyer";

/* =========================================================
   Validare (oglinda celei de pe server, doar pentru mesaje rapide)
========================================================= */

export function normalizeEmailInput(value) {
  return String(value || "").trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmailInput(value);
  return email.length > 0 && email.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(email);
}

export function displayNameError(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  if (name.length < 2) return "Scrie prenumele sau un nume de utilizator (minimum 2 caractere).";
  if (name.length > 40) return "Numele poate avea cel mult 40 de caractere.";
  if (/[@<>]/.test(name) || /(https?:|www\.)/i.test(name)) return "Numele nu poate conține email sau link.";
  if ((name.match(/\d/g) || []).length >= 5) return "Numele nu poate conține un număr de telefon.";
  return "";
}

export function guestFieldsError({ displayName, email, consent }) {
  const nameError = displayNameError(displayName);
  if (nameError) return { field: "displayName", message: nameError };
  if (!isValidEmail(email)) return { field: "email", message: "Scrie o adresă de email validă." };
  if (consent !== true) return { field: "consent", message: "Bifează acordul pentru prelucrarea datelor ca să putem trimite cererea." };
  return null;
}

export function buildGuestSubmitPayload({ requestPayload, guest, startedAt, source }) {
  const { images, currency, expiresAt, ...fields } = requestPayload || {};
  return {
    ...fields,
    displayName: String(guest?.displayName || "").trim(),
    email: normalizeEmailInput(guest?.email),
    consent: guest?.consent === true,
    wantsAccount: guest?.wantsAccount === true,
    website: String(guest?.website || ""),
    startedAt: Number(startedAt) || null,
    source: source || null,
  };
}

/* =========================================================
   Ciorna formularului (doar în tabul curent, 2 ore)
========================================================= */

function storage(kind = "session") {
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

/*
 * Fără fotografii și fără bifa de acord: acordul se dă din nou la trimitere.
 */
export function saveRequestDraft({ form, categoryQuery, guest } = {}, { now = Date.now(), store = storage() } = {}) {
  if (!store || !form) return false;
  const { images, ...fields } = form;
  const draft = {
    v: 1,
    savedAt: now,
    form: fields,
    categoryQuery: categoryQuery || "",
    guest: guest
      ? {
          displayName: String(guest.displayName || ""),
          email: String(guest.email || ""),
          wantsAccount: guest.wantsAccount === true ? true : guest.wantsAccount === false ? false : null,
        }
      : null,
  };
  try {
    store.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function readRequestDraft({ now = Date.now(), store = storage() } = {}) {
  if (!store) return null;
  try {
    const raw = store.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (draft?.v !== 1 || !draft.form || now - Number(draft.savedAt) > DRAFT_TTL_MS) {
      store.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

export function clearRequestDraft({ store = storage() } = {}) {
  try {
    store?.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // indisponibil
  }
}

/* =========================================================
   Token din linkul de email (#t=...) - scos imediat din bara de adrese
========================================================= */

export function readTokenFromHash(hash) {
  const value = String(hash || "").replace(/^#/, "");
  const params = new URLSearchParams(value);
  const token = params.get("t") || "";
  return /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : "";
}

export function consumeHashToken({ win = typeof window !== "undefined" ? window : null } = {}) {
  if (!win) return "";
  const token = readTokenFromHash(win.location.hash);
  if (token) {
    try {
      win.history.replaceState(null, "", `${win.location.pathname}${win.location.search}`);
    } catch {
      // fără history API: tokenul rămâne doar în bara de adrese a acestui tab
    }
  }
  return token;
}

/* =========================================================
   Textul de acord (CIORNĂ - de aprobat; versiunea pe server:
   GUEST_CONSENT_VERSION din customerRequestGuestService.js)
========================================================= */

export const GUEST_CONSENT_TEXT =
  "Sunt de acord ca Artfest să folosească prenumele și emailul meu pentru a confirma și publica această cerere " +
  "și pentru a-mi trimite pe email ofertele primite. Emailul nu este afișat public și nu este transmis vânzătorilor.";

/*
 * /cerere (link scurt pentru QR) -> formularul de cerere. Păstrează
 * parametrii veniți din QR (ex. utm_source, utm_campaign); `src` implicit
 * „flyer”, dar un `src` explicit din QR are prioritate. `action` / `mode`
 * sunt mereu cele ale formularului manual.
 */
export function buildQrRequestTarget(search = "") {
  const incoming = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const params = new URLSearchParams();
  params.set("action", "create-customer-request");
  params.set("mode", "manual");
  const src = (incoming.get("src") || "flyer").slice(0, 40);
  params.set("src", src);
  for (const [key, value] of incoming) {
    if (["action", "mode", "src", "auth", "redirect"].includes(key)) continue;
    params.append(key, value.slice(0, 200));
  }
  return `/cereri?${params.toString()}`;
}

/* =========================================================
   Linkuri vechi cu login forțat (QR-uri deja tipărite)
========================================================= */

/*
 * Înainte, butonul „Publică o cerere” trimitea vizitatorul la
 * ?auth=login&action=create-customer-request (pe /cereri) sau
 * ?auth=login&redirect=/?action=create-customer-request (pe Home) - iar
 * astfel de URL-uri au ajuns în QR-uri tipărite. Cu fluxul pentru
 * vizitatori activ, ele duc la formularul nou (fără login). Login-ul
 * cerut EXPLICIT din formular („Ai deja cont?”) e marcat în tab și
 * rămâne login.
 */
export const GUEST_LOGIN_INTENT_KEY = "artfest_customer_request_login_intent";
const GUEST_LOGIN_INTENT_TTL_MS = 15 * 60 * 1000;

export const GUEST_LOGIN_RETURN_PATH = "/cereri?action=create-customer-request&mode=manual";

export function markGuestLoginIntent({ now = Date.now(), store = storage() } = {}) {
  try {
    store?.setItem(GUEST_LOGIN_INTENT_KEY, String(now));
  } catch {
    // indisponibil
  }
}

export function hasGuestLoginIntent({ now = Date.now(), store = storage() } = {}) {
  try {
    const at = Number(store?.getItem(GUEST_LOGIN_INTENT_KEY));
    return Number.isFinite(at) && at > 0 && now - at <= GUEST_LOGIN_INTENT_TTL_MS;
  } catch {
    return false;
  }
}

export function clearGuestLoginIntent({ store = storage() } = {}) {
  try {
    store?.removeItem(GUEST_LOGIN_INTENT_KEY);
  } catch {
    // indisponibil
  }
}

const CREATE_ACTION_RE = /(^|[?&])action=create-customer-request(&|#|$)/;

/*
 * Ținta formularului nou pentru un link vechi de cerere cu ?auth=login|
 * register, sau null dacă linkul nu e unul de cerere (login obișnuit).
 * Parametrii de marketing (utm_* etc.) se păstrează.
 */
export function legacyRequestLinkTarget(search = "") {
  const params = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const auth = params.get("auth");
  if (auth !== "login" && auth !== "register") return null;
  if (params.get("as") === "partner") return null;

  let isRequestLink = params.get("action") === "create-customer-request";

  if (!isRequestLink) {
    const redirect = params.get("redirect") || "";
    isRequestLink = CREATE_ACTION_RE.test(redirect.split("#")[0]);
  }

  if (!isRequestLink) return null;

  params.delete("as");
  return buildQrRequestTarget(`?${params.toString()}`).replace("&src=flyer", "&src=qr-vechi");
}
