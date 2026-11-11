// src/services/inventory/inventoryService.js
//
// Sursa UNICĂ pentru stocul online al comenzilor: rezervarea la plasare
// (COD și CARD, comenzi cu cont și guest), istoricul InventoryMovement și
// restaurarea la anulare (vendor / admin / client). Totul rulează în
// tranzacția `tx` a apelantului.
//
// Unde stă stocul (Product.stockScope):
//   PRODUCT - Product.readyQty (null = neurmărit), ca până acum;
//   VARIANT - pe ProductVariant, după opțiunile de stoc alese
//             (lib/stockVariants.js):
//               OWN          -> ProductVariant.stockQty
//               PRODUCT_POOL -> Product.variantPoolQty (stoc comun)
//               UNTRACKED    -> fără stoc numeric
//             Product.readyQty / availability devin totalul calculat
//             (syncVariantAggregate), pentru listări, coș și feed-uri.
//
// Scăderile sunt atomice și condiționate (updateMany cu `gte`): două
// comenzi simultane nu pot vinde aceeași ultimă bucată.
//
// Istoric: la plasare, o mișcare ORDER_PLACED pe fiecare ShipmentItem
// scăzut din stoc (cheie „order-item:<id>:placed”). La anulare se
// restaurează EXACT ce s-a scăzut, o singură dată (cheie
// „order-item:<id>:restored”, inserată cu ON CONFLICT DO NOTHING înainte
// de modificarea stocului).
//
// Comenzile de dinainte de istoric (fără nicio mișcare ORDER_PLACED pe
// comandă) folosesc regula veche, neschimbată (restoreProductStock).
//
// Nu atinge prețuri, comisioane, plăți sau facturare.

import { stockVariantSelection } from "../../lib/stockVariants.js";

const PRODUCT_STOCK_SELECT = {
  id: true,
  title: true,
  availability: true,
  readyQty: true,
  isActive: true,
  isHidden: true,
  moderationStatus: true,
  stockScope: true,
  variantPoolQty: true,
  optionsSchema: true,
  repeatedGroups: true,
};

const VARIANT_STOCK_SELECT = {
  id: true,
  combinationKey: true,
  stockMode: true,
  stockQty: true,
  availability: true,
  isActive: true,
};

const PURCHASABLE_PRODUCT = {
  isActive: true,
  isHidden: false,
  moderationStatus: "APPROVED",
};

const placedKey = (shipmentItemId) => `order-item:${shipmentItemId}:placed`;
const restoredKey = (shipmentItemId) => `order-item:${shipmentItemId}:restored`;

function positiveQty(value) {
  const qty = Number(value || 0);
  return Number.isInteger(qty) && qty > 0 ? qty : 0;
}

/* ===================== variante ===================== */

/**
 * Disponibilitatea efectivă a unei variante: a ei, dacă e setată; altfel
 * MADE_TO_ORDER / PREORDER moștenite de la produs; altfel READY (stocul
 * decide). SOLD_OUT-ul produsului e doar totalul calculat, nu se moștenește.
 */
export function effectiveVariantAvailability(product, variant) {
  if (variant?.availability) return variant.availability;
  if (product?.availability === "MADE_TO_ORDER" || product?.availability === "PREORDER") {
    return product.availability;
  }
  return "READY";
}

/**
 * Varianta activă aleasă de client (null dacă alegerea nu corespunde
 * unei variante active a produsului).
 */
export function findVariantForSelection(product, variants, selectedOptions) {
  const selection = stockVariantSelection(product, selectedOptions);
  if (!selection) return null;
  return (variants || []).find((v) => v.isActive && v.combinationKey === selection.combinationKey) || null;
}

/**
 * Recalculează Product.readyQty / availability din variante (doar pentru
 * stockScope = VARIANT). MADE_TO_ORDER / PREORDER pe produs rămân neatinse.
 */
