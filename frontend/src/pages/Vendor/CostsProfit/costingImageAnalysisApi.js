// src/pages/Vendor/CostsProfit/costingImageAnalysisApi.js

import { api } from "../../../lib/api.js";

/**
 * Trimite URL-uri de imagini deja încărcate (nu fișiere) -
 * upload-ul se face separat, cu uploadVendorProductImages,
 * exact ca la restul fluxurilor AI din asistentul vendor.
 *
 * Întoarce un draft de componente, NESALVAT nicăieri -
 * vendorul trebuie să-l confirme explicit înainte ca el
 * să devină parte dintr-un costDraft real.
 */
export async function analyzeCostingImages(images) {
  const data = await api("/api/ai/costing/analyze-image", {
    method: "POST",
    body: {
      images: Array.isArray(images)
        ? images.slice(0, 4)
        : [],
    },
  });

  return Array.isArray(data?.components)
    ? data.components
    : [];
}

/**
 * Apelat DUPĂ ce vendorul confirmă componentele (materialsArray
 * din PhotoCostingDraftEditor) - compară determinist fiecare
 * material fără costItemId cu biblioteca de costuri și întoarce
 * cel mult O sugestie (CREATE_COST_ITEM / UPDATE_COST_ITEM),
 * ca pendingAction. Nu salvează nimic.
 */
export async function detectCostItemsFromMaterials(
  materials
) {
  const data = await api(
    "/api/ai/costing/detect-cost-items",
    {
      method: "POST",
      body: {
        items: Array.isArray(materials)
          ? materials.slice(0, 20)
          : [],
      },
    }
  );

  return data?.suggestion || null;
}
