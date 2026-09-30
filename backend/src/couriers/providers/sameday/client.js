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
 * globale din env (înlocuiește, pentru conturile vendorilor,
 * services/samedayClient.js, care folosea SAMEDAY_USERNAME/PASSWORD).
 *
 * Endpoint-uri conform SDK-ului oficial Sameday (sameday-courier/php-sdk):
 *   POST /api/authenticate?remember_me=1   headers X-Auth-Username / X-Auth-Password
 *        -> { token, expire_at }
 *   apoi header X-Auth-Token pe restul apelurilor, ex. GET /api/client/pickup-points
 * DE VALIDAT pe mediul demo Sameday înainte de producție.
 *
 * Token cache: Map per accountId (niciodată global/partajat între conturi).
 * Intrarea păstrează doar tokenul + expirarea + un fingerprint (hash) al
 * credentialelor - dacă vendorul înlocuiește credentialele, fingerprint-ul
 * nu mai corespunde și tokenul vechi e ignorat.
 */

export const SAMEDAY_BASE_URLS = Object.freeze({
  production: "https://api.sameday.ro",
  demo: "https://sameday-api.demo.zitec.com",
});

const REQUEST_TIMEOUT_MS = 10_000;
// plafon de siguranță: expire_at vine fără fus orar
const MAX_TOKEN_TTL_MS = 60 * 60 * 1000;
const TOKEN_SAFETY_MS = 5 * 60 * 1000;

/** @type {Map<string, {token:string, expiresAt:number, fingerprint:string}>} */
const sessions = new Map();

export function invalidateSamedaySession(accountId) {
  if (accountId) sessions.delete(accountId);
}

// doar pentru teste
export function _samedaySessionCount() {
  return sessions.size;
}
export function _clearSamedaySessions() {
  sessions.clear();
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

function parseExpiry(expireAt, now) {
  const parsed = expireAt ? Date.parse(String(expireAt).replace(" ", "T")) : NaN;
  const cap = now + MAX_TOKEN_TTL_MS;
  const exp = Number.isFinite(parsed) ? Math.min(parsed, cap) : cap;
  return exp - TOKEN_SAFETY_MS;
}

async function authenticate(credentials, baseUrl) {
  const res = await httpRequest(`${baseUrl}/api/authenticate?remember_me=1`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "X-Auth-Username": credentials.username,
      "X-Auth-Password": credentials.password,
    },
  });

  // Sameday răspunde cu 400/401/403 la credentiale greșite
  if ([400, 401, 403].includes(res.status)) throw new CourierAuthError();
  if (!res.ok) throw new CourierUnavailableError();

  const data = await readJson(res);
  if (!data?.token || typeof data.token !== "string") {
    throw new CourierUnavailableError();
  }

  return { token: data.token, expiresAt: parseExpiry(data.expire_at, Date.now()) };
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

  if (ctx.accountId && !forceRefresh) {
    const cached = sessions.get(ctx.accountId);
    if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
      return { token: cached.token, baseUrl };
    }
  }

  const { token, expiresAt } = await authenticate(ctx.credentials, baseUrl);

  if (ctx.accountId) {
    sessions.set(ctx.accountId, { token, expiresAt, fingerprint });
  }

  return { token, baseUrl };
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
 * @param {{ method?: string, path: string, form?: URLSearchParams, binary?: boolean }} req
 */
export async function samedayRequest(ctx, { method = "GET", path, form, binary = false }) {
  let session = await getSamedaySession(ctx);

  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = {
      Accept: binary ? "application/pdf" : "application/json",
      "X-Auth-Token": session.token,
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

    return readJson(res);
  }

  throw new CourierUnavailableError();
}

export function samedayGet(ctx, path) {
  return samedayRequest(ctx, { method: "GET", path });
}
