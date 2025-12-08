// src/lib/api.js

// ================================
// Wrapper pentru requesturi către API (rezistent la /api dublat/lipsă)
// ================================
//
// În Netlify setezi DOAR domeniul (cu sau fără /api, ambele sunt ok):
//   VITE_API_URL=https://artfest.onrender.com
// sau
//   VITE_API_BASE_URL=https://artfest.onrender.com/api
//
// În local poți lăsa gol; vom folosi vite proxy pe /api.

// 1) luăm baza din env (pot exista 2 nume)
const RAW_BASE =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "";

// 2) normalizăm domeniul: scoatem slash-ul final
const DOMAIN = RAW_BASE.replace(/\/+$/, "");

// 3) dacă baza e setată, ne asigurăm că are EXACT o dată /api la final
//    dacă baza e goală (local), lăsăm "" și vom prefixa cu "/api" în URL-ul final
const API_BASE = DOMAIN
  ? /\/api$/i.test(DOMAIN)
    ? DOMAIN
    : `${DOMAIN}/api`
  : "";

/**
 * Normalizăm path-ul:
 * - dacă e URL absolut (http/https) -> îl lăsăm așa;
 * - altfel: ne asigurăm că începe cu "/" și SCOATEM /api din față,
 *   ca să nu ajungem la /api/api/... după concatenare.
 */
function normalizePath(path) {
  if (/^https?:\/\//i.test(path)) return path; // absolut -> lăsăm așa
  let p = path.startsWith("/") ? path : `/${path}`;
  p = p.replace(/^\/api(\/|$)/i, "/"); // scoate /api din față dacă e pus în path
  return p;
}

/**
 * Construim URL-ul final:
 * - dacă avem API_BASE (prod), lipim base + path normalizat;
 * - dacă e gol (local), prefixăm cu "/api" ca să lovească vite proxy.
 */
function buildUrl(path) {
  const p = normalizePath(path);
  if (API_BASE) return `${API_BASE}${p}`;
  // local: /api/... -> vite proxy -> http://localhost:5000/api/...
  return `/api${p}`;
}

/**
 * Wrapper generic pentru fetch:
 * - adaugă credentials: "include" (trimite cookie-urile JWT)
 * - setează Content-Type automat pentru JSON
 * - parsează răspunsul (JSON sau text)
 * - aruncă eroare cu status + data pentru coduri !2xx
 */
export async function api(path, opts = {}) {
  const { method = "GET", body, headers = {}, ...rest } = opts;

  const init = {
    method,
    credentials: "include", // important: trimite cookie-ul "token" la backend
    headers: { ...headers },
    ...rest,
  };

  // Body & Content-Type
  if (body !== undefined && body !== null) {
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      init.body = body; // browserul setează boundary
    } else if (typeof body === "string") {
      init.body = body;
      init.headers["Content-Type"] ??= "application/json";
    } else {
      init.body = JSON.stringify(body);
      init.headers["Content-Type"] ??= "application/json";
    }
  }

  const url = buildUrl(path);
  const res = await fetch(url, init);

  const ct = res.headers.get("content-type") || "";
  let data = null;

  if (res.status !== 204) {
    if (ct.includes("application/json")) {
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

  // Convenție: dacă e 401, întoarcem un flag special pentru unele componente (ex: Login)
  if (res.status === 401) return { __unauth: true };

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// pentru debugging în consolă (vezi ce API_BASE folosește aplicația)
export const __API_BASE__ = API_BASE;