export async function syncVariantAggregate(tx, productId) {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, stockScope: true, availability: true, variantPoolQty: true },
  });
  if (!product || product.stockScope !== "VARIANT") return null;

  const variants = await tx.productVariant.findMany({
    where: { productId, isActive: true },
    select: VARIANT_STOCK_SELECT,
  });

  let total = 0;
  let usesPool = false;
  let untrackedSellable = false;

  for (const v of variants) {
    const availability = effectiveVariantAvailability(product, v);
    if (availability === "SOLD_OUT") continue;
    if (v.stockMode === "OWN") total += Math.max(0, v.stockQty || 0);
    else if (v.stockMode === "PRODUCT_POOL") usesPool = true;
    else untrackedSellable = true;
  }
  if (usesPool) total += Math.max(0, product.variantPoolQty || 0);

  const readyQty = untrackedSellable ? null : total;
  const data = { readyQty };
  if (product.availability === "READY" || product.availability === "SOLD_OUT") {
    data.availability = untrackedSellable || total > 0 ? "READY" : "SOLD_OUT";
  }

  await tx.product.update({ where: { id: productId }, data });
  return { readyQty, availability: data.availability ?? product.availability };
}

/* ===================== rezervare la plasarea comenzii ===================== */

/**
 * Verifică și scade stocul pentru liniile comenzii, o dată pe produs /
 * variantă. Erorile sunt cele tratate deja de checkout: product_not_found,
 * product_unavailable, product_sold_out, insufficient_stock.
 *
 * @param lines [{ productId, qty, selectedOptions }]
 * @returns rezervarea, folosită apoi de variantIdFor / recordOrderMovements
 */
export async function reserveOrderStock(tx, lines) {
  const linesByProduct = new Map();
  for (const line of lines || []) {
    const qty = Number(line?.qty || 0);
    if (!line?.productId || !(qty > 0)) continue;
    if (!linesByProduct.has(line.productId)) linesByProduct.set(line.productId, []);
    linesByProduct.get(line.productId).push({ ...line, qty });
  }

  const reservation = {
    soldOutProductIds: [],
    // cheie țintă -> { target, productId, variantId, qty, before }
    entries: new Map(),
    // productId -> { product, variants } pentru produsele VARIANT
    variantProducts: new Map(),
  };

  for (const [productId, productLines] of linesByProduct) {
    const qty = productLines.reduce((sum, line) => sum + line.qty, 0);

    const product = await tx.product.findUnique({
      where: { id: productId },
      select: PRODUCT_STOCK_SELECT,
    });

    if (!product) throw new Error("product_not_found");

    if (product.isActive === false || product.isHidden === true || product.moderationStatus !== "APPROVED") {
      throw new Error("product_unavailable");
    }

    const availability = String(product.availability || "READY").toUpperCase();

    if (availability === "SOLD_OUT") {
      throw new Error("product_sold_out");
    }

    if (product.stockScope === "VARIANT") {
      await reserveVariantStock(tx, reservation, product, productLines);
      continue;
    }

    if (availability === "READY" && product.readyQty !== null) {
      const currentQty = Number(product.readyQty);

      if (!Number.isFinite(currentQty) || currentQty < qty) {
        throw new Error("insufficient_stock");
      }

      const nextQty = currentQty - qty;

      const updatedStock = await tx.product.updateMany({
        where: {
          id: productId,
          readyQty: { gte: qty },
          ...PURCHASABLE_PRODUCT,
          availability: "READY",
        },
        data: {
          readyQty: { decrement: qty },
          availability: nextQty <= 0 ? "SOLD_OUT" : "READY",
        },
      });

      if (updatedStock.count !== 1) {
        throw new Error("insufficient_stock");
      }

      reservation.entries.set(`p:${productId}`, { target: "PRODUCT", productId, variantId: null, qty, before: currentQty });

      if (nextQty <= 0) {
        reservation.soldOutProductIds.push(productId);
      }
    }
  }

  return reservation;
}

