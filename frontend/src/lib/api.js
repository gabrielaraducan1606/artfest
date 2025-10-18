// ================================
// Wrapper pentru requesturi către API
// ================================

// În Netlify setezi DOAR domeniul, fără /api:
// VITE_API_URL=https://artfest.onrender.com
// (în local poți lăsa gol sau pui http://localhost:5000)

const RAW_BASE =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL || // fallback vechi
  "";

// Scoatem orice /api accidental și slash-ul de la final
const BASE_NO_API = RAW_BASE.replace(/\/api\/?$/i, "").replace(/\/$/, "");

// Root-ul API devine mereu <domeniu>/api (sau "" ca să meargă prin proxy în dev)
const API_ROOT = BASE_NO_API ? `${BASE_NO_API}/api` : "";

/** Construiește URL complet din baza API + path */
function buildUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path;       // deja absolut
  const b = base ? base.replace(/\/$/, "") : "";
  const p = path.startsWith("/") ? path : `/${path}`;
  return b ? `${b}${p}` : p;                          // dacă base e gol → relativ (merge cu Vite proxy)
}

/** Wrapper generic pentru fetch */
export async function api(path, opts = {}) {
  const { method = "GET", body, headers = {}, ...rest } = opts;

  const init = {
    method,
    credentials: "include",         // cookie-uri pt auth
    headers: { ...headers },
    ...rest,
  };

  // Body & Content-Type
  if (body !== undefined && body !== null) {
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      init.body = body;             // browserul setează boundary
    } else if (typeof body === "string") {
      init.body = body;
      init.headers["Content-Type"] ??= "application/json";
    } else {
      init.body = JSON.stringify(body);
      init.headers["Content-Type"] ??= "application/json";
    }
  }

  const url = buildUrl(API_ROOT, path);
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

// pentru debugging
export const __API_BASE__ = API_ROOT;
