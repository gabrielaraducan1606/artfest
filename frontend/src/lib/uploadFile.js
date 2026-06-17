// client/src/lib/uploadFile.js

const API_URL = import.meta.env.VITE_API_URL || "";

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

  const url = endpoint.startsWith("http")
    ? endpoint
    : `${API_URL}${endpoint}`;

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