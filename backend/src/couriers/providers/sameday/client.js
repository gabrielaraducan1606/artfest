// backend/src/couriers/providers/sameday/client.js

import crypto from "node:crypto";
import {
  CourierAuthError,
  CourierTimeoutError,
  CourierUnavailableError,
  CourierValidationError,
} from "../../errors.js";

/*
 * Client HTTP Sameday, PER CONT (CourierAccount) - fără credentiale
 * globale din env (services/samedayClient.js, vechi, NU e folosit de AWB).
 *
 * Conform „API custom documentation” v3.6 (PDF) + Swagger-ul sandbox actual:
 *   POST /api/authenticate   headers X-AUTH-USERNAME / X-AUTH-PASSWORD (PDF),
 *        body x-www-form-urlencoded remember_me=true (Swagger; PDF: „remember_me=1”)
 *        -> { token, expire_at, expire_at_utc }  (12h; cu remember_me, 14 zile)
 *   apoi header X-AUTH-TOKEN pe restul apelurilor.
 *   Limită: 12 autentificări / IP / minut (PDF).
 *
 * Token cache: Map per accountId (niciodată global/partajat între conturi),
 * în memoria serverului - tokenul nu ajunge niciodată în frontend / DB /
 * loguri. Intrarea păstrează tokenul + expirarea + un fingerprint (hash) al
 * credentialelor: credentiale înlocuite -> tokenul vechi e ignorat.
 *  - reînnoire cu TOKEN_REFRESH_BEFORE_MS înainte de expirare;
 *  - O SINGURĂ autentificare în zbor per cont: cererile simultane (mai multe
 *    AWB-uri generate în același timp) așteaptă aceeași promisiune;
 *  - după un refuz al credentialelor, pauză AUTH_FAILURE_COOLDOWN_MS fără
 *    alt apel (nu consumăm limita de 12/min cu aceleași date greșite).
 */

export const SAMEDAY_BASE_URLS = Object.freeze({
  production: "https://api.sameday.ro",
  demo: "https://sameday-api.demo.zitec.com",
});

const REQUEST_TIMEOUT_MS = 10_000;
// remember_me=1 -> 14 zile (doc v3.6); plafon dacă răspunsul n-are expirare validă
const MAX_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const FALLBACK_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const TOKEN_REFRESH_BEFORE_MS = 60 * 60 * 1000;
export const AUTH_FAILURE_COOLDOWN_MS = 60 * 1000;

/*
 * Sameday a respins utilizatorul/parola la /api/authenticate. Câmpul
 * acceptă utilizator eAWB sau email și trimitem exact valoarea introdusă -
 * dacă vendorul a pus emailul și Sameday nu-l acceptă, îl îndrumăm spre
 * numele de utilizator eAWB (fără a încerca alte variante automat).
 */
export const SAMEDAY_AUTH_REJECTED_MESSAGE =
  "Sameday nu a acceptat aceste date. Dacă ai introdus emailul, încearcă numele de utilizator eAWB primit de la Sameday.";

/** @type {Map<string, {token:string, expiresAt:number, fingerprint:string}>} */
const sessions = new Map();
/** autentificări în curs, per cont: {fingerprint, promise} */
const inflight = new Map();
/** ultimul refuz al credentialelor, per cont: {fingerprint, at} */
const authFailures = new Map();

export function invalidateSamedaySession(accountId) {
  if (!accountId) return;
  sessions.delete(accountId);
  authFailures.delete(accountId);
}

// doar pentru teste
export function _samedaySessionCount() {
  return sessions.size;
}
export function _clearSamedaySessions() {
  sessions.clear();
  inflight.clear();
  authFailures.clear();
}

function fingerprintOf(credentials, baseUrl) {
  return crypto
    .createHash("sha256")
    .update(`${baseUrl}\u0000${credentials.username}\u0000${credentials.password}`)
    .digest("hex");
}

