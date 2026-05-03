// client/src/lib/uploadFile.js

/**
 * Upload generic de fișier
 * @param {File} file
 * @param {string} endpoint - ex: /api/upload, /api/upload/products, /api/upload/support
 * @returns {Promise<string>} URL-ul fișierului uploadat
 */
export async function uploadFile(file, endpoint = "/api/upload") {
  const fd = new FormData();

  // suport pentru endpoint-uri diferite
  if (endpoint.includes("/support")) {
    fd.append("files", file); // backend așteaptă array
  } else {
    fd.append("file", file); // avatar / products
  }

  const res = await fetch(endpoint, {
    method: "POST",
    body: fd,
    credentials: "include",
  });

  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.message || "Upload eșuat.");
  }

  const data = await res.json();

  // avatar
  if (data?.url) return data.url;

  // products
  if (Array.isArray(data?.urls) && data.urls.length > 0) {
    return data.urls[0];
  }

  // support
  if (Array.isArray(data?.items) && data.items.length > 0) {
    return data.items[0].url;
  }

  throw new Error("Răspuns invalid de la server.");
}