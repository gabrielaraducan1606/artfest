// ================================
// Wrapper pentru requesturi către API (rezistent la /api dublat/lipsă)
// ================================

// În Netlify setezi DOAR domeniul (cu sau fără /api, ambele sunt ok):
// VITE_API_URL=https://artfest.onrender.com
// (în local poți lăsa gol; vom folosi vite proxy pe /api)

const RAW_BASE =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "";

// 1) normalizăm domeniul: scoatem slash-ul final
const DOMAIN = RAW_BASE.replace(/\/+$/, "");

// 2) daca baza e setată, ne asigurăm că are EXACT o dată /api la final
//    dacă baza e goală (local), lăsăm "" și vom prefixa cu "/api" în URL-ul final
const API_BASE = DOMAIN
  ? /\/api$/i.test(DOMAIN)
    ? DOMAIN
    : `${DOMAIN}/api`
  : "";

// 3) normalizăm path-ul: scoatem un eventual prefix /api din față ca să nu-l dublăm
function normalizePath(path) {
  if (/^https?:\/\//i.test(path)) return path; // absolut -> lăsăm așa
  let p = path.startsWith("/") ? path : `/${path}`;
  p = p.replace(/^\/api(\/|$)/i, "/"); // scoate /api din față dacă e pus în path
  return p;
}

// 4) construim URL-ul final:
//    - dacă avem API_BASE (prod), lipim base + path normalizat
//    - dacă e gol (local), prefixăm cu "/api" ca să lovească vite proxy
function buildUrl(path) {
  const p = normalizePath(path);
  if (API_BASE) return `${API_BASE}${p}`;
  return `/api${p}`; // local: /api/... -> vite proxy -> http://localhost:5000/api/...
}

/** Wrapper generic pentru fetch cu cookies + content-type automat */
export async function api(path, opts = {}) {
  const { method = "GET", body, headers = {}, ...rest } = opts;

  const init = {
    method,
    credentials: "include",
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
      try { data = await res.json(); } catch { data = null; }
    } else {
      const text = await res.text();
      try { data = text && text[0] === "{" ? JSON.parse(text) : text; } catch { data = text; }
    }
  }

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

// pentru debugging în consolă
export const __API_BASE__ = API_BASE;