async function reserveVariantStock(tx, reservation, product, productLines) {
  const variants = await tx.productVariant.findMany({
    where: { productId: product.id },
    select: VARIANT_STOCK_SELECT,
  });
  reservation.variantProducts.set(product.id, { product, variants });

  const qtyByVariant = new Map();
  for (const line of productLines) {
    const variant = findVariantForSelection(product, variants, line.selectedOptions);
    // opțiunile de stoc lipsă sau o combinație inexistentă / dezactivată
    if (!variant) throw new Error("product_unavailable");
    qtyByVariant.set(variant.id, (qtyByVariant.get(variant.id) || 0) + line.qty);
  }

  let poolQty = 0;
  const poolVariants = [];

  for (const [variantId, qty] of qtyByVariant) {
    const variant = variants.find((v) => v.id === variantId);
    const availability = effectiveVariantAvailability(product, variant);

    if (availability === "SOLD_OUT") throw new Error("product_sold_out");
    if (availability !== "READY") continue; // MADE_TO_ORDER / PREORDER: fără scădere

    if (variant.stockMode === "OWN") {
      const currentQty = Number(variant.stockQty);
      if (!Number.isFinite(currentQty) || currentQty < qty) throw new Error("insufficient_stock");

      const updated = await tx.productVariant.updateMany({
        where: {
          id: variantId,
          isActive: true,
          stockMode: "OWN",
          stockQty: { gte: qty },
          product: { ...PURCHASABLE_PRODUCT, stockScope: "VARIANT" },
        },
        data: { stockQty: { decrement: qty } },
      });
      if (updated.count !== 1) throw new Error("insufficient_stock");

      reservation.entries.set(`v:${variantId}`, { target: "VARIANT", productId: product.id, variantId, qty, before: currentQty });
    } else if (variant.stockMode === "PRODUCT_POOL") {
      poolQty += qty;
      poolVariants.push(variantId);
    }
  }

  if (poolQty > 0) {
    const currentPool = Number(product.variantPoolQty);
    if (!Number.isFinite(currentPool) || currentPool < poolQty) throw new Error("insufficient_stock");

    const updated = await tx.product.updateMany({
      where: { id: product.id, ...PURCHASABLE_PRODUCT, stockScope: "VARIANT", variantPoolQty: { gte: poolQty } },
      data: { variantPoolQty: { decrement: poolQty } },
    });
    if (updated.count !== 1) throw new Error("insufficient_stock");

    reservation.entries.set(`pool:${product.id}`, {
      target: "VARIANT_POOL",
      productId: product.id,
      variantId: null,
      qty: poolQty,
      before: currentPool,
    });
  }

  if (!reservation.entries.size) return;

  const wasSellable = product.availability === "READY";
  const aggregate = await syncVariantAggregate(tx, product.id);
  if (wasSellable && aggregate?.availability === "SOLD_OUT") {
    reservation.soldOutProductIds.push(product.id);
  }
}

/**
 * Varianta de stoc a unei linii (pentru ShipmentItem.variantIdSnapshot);
 * null pentru produsele fără stoc pe variante.
 */
export function variantIdFor(reservation, productId, selectedOptions) {
  const entry = reservation?.variantProducts?.get(productId);
  if (!entry) return null;
  return findVariantForSelection(entry.product, entry.variants, selectedOptions)?.id || null;
}

function entryForItem(reservation, item) {
  const variantId = item.variantIdSnapshot || variantIdFor(reservation, item.productId, item.selectedOptions);
  if (variantId) {
    const own = reservation.entries.get(`v:${variantId}`);
    if (own) return { entry: own, variantId };
    const pool = reservation.entries.get(`pool:${item.productId}`);
    const entry = reservation.variantProducts.get(item.productId);
    const variant = entry?.variants.find((v) => v.id === variantId);
    if (pool && variant?.stockMode === "PRODUCT_POOL" && effectiveVariantAvailability(entry.product, variant) === "READY") {
      return { entry: pool, variantId };
    }
    return null;
  }
  const product = reservation.entries.get(`p:${item.productId}`);
  return product ? { entry: product, variantId: null } : null;
}

/** Comanda are linii scăzute din stoc pentru produsele acestor linii. */
export function reservationTouches(reservation, items) {
  return (items || []).some((item) => entryForItem(reservation, item));
}

/**
 * Scrie istoricul ORDER_PLACED pentru liniile create ale unei livrări
 * (după shipmentItem.createMany, în aceeași tranzacție).
 *
 * @param items ShipmentItem create: [{ id, productId, qty, selectedOptions, variantIdSnapshot? }]
 */
