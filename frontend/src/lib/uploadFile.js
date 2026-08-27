// client/src/lib/uploadFile.js

/*
 * Normalizare rezistentă la /api dublat/lipsă - aceeași strategie ca
 * lib/api.js. VITE_API_URL poate fi gol (local, proxy vite), un domeniu
 * fără /api, sau un domeniu/path CU /api la final (ex. Vercel: "/api") -
 * indiferent de formă, endpoint-urile primite aici ("/api/upload", ...)
 * nu trebuie să ducă la un "/api/api/...".
 */
const RAW_BASE = import.meta.env.VITE_API_URL || "";
const DOMAIN = RAW_BASE.replace(/\/+$/, "");
const API_BASE = DOMAIN
  ? /\/api$/i.test(DOMAIN)
    ? DOMAIN
    : `${DOMAIN}/api`
  : "";

function buildUploadUrl(endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;

  let path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  path = path.replace(/^\/api(\/|$)/i, "/");

  return API_BASE ? `${API_BASE}${path}` : `/api${path}`;
}

/**
 * Upload generic de fișier
 * @param {File} file
 * @param {string} endpoint - ex: /api/upload, /api/upload/products, /api/upload/support
 * @returns {Promise<string>} URL-ul fișierului uploadat
 */
export async function uploadFile(file, endpoint = "/api/upload") {
  const fd = new FormData();

  if (endpoint.includes("/support")) {
    fd.append("files", file);
  } else {
    fd.append("file", file);
  }

  const url = buildUploadUrl(endpoint);

  const res = await fetch(url, {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      data?.message ||
        "Nu am putut încărca fișierul. Încearcă din nou."
    );
  }

  if (data?.url) return data.url;

  if (Array.isArray(data?.urls) && data.urls.length > 0) {
    return data.urls[0];
  }

  if (Array.isArray(data?.items) && data.items.length > 0) {
    return data.items[0].url;
  }

  throw new Error("Uploadul a reușit, dar serverul nu a returnat URL-ul fișierului.");
}