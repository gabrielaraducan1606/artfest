// frontend/src/lib/api.js
// ================================
// Wrapper pentru requesturi către API
// ================================

// Baza URL a API-ului — în Netlify setezi:
// VITE_API_URL=https://artfest.onrender.com
// (fallback la VITE_API_BASE_URL dacă ai folosit vechiul nume)
const API_BASE =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "";

/** Construiește URL complet din baza API + path */
function buildUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path; // deja absolut
  if (!base) return path; // fără base → relativ (util în dev cu proxy)
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

/** Wrapper generic pentru fetch cu:
 * - CORS + cookies (credentials: 'include')
 * - content-type automat (FormData / text / JSON)
 * - parse automat (json/text) și handling erori
 */
export async function api(path, opts = {}) {
  const { method = "GET", body, headers = {}, ...rest } = opts;

  const init = {
    method,
    credentials: "include",
    headers: { ...headers },
    ...rest,
  };

  // ----- Body & Content-Type handling -----
  if (body !== undefined && body !== null) {
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      init.body = body; // browserul setează content-type
    } else if (typeof body === "string") {
      init.body = body;
      if (!init.headers["Content-Type"]) {
        try {
          JSON.parse(body);
          init.headers["Content-Type"] = "application/json";
        } catch {
          init.headers["Content-Type"] = "text/plain;charset=UTF-8";
        }
      }
    } else {
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

  if (res.status === 401) return { __unauth: true };

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

// pentru debugging în consolă
export const __API_BASE__ = API_BASE;