export function resolveBaseUrl(publicConfig = {}, env = process.env) {
  const environment = publicConfig?.environment || "production";
  if (environment === "demo") {
    const allowDemo =
      env.COURIER_ALLOW_SANDBOX === "1" || env.NODE_ENV !== "production";
    if (!allowDemo) {
      throw new CourierValidationError(
        "Mediul de test Sameday nu este disponibil.",
        ["environment"]
      );
    }
  }
  const url = SAMEDAY_BASE_URLS[environment];
  if (!url) {
    throw new CourierValidationError("Mediul Sameday nu este valid.", ["environment"]);
  }
  return url;
}

// fetch cu timeout; erorile de rețea devin erori generice (fără detalii)
async function httpRequest(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new CourierTimeoutError();
    throw new CourierUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    throw new CourierUnavailableError();
  }
}

/*
 * Momentul expirării tokenului (ms), din expire_at_utc. Două forme documentate:
 * PDF „YYYY-MM-DD HH:mm” (UTC, fără fus) și Swagger ISO „…T…Z”. expire_at
 * (ora locală Sameday) nu e folosit; fără expire_at_utc valid -> 12h (durata
 * minimă documentată).
 */
function parseUtcTimestamp(value) {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  if (/[zZ]$|[+-]d{2}:?d{2}$/.test(raw)) return Date.parse(raw);
  return Date.parse(`${raw.replace(" ", "T")}Z`);
}

export function parseTokenExpiry(data, now = Date.now()) {
  const utc = parseUtcTimestamp(data?.expire_at_utc);
  if (Number.isFinite(utc) && utc > now) return Math.min(utc, now + MAX_TOKEN_TTL_MS);
  return now + FALLBACK_TOKEN_TTL_MS;
}

async function authenticate(credentials, baseUrl) {
  const res = await httpRequest(`${baseUrl}/api/authenticate`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "X-AUTH-USERNAME": credentials.username,
      "X-AUTH-PASSWORD": credentials.password,
    },
    body: new URLSearchParams({ remember_me: "true" }).toString(),
  });

  // credentiale greșite: Swagger documentează 403; acceptăm și 400/401
  if ([400, 401, 403].includes(res.status)) {
    throw new CourierAuthError(SAMEDAY_AUTH_REJECTED_MESSAGE);
  }
  if (!res.ok) throw new CourierUnavailableError();

  const data = await readJson(res);
  if (!data?.token || typeof data.token !== "string") {
    throw new CourierUnavailableError();
  }

  return { token: data.token, expiresAt: parseTokenExpiry(data) };
}

/**
 * Sesiune (token) pentru un cont. accountId null = cont încă nesalvat
 * (testare înainte de salvare) -> fără cache.
 * @param {{accountId:string|null, credentials:Object, publicConfig:Object}} ctx
 * @param {{ forceRefresh?: boolean }} [opts]
 */
export async function getSamedaySession(ctx, { forceRefresh = false } = {}) {
  const baseUrl = resolveBaseUrl(ctx.publicConfig);
  const fingerprint = fingerprintOf(ctx.credentials, baseUrl);

  if (!ctx.accountId) {
    const { token } = await authenticate(ctx.credentials, baseUrl);
    return { token, baseUrl };
  }

  const id = ctx.accountId;

  if (!forceRefresh) {
    const cached = sessions.get(id);
    if (cached && cached.fingerprint === fingerprint && cached.expiresAt - TOKEN_REFRESH_BEFORE_MS > Date.now()) {
      return { token: cached.token, baseUrl };
    }
  }

  // aceleași credentiale refuzate de curând -> fără alt apel la Sameday
  const failure = authFailures.get(id);
  if (failure && failure.fingerprint === fingerprint && Date.now() - failure.at < AUTH_FAILURE_COOLDOWN_MS) {
    throw new CourierAuthError(SAMEDAY_AUTH_REJECTED_MESSAGE);
  }

  // o singură autentificare în zbor per cont (și per set de credentiale)
  const running = inflight.get(id);
  if (running && running.fingerprint === fingerprint) {
    const { token } = await running.promise;
    return { token, baseUrl };
  }

  const promise = authenticate(ctx.credentials, baseUrl)
    .then((session) => {
      sessions.set(id, { ...session, fingerprint });
      authFailures.delete(id);
      return session;
    })
    .catch((e) => {
      if (e instanceof CourierAuthError) {
        sessions.delete(id);
        authFailures.set(id, { fingerprint, at: Date.now() });
      }
      throw e;
    })
    .finally(() => {
      if (inflight.get(id)?.promise === promise) inflight.delete(id);
    });

  inflight.set(id, { fingerprint, promise });
  try {
    const { token } = await promise;
    return { token, baseUrl };
  } catch (e) {
    // reînnoire anticipată eșuată temporar: tokenul vechi e încă valid
    const cached = sessions.get(id);
    if (!forceRefresh && !(e instanceof CourierAuthError) && cached?.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
      return { token: cached.token, baseUrl };
    }
    throw e;
  }
}

