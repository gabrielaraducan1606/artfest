// src/lib/api.js
// ================================
// Wrapper pentru requesturi către API
// ================================

// Baza URL a API-ului — setează în .env:
// VITE_API_BASE_URL=https://artfest.onrender.com
const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

/**
 * Construiește URL complet din baza API + path
 * Dacă path-ul e absolut (începe cu http/https), îl returnează ca atare.
 */
function buildUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path; // dacă e deja absolut
  if (!base) return path; // fără base (ex. dev local) → rămâne relativ

  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

/**
 * Wrapper generic pentru fetch cu suport:
 * - CORS + cookies (credentials: include)
 * - Content-Type automat pentru JSON / text / FormData
 * - parse automată a răspunsului
 * - aruncă eroare dacă status != ok
 */
export async function api(path, opts = {}) {
  const { method = "GET", body, headers = {}, ...rest } = opts;

  const init = {
    method,
    credentials: "include", // important pentru autentificare cu cookie-uri
    headers: { ...headers },
    ...rest,
  };

  // ----- Body & Content-Type handling -----
  if (body !== undefined && body !== null) {
    // 1) FormData → lăsăm browserul să seteze boundary + content-type
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      init.body = body;
    }
    // 2) String → îl trimitem ca atare
    else if (typeof body === "string") {
      init.body = body;
      if (!init.headers["Content-Type"]) {
        try {
          JSON.parse(body);
          init.headers["Content-Type"] = "application/json";
        } catch {
          init.headers["Content-Type"] = "text/plain;charset=UTF-8";
        }
      }
    }
    // 3) Obiect → JSON
    else {
      init.body = JSON.stringify(body);
      if (!init.headers["Content-Type"]) {
        init.headers["Content-Type"] = "application/json";
      }
    }
  }

  const url = buildUrl(API_BASE, path);
  const res = await fetch(url, init);

  const contentType = res.headers.get("content-type") || "";
  let data = null;

  if (res.status !== 204) {
    if (contentType.includes("application/json")) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    } else {
      const text = await res.text();
      try {
        data = text && text[0] === "{" ? JSON.parse(text) : text;
      } catch {
        data = text;
      }
    }
  }

  if (res.status === 401) {
    // semnalizează lipsa autentificării
    return { __unauth: true };
  }

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      (typeof data === "string" ? data : `Request failed (${res.status})`);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * Export pentru debugging rapid din consola browserului:
 * window.__API_BASE__
 */
export const __API_BASE__ = API_BASE;
