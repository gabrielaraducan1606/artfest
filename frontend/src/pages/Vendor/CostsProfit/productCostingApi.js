// src/pages/Vendor/CostsProfit/productCostingApi.js

import { api } from "../../../lib/api.js";

/* =========================================================
   Costing persistent per produs (ProductCosting)
========================================================= */

export async function fetchProductCosting(productId) {
  const data = await api(
    `/api/vendor/products/${encodeURIComponent(productId)}/costing`
  );

  return data?.costing || null;
}

/**
 * costDraft folosește aceeași formă ca la calculatorul
 * conversațional (materials, packagingCost, otherCosts,
 * laborHours, hourlyRate, desiredProfit), opțional cu
 * costItemId pe fiecare linie legată de biblioteca de costuri.
 */
export async function saveProductCosting(
  productId,
  costDraft
) {
  const data = await api(
    `/api/vendor/products/${encodeURIComponent(productId)}/costing`,
    {
      method: "PUT",
      body: { costDraft },
    }
  );

  return data?.costing || null;
}

export async function confirmProductCosting(productId) {
  const data = await api(
    `/api/vendor/products/${encodeURIComponent(productId)}/costing/confirm`,
    {
      method: "POST",
    }
  );

  return data?.costing || null;
}

export async function recalculateProductCosting(productId) {
  const data = await api(
    `/api/vendor/products/${encodeURIComponent(productId)}/costing/recalculate`,
    {
      method: "POST",
    }
  );

  return data?.costing || null;
}

/**
 * SINGURA operație din tot modulul care schimbă
 * Product.priceCents. `acknowledgeStaleData` trebuie trimis
 * explicit `true` dacă costing-ul nu e confirmat sau are
 * needsRecalculation - altfel backend-ul respinge cu 409.
 */
export async function applyRecommendedPrice(
  productId,
  acknowledgeStaleData = false
) {
  return api(
    `/api/vendor/products/${encodeURIComponent(productId)}/costing/apply-recommended-price`,
    {
      method: "POST",
      body: { acknowledgeStaleData },
    }
  );
}

/**
 * Recalculare determinist pentru mai multe produse deodată.
 */
export async function recalculateProductsBatch(
  productIds
) {
  const data = await api(
    "/api/vendor/products/costing/recalculate-batch",
    {
      method: "POST",
      body: { productIds },
    }
  );

  return Array.isArray(data?.results)
    ? data.results
    : [];
}

/**
 * Reconstruiește forma "costDraft" (materials/packagingCost/
 * otherCosts/laborHours/hourlyRate/desiredProfit) pornind de
 * la un costing deja salvat (`items[]` + câmpurile scalare),
 * ca la o nouă salvare să nu pierdem manopera/profitul deja
 * introduse, chiar dacă doar materialele se schimbă (de
 * exemplu după o analiză din fotografie).
 *
 * Pură reformatare de date deja primite de la server - nu
 * recalculează nimic.
 */
export function costingToCostDraftShape(costing) {
  const empty = {
    materials: [],
    packagingCost: 0,
    packagingCostItemId: null,
    otherCosts: [],
    laborHours: null,
    hourlyRate: null,
    desiredProfit: null,
  };

  if (!costing) {
    return empty;
  }

  const materials = [];
  let packagingCost = 0;
  let packagingCostItemId = null;
  const otherCosts = [];

  for (const item of costing.items || []) {
    const lineTotal =
      Number(item.unitCost || 0) *
      Number(item.quantity || 1);

    if (item.kind === "MATERIAL") {
      materials.push({
        name: item.label,
        quantity: item.quantity,
        unit: item.unit || "",
        unitCost: item.unitCost,
        costItemId: item.costItemId || null,
      });
    } else if (item.kind === "PACKAGING") {
      packagingCost += lineTotal;

      packagingCostItemId =
        item.costItemId ||
        packagingCostItemId;
    } else if (item.kind === "OTHER") {
      otherCosts.push({
        label: item.label,
        amount: lineTotal,
        costItemId: item.costItemId || null,
      });
    }
  }

  return {
    materials,
    packagingCost,
    packagingCostItemId,
    otherCosts,
    laborHours: costing.laborHours ?? null,
    hourlyRate: costing.hourlyRate ?? null,
    desiredProfit: costing.desiredProfit ?? null,
  };
}

/* =========================================================
   Info de bază despre produs (titlu, imagine, preț) -
   reutilizează endpointul de administrare produs deja
   existent, nu unul nou.
========================================================= */

export async function fetchVendorProductSummary(
  productId
) {
  const data = await api(
    `/api/vendor/products/${encodeURIComponent(productId)}`
  );

  return {
    id: data?.id,
    title: data?.title || "",
    image: Array.isArray(data?.images)
      ? data.images[0] || null
      : null,
    price: data?.price ?? 0,
    priceCents: data?.priceCents ?? 0,
  };
}
