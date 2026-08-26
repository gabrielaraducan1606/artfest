// src/pages/Vendor/CostsProfit/productSearchApi.js

import { api } from "../../../lib/api.js";

/**
 * Căutare "vendor-safe" - întoarce doar produsele proprii,
 * niciodată ale altui vendor. Folosit de Vendor Assistant
 * pentru a găsi un produs după nume, pornind de la text liber.
 */
export async function searchVendorProducts(query) {
  const q = String(query || "").trim();

  if (!q) {
    return [];
  }

  const data = await api(
    `/api/vendor/products/search?q=${encodeURIComponent(q)}`
  );

  return Array.isArray(data?.items) ? data.items : [];
}
