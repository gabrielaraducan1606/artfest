// Baza API din .env (Vite)
const API_BASE = import.meta.env.VITE_API_BASE_URL || ""; // ex: https://artfest.onrender.com

function buildUrl(base, path) {
  // Dacă path e deja absolut (http/https), îl folosim ca atare
  if (/^https?:\/\//i.test(path)) return path;

  // Dacă nu avem base (ex. dev local), întoarce path relativ
  if (!base) return path;

  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

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
    // 1) FormData → nu setăm Content-Type (o pune browserul)
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      init.body = body;
    }
    // 2) String → îl trimitem ca atare; dacă pare JSON, setează content-type
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
    // 3) Orice alt obiect → JSON
    else {
      init.body = JSON.stringify(body);
      if (!init.headers["Content-Type"]) {
        init.headers["Content-Type"] = "application/json";
      }
    }
  }

  const url = buildUrl(API_BASE, path);
  const res = await fetch(url, init);

  // --- Parse response (json / text / 204) ---
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

  if (res.status === 401) {
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

// Exportă pentru debugging (poți șterge după)
export const __API_BASE__ = API_BASE;
