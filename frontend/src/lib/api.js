// client/src/lib/api.js
const API_BASE =
  (typeof import !== "undefined" &&
    import.meta?.env?.VITE_API_BASE_URL) ||
  (typeof process !== "undefined" &&
    process?.env?.VITE_API_BASE_URL) ||
  ""; // ex: https://artfest.onrender.com

function joinURL(base, path) {
  if (!base) return path;                         // fallback (dev)
  if (/^https?:\/\//i.test(path)) return path;   // deja absolut
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export async function api(path, opts = {}) {
  const { method = "GET", body, headers, ...rest } = opts;

  const init = {
    method,
    credentials: "include",
    headers: { ...(headers || {}) },
    ...rest,
  };

  // ----- Body & Content-Type handling -----
  if (body !== undefined && body !== null) {
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      init.body = body; // fără Content-Type manual
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
      init.headers["Content-Type"] =
        init.headers["Content-Type"] || "application/json";
    }
  }

  const url = joinURL(API_BASE, path);
  const res = await fetch(url, init);

  const contentType = res.headers.get("content-type") || "";
  let data;

  if (res.status === 204) {
    data = null;
  } else if (contentType.includes("application/json")) {
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

  if (res.status === 401) return { __unauth: true };

  if (!res.ok) {
    const msg =
      (data && (data.error || data.message)) ||
      (typeof data === "string" ? data : "Request failed");
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}