export async function recordOrderMovements(tx, { orderId, shipmentId, items, reservation }) {
  const data = [];

  for (const item of items || []) {
    const qty = positiveQty(item.qty);
    if (!item.id || !qty) continue;

    const match = entryForItem(reservation, item);
    if (!match) continue;

    const { entry, variantId } = match;
    entry.cursor = entry.cursor ?? entry.before;
    const qtyBefore = entry.cursor;
    const qtyAfter = qtyBefore - qty;
    entry.cursor = qtyAfter;

    data.push({
      productId: item.productId,
      variantId,
      target: entry.target,
      delta: -qty,
      qtyBefore,
      qtyAfter: qtyAfter >= 0 ? qtyAfter : null,
      reason: "ORDER_PLACED",
      idempotencyKey: placedKey(item.id),
      orderId,
      shipmentId,
      shipmentItemId: item.id,
    });
  }

  if (!data.length) return 0;
  const created = await tx.inventoryMovement.createMany({ data, skipDuplicates: true });
  return created.count;
}

/* ===================== restaurare la anulare ===================== */

/**
 * Agregă qty pe productId dintr-o listă de ShipmentItem (a unui
 * singur shipment, sau flatMap peste mai multe shipment-uri ale
 * aceleiași comenzi).
 */
export function aggregateQtyByProductId(items) {
  const qtyByProductId = new Map();

  for (const item of items || []) {
    if (!item.productId) {
      continue;
    }

    const qty = Number(item.qty || 0);

    if (!Number.isInteger(qty) || qty <= 0) {
      continue;
    }

    qtyByProductId.set(
      item.productId,
      (qtyByProductId.get(item.productId) || 0) + qty
    );
  }

  return qtyByProductId;
}

/**
 * Regula VECHE (comenzi fără istoric), neschimbată: fără snapshot de la
 * checkout, restaurarea se bazează pe STAREA CURENTĂ a produsului, cu o
 * regulă deliberat conservatoare - restaurăm DOAR dacă produsul e ÎN
 * CONTINUARE stock-tracked (readyQty !== null) și în starea în care
 * checkout-ul l-ar fi putut decrementa sau epuiza (READY sau SOLD_OUT).
 * Pentru MADE_TO_ORDER/PREORDER NU atingem nici readyQty, nici
 * availability. Produsele cu stoc pe variante nu sunt atinse (readyQty
 * lor e un total calculat).
 *
 * LIMITĂ (raportată explicit): dacă vendorul schimbă produsul READY ->
 * MADE_TO_ORDER/PREORDER ÎNTRE checkout și anulare, restaurarea NU se
 * mai face - preferăm să NU restaurăm decât să supraevaluăm stocul.
 */
export async function restoreProductStock(tx, qtyByProductId) {
  const fairHeld = await fairForcedUnavailableLines(tx, [...qtyByProductId.keys()]);

  for (const [productId, qty] of qtyByProductId) {
    if (await deferToFairLine(tx, fairHeld.get(productId), qty)) continue;
    await incrementTrackedProductStock(tx, productId, qty);
  }
}

// readyQty += qty doar pentru produsele încă urmărite pe stoc, în READY / SOLD_OUT
function incrementTrackedProductStock(tx, productId, qty) {
  return tx.product.updateMany({
    where: {
      id: productId,

      // doar produse ÎN CONTINUARE stock-tracked
      readyQty: { not: null },

      // doar stări în care checkout-ul le-ar fi putut decrementa
      // (READY) sau epuiza (SOLD_OUT) - NICIODATĂ MADE_TO_ORDER/
      // PREORDER
      availability: { in: ["READY", "SOLD_OUT"] },

      // la stocul pe variante readyQty e doar totalul calculat
      stockScope: { not: "VARIANT" },
    },

    data: {
      readyQty: { increment: qty },

      // qty > 0 mereu => readyQty rezultat > 0 => READY e corect atât
      // pentru „era deja READY” cât și pentru „era SOLD_OUT, acum are
      // stoc din nou”.
      availability: "READY",
    },
  });
}

/*
 * Târgul Artfest: un unicat aflat la târg (FORCED_UNAVAILABLE) NU
 * redevine cumpărabil online la anularea unei comenzi. Cantitatea se
 * amână pe linia de inventar (onlineDeferredRestoreQty) și se aplică abia
 * la restaurarea stării anterioare a produsului.
 */
async function deferToFairLine(tx, fairLine, qty) {
  if (!fairLine) return false;
  await tx.artfestFairInventoryItem.update({
    where: { id: fairLine.id },
    data: { onlineDeferredRestoreQty: { increment: qty } },
  });
  await tx.artfestFairInventoryEvent.create({
    data: {
      inventoryItemId: fairLine.id,
      fairId: fairLine.fairId,
      vendorId: fairLine.vendorId,
      type: "ONLINE_RESTORE_DEFERRED",
      after: { deferredQty: qty },
      note: "order_cancelled_while_reserved_for_fair",
    },
  });
  return true;
}

