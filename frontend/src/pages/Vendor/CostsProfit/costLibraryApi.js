// src/pages/Vendor/CostsProfit/costLibraryApi.js

import { api } from "../../../lib/api.js";

/* =========================================================
   Bibliotecă de costuri (VendorCostItem)
========================================================= */

export async function fetchCostItems({
  type = "",
  q = "",
  isActive = "true",
} = {}) {
  const params = new URLSearchParams();

  if (type) params.set("type", type);
  if (q) params.set("q", q);
  if (isActive) params.set("isActive", isActive);

  const query = params.toString();

  const data = await api(
    `/api/vendor/cost-items${query ? `?${query}` : ""}`
  );

  return Array.isArray(data?.items) ? data.items : [];
}

export async function createCostItem({
  type,
  name,
  unit,
  unitCostCents,
  notes,
}) {
  return api("/api/vendor/cost-items", {
    method: "POST",
    body: {
      type,
      name,
      unit,
      unitCostCents,
      notes,
    },
  });
}

export async function updateCostItem(
  id,
  patch
) {
  return api(`/api/vendor/cost-items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function archiveCostItem(id) {
  return api(`/api/vendor/cost-items/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function restoreCostItem(id) {
  return updateCostItem(id, { isActive: true });
}
