// src/services/stockRestore.js
//
// Restaurarea stocului la anulare (vendor / admin / client) - aceleași
// exporturi ca înainte, implementate în services/inventory/inventoryService.js
// (sursa unică pentru stocul comenzilor: rezervare, istoric, restaurare).
//
// restoreStockFromItems: liniile cu istoric ORDER_PLACED se restaurează
// exact și o singură dată; comenzile de dinainte de istoric urmează regula
// veche (restoreProductStock), neschimbată.

import {
  aggregateQtyByProductId,
  restoreOrderItemsStock,
  restoreProductStock,
} from "./inventory/inventoryService.js";

export { aggregateQtyByProductId, restoreProductStock };

/**
 * Restaurează stocul pentru liniile anulate.
 * @param items [{ id?, shipmentId?, productId, qty, variantIdSnapshot? }]
 */
export async function restoreStockFromItems(tx, items, options) {
  return restoreOrderItemsStock(tx, items, options);
}