// productId -> linia de târg care ține produsul indisponibil online (unicat la târg)
async function fairForcedUnavailableLines(tx, productIds) {
  const held = new Map();
  if (!productIds.length) return held;

  const lines = await tx.artfestFairInventoryItem.findMany({
    where: {
      productId: { in: productIds },
      status: { in: ["SUBMITTED", "RECEIVED"] },
      onlineReservationMode: "FORCED_UNAVAILABLE",
      onlineReleasedAt: null,
      onlineRestoredAt: null,
    },
    select: { id: true, productId: true, fairId: true, vendorId: true },
    orderBy: { createdAt: "asc" },
  });

  for (const line of lines) if (!held.has(line.productId)) held.set(line.productId, line);
  return held;
}

/**
 * Restaurează stocul pentru liniile anulate (vendor / admin / client).
 *
 * Liniile cu istoric ORDER_PLACED: se restaurează exact ținta și cantitatea
 * scăzute, o singură dată. Liniile comenzilor fără istoric (sau primite
 * fără id): regula veche. Liniile unei comenzi cu istoric, dar fără
 * ORDER_PLACED propriu, nu au fost scăzute din stoc - nu se restaurează.
 *
 * @param items [{ id?, shipmentId?, productId, qty, variantIdSnapshot? }]
 * @returns Map productId -> qty (toate liniile primite, ca înainte)
 */
export async function restoreOrderItemsStock(tx, items, { reason = "ORDER_CANCELLED", actorUserId = null } = {}) {
  const valid = (items || []).filter((item) => item?.productId && positiveQty(item.qty));
  const withId = valid.filter((item) => item.id);

  const placed = withId.length
    ? await tx.inventoryMovement.findMany({
        where: { shipmentItemId: { in: withId.map((item) => item.id) }, reason: "ORDER_PLACED" },
        select: { shipmentItemId: true, productId: true, variantId: true, target: true, delta: true, orderId: true, shipmentId: true },
      })
    : [];
  const placedByItem = new Map(placed.map((m) => [m.shipmentItemId, m]));

  const ledgerPlaced = valid.filter((item) => item.id && placedByItem.has(item.id));
  const others = valid.filter((item) => !(item.id && placedByItem.has(item.id)));

  // o linie fără ORDER_PLACED dintr-o comandă CU istoric nu a fost scăzută din stoc
  const ledgerOrders = new Set(placed.map((m) => m.orderId).filter(Boolean));
  const orderIds = await orderIdsForItems(tx, others.filter((item) => item.id));
  const unknownOrders = [...new Set(orderIds.values())].filter((id) => !ledgerOrders.has(id));
  if (unknownOrders.length) {
    const found = await tx.inventoryMovement.findMany({
      where: { orderId: { in: unknownOrders }, reason: "ORDER_PLACED" },
      select: { orderId: true },
    });
    for (const m of found) ledgerOrders.add(m.orderId);
  }

  const legacyItems = others.filter((item) => !(item.id && ledgerOrders.has(orderIds.get(item.id))));
  if (legacyItems.length) await restoreProductStock(tx, aggregateQtyByProductId(legacyItems));

  if (ledgerPlaced.length) {
    const fairHeld = await fairForcedUnavailableLines(tx, [...new Set(ledgerPlaced.map((i) => i.productId))]);
    const touchedVariantProducts = new Set();

    for (const item of ledgerPlaced) {
      const placed = placedByItem.get(item.id);
      await restorePlacedMovement(tx, item, placed, { reason, actorUserId, fairHeld, touchedVariantProducts });
    }

    for (const productId of touchedVariantProducts) await syncVariantAggregate(tx, productId);
  }

  return aggregateQtyByProductId(valid);
}

async function orderIdsForItems(tx, items) {
  const result = new Map();
  const shipmentIds = [...new Set(items.map((i) => i.shipmentId).filter(Boolean))];
  if (!shipmentIds.length) return result;
  const shipments = await tx.shipment.findMany({ where: { id: { in: shipmentIds } }, select: { id: true, orderId: true } });
  const orderByShipment = new Map(shipments.map((s) => [s.id, s.orderId]));
  for (const item of items) if (orderByShipment.has(item.shipmentId)) result.set(item.id, orderByShipment.get(item.shipmentId));
  return result;
}

