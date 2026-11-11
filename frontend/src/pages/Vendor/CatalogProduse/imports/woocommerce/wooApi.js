// src/pages/Vendor/CatalogProduse/imports/woocommerce/wooApi.js
//
// Apelurile către /api/vendor/integrations (aceeași convenție ca importul
// Excel din CatalogImports.jsx: URL relativ + cookie de sesiune).

const BASE = "/api/vendor/integrations";

async function request(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const error = new Error("request_failed");
    error.code = "request_failed";
    throw error;
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(data?.message || data?.error || "A apărut o eroare.");
    error.status = response.status;
    error.code = data?.error || null;
    throw error;
  }
  return data;
}

export const wooApi = {
  /** 404 = integrarea e oprită (EXTERNAL_INTEGRATIONS_ENABLED) */
  // fără „/” final: pe Vercel, /api/.../ nu ajunge la backend (404 HTML)
  overview: () => request(""),
  connect: (body) => request("/connections", { method: "POST", body }),
  test: (id) => request(`/connections/${encodeURIComponent(id)}/test`, { method: "POST" }),
  update: (id, body) => request(`/connections/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  disconnect: (id) => request(`/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  status: (id) => request(`/connections/${encodeURIComponent(id)}/status`),
  products: (id, { page = 1, perPage = 20 } = {}) =>
    request(`/connections/${encodeURIComponent(id)}/products?page=${page}&perPage=${perPage}`),
  importProducts: (id, body) => request(`/connections/${encodeURIComponent(id)}/import`, { method: "POST", body }),
};