/*
 * Câmpurile respinse de Sameday la 400 (structura Symfony form errors:
 * { errors: { children: { field: { errors: [...] }, awbRecipient: { children: ... } } } }).
 * Întoarcem DOAR căile câmpurilor (ex. "awbRecipient.phoneNumber"), nu și
 * mesajele/valorile - pot conține date trimise.
 */
export function collectSamedayErrorFields(body) {
  const out = [];
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.errors) && node.errors.length && path) out.push(path);
    const children = node.children && typeof node.children === "object" ? node.children : null;
    if (children) {
      for (const [key, child] of Object.entries(children)) {
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(body?.errors, "");
  return [...new Set(out)].slice(0, 30);
}

/**
 * Apel autentificat generic. La 401 (token expirat/revocat) reautentifică o
 * singură dată - sigur și pentru POST: un 401 înseamnă cerere neprocesată.
 * Dacă tot 401/403 -> credentiale invalide.
 *
 * @param {Object} ctx
 * @param {{ method?: string, path: string, form?: URLSearchParams, binary?: boolean, allowEmpty?: boolean }} req
 *   allowEmpty: răspuns 2xx fără corp (ex. DELETE) -> null, nu eroare
 */
export async function samedayRequest(ctx, { method = "GET", path, form, binary = false, allowEmpty = false }) {
  let session = await getSamedaySession(ctx);

  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = {
      Accept: binary ? "application/pdf" : "application/json",
      "X-AUTH-TOKEN": session.token,
    };
    if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";

    const res = await httpRequest(`${session.baseUrl}${path}`, {
      method,
      headers,
      ...(form ? { body: form.toString() } : {}),
    });

    if (res.status === 401 && attempt === 0) {
      invalidateSamedaySession(ctx.accountId);
      session = await getSamedaySession(ctx, { forceRefresh: true });
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new CourierAuthError();

    if (res.status === 400 || res.status === 422) {
      // date respinse de Sameday: eșec SIGUR (nimic creat)
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const err = new CourierValidationError(
        "Sameday a respins datele expedierii. Verifică adresa, greutatea și serviciul ales.",
        collectSamedayErrorFields(body)
      );
      err.providerStatus = res.status;
      // respins de curier (nu cerere invalidă a clientului nostru)
      err.httpStatus = 422;
      throw err;
    }

    if (res.status === 404) {
      const err = new CourierUnavailableError("Resursa nu a fost găsită la Sameday.");
      err.providerStatus = 404;
      throw err;
    }

    if (!res.ok) {
      const err = new CourierUnavailableError();
      err.providerStatus = res.status;
      throw err;
    }

    if (binary) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new CourierUnavailableError();
      return { buffer: buf, contentType: res.headers.get("content-type") || "application/pdf" };
    }

    if (allowEmpty) {
      const text = await res.text();
      if (!text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }

    return readJson(res);
  }

  throw new CourierUnavailableError();
}

export function samedayGet(ctx, path) {
  return samedayRequest(ctx, { method: "GET", path });
}