async function restorePlacedMovement(tx, item, placed, { reason, actorUserId, fairHeld, touchedVariantProducts }) {
  const qty = Math.abs(placed.delta);
  // varianta ștearsă între timp: nu mai avem unde restaura
  if (placed.target !== "PRODUCT" && !placed.variantId) return;

  const fairLine = placed.target === "PRODUCT" ? fairHeld.get(placed.productId) : null;

  // întâi mișcarea (unică): a doua anulare a aceleiași linii nu mai trece de aici
  const inserted = await tx.inventoryMovement.createMany({
    data: [
      {
        productId: placed.productId,
        variantId: placed.variantId,
        target: placed.target,
        delta: qty,
        reason,
        idempotencyKey: restoredKey(item.id),
        orderId: placed.orderId,
        shipmentId: placed.shipmentId,
        shipmentItemId: item.id,
        actorUserId,
        note: fairLine ? "deferred_to_fair_line" : null,
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count !== 1) return;

  if (fairLine) {
    await deferToFairLine(tx, fairLine, qty);
    return;
  }

  let updated;
  if (placed.target === "PRODUCT") {
    updated = await incrementTrackedProductStock(tx, placed.productId, qty);
  } else if (placed.target === "VARIANT") {
    updated = await tx.productVariant.updateMany({
      where: { id: placed.variantId, stockMode: "OWN", product: { stockScope: "VARIANT" } },
      data: { stockQty: { increment: qty } },
    });
  } else {
    updated = await tx.product.updateMany({
      where: { id: placed.productId, stockScope: "VARIANT", variantPoolQty: { not: null } },
      data: { variantPoolQty: { increment: qty } },
    });
  }

  if (updated.count !== 1) {
    // produsul / varianta nu mai e urmărit(ă) pe stoc: nimic restaurat, nimic în istoric
    await tx.inventoryMovement.delete({ where: { idempotencyKey: restoredKey(item.id) } });
    return;
  }

  if (placed.target !== "PRODUCT") touchedVariantProducts.add(placed.productId);
}

/* ===================== coș ===================== */

function cartTargetFor(product, variant) {
  const availability = effectiveVariantAvailability(product, variant);
  if (availability === "SOLD_OUT") return { soldOut: true };
  if (availability !== "READY" || variant.stockMode === "UNTRACKED") return { key: null, limit: null };
  if (variant.stockMode === "OWN") return { key: `v:${variant.id}`, limit: Math.max(0, variant.stockQty || 0) };
  return { key: `pool:${product.id}`, limit: Math.max(0, product.variantPoolQty || 0) };
}

/**
 * Limita de stoc în coș pentru o linie a unui produs cu stoc pe variante
 * (aceeași regulă ca rezervarea de la checkout, care rămâne verificarea
 * finală, atomică).
 *
 * @param product    { id, availability, stockScope, variantPoolQty, optionsSchema, repeatedGroups }
 * @param otherLines celelalte linii din coș ale aceluiași produs: [{ selectedOptions, qty }]
 * @returns { ok: false, error } | { ok: true, limit: number|null, otherQty: number }
 *   limit = bucăți disponibile pentru stocul variantei (null = fără limită);
 *   otherQty = cât ocupă deja celelalte linii din același stoc
 */
export async function variantCartAllowance(db, product, selectedOptions, otherLines = []) {
  const variants = await db.productVariant.findMany({
    where: { productId: product.id },
    select: VARIANT_STOCK_SELECT,
  });

  const variant = findVariantForSelection(product, variants, selectedOptions);
  if (!variant) return { ok: false, error: "product_unavailable" };

  const target = cartTargetFor(product, variant);
  if (target.soldOut) return { ok: false, error: "product_sold_out" };
  if (target.key === null) return { ok: true, limit: null, otherQty: 0 };

  let otherQty = 0;
  for (const line of otherLines) {
    const other = findVariantForSelection(product, variants, line.selectedOptions);
    if (other && cartTargetFor(product, other).key === target.key) otherQty += positiveQty(line.qty);
  }

  return { ok: true, limit: target.limit, otherQty };
}
