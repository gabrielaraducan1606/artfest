// src/features/smartListing/smartListingProductCollections.js
//
// Colecțiile unui produs EXISTENT (editare), doar prin endpointurile existente:
//   GET    /api/vendor/collections                 lista colecțiilor proprii
//   GET    /api/vendor/collections/:id             elementele colecției (productId)
//   POST   /api/vendor/collections/attach-product  adaugă produsul (idempotent)
//   DELETE /api/vendor/collections/:id/products/:productId  scoate produsul
// O colecție a cărei citire eșuează devine „necunoscută”: nu se poate bifa/debifa și
// nimic nu se elimină din ea. Colecțiile „toate produsele mele” nu se ating.

import { ATTACH_ENDPOINT, COLLECTIONS_ENDPOINT, mapCollections } from "./smartListingCollections.js";
import { planCollectionChanges } from "./smartListingEdit.js";

const collectionUrl = (id) => `${COLLECTIONS_ENDPOINT}/${encodeURIComponent(id)}`;

/** @returns {Promise<{ memberIds: string[], knownIds: string[], unknownIds: string[], error: string }>} */
export async function loadProductCollectionMembership({ api, productId, concurrency = 4 }) {
  let list;
  try {
    list = mapCollections(await api(COLLECTIONS_ENDPOINT));
  } catch {
    return { memberIds: [], knownIds: [], unknownIds: [], error: "Nu am putut încărca colecțiile. Asocierile existente rămân neschimbate." };
  }
  const manual = list.filter((collection) => !collection.auto);
  const memberIds = [];
  const knownIds = [];
  const unknownIds = [];
  let index = 0;
  const worker = async () => {
    while (index < manual.length) {
      const collection = manual[index++];
      try {
        const data = await api(collectionUrl(collection.id));
        const items = Array.isArray(data?.collection?.items) ? data.collection.items : Array.isArray(data?.items) ? data.items : null;
        if (!items) throw new Error("format");
        knownIds.push(collection.id);
        if (items.some((item) => String(item?.productId ?? item?.id) === String(productId))) memberIds.push(collection.id);
      } catch {
        unknownIds.push(collection.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, manual.length) }, worker));
  return {
    memberIds,
    knownIds,
    unknownIds,
    error: unknownIds.length ? "Unele colecții nu s-au putut verifica; rămân neschimbate." : "",
  };
}

/**
 * Aplică schimbările. Un eșec aici nu anulează produsul salvat.
 * @returns {Promise<{ attached: string[], detached: string[], failed: string[] }>}
 */
export async function applyProductCollectionChanges({ api, productId, initialIds, selectedIds, knownIds }) {
  const plan = planCollectionChanges({ initialIds, selectedIds, knownIds });
  const out = { attached: [], detached: [], failed: [] };
  if (plan.attach.length) {
    try {
      const result = await api(ATTACH_ENDPOINT, { method: "POST", body: { productId, collectionIds: plan.attach } });
      out.attached = [...(result?.added || []), ...(result?.already || [])];
      out.failed.push(...plan.attach.filter((id) => !out.attached.includes(id)));
    } catch {
      out.failed.push(...plan.attach);
    }
  }
  for (const id of plan.detach) {
    try {
      await api(`${collectionUrl(id)}/products/${encodeURIComponent(productId)}`, { method: "DELETE" });
      out.detached.push(id);
    } catch {
      out.failed.push(id);
    }
  }
  return out;
}
