// backend/src/services/fairProductLock.js
//
// Blocările pe produs impuse de inventarul Târgului Artfest. Helper central,
// apelat din TOATE locurile care pot modifica priceCents / availability /
// readyQty sau pot șterge un produs (editorii vendorului, catalog în masă,
// prețul recomandat din Costuri & profit, Admin). Asistentul AI scrie prin
// editorul vendorului, iar importul doar creează produse noi.
//
// Reguli:
//   - preț: blocat pentru produsele cu linii SUBMITTED/RECEIVED, după
//     ArtfestFair.inventoryDeadlineAt și până la endsAt (fără endsAt: cât
//     linia rămâne activă);
//   - FORCED_UNAVAILABLE (unicat la târg): availability / readyQty nu se pot
//     schimba până la restaurarea stării anterioare;
//   - ștergere: blocată cât produsul are linii SUBMITTED/RECEIVED.
//
// Concurența: scrierile verificate și trimiterea inventarului iau același
// pg_advisory_xact_lock pe produs (withProductFairLock), deci o editare nu
// poate suprascrie rezervarea făcută între verificare și scriere.

import { prisma } from "../db.js";
import { ACTIVE_INVENTORY_STATUSES } from "../config/artfestFair.js";

export class ProductFairLockError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.status = 409;
    this.code = code;
    Object.assign(this, extra);
  }
}

export const FAIR_LOCK_MESSAGES = Object.freeze({
  price:
    "Prețul acestui produs este blocat până la finalul Târgului Artfest, pentru că produsul este în inventarul târgului.",
  availability:
    "Produsul este rezervat pentru Târgul Artfest și nu poate fi făcut disponibil online momentan.",
  delete:
    "Produsul este în inventarul Târgului Artfest și nu poate fi șters până la încheierea târgului.",
});

export function isFairLockError(error) {
  return error instanceof ProductFairLockError;
}

// pentru rutele existente: 409 cu mesaj clar, în loc de 500
export function sendFairLockError(res, error) {
  if (!isFairLockError(error)) return false;
  res.status(409).json({
    error: error.code,
    message: error.message,
    productIds: error.productIds || [],
  });
  return true;
}

export async function lockProductForFair(tx, productId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`artfest-fair-product:${productId}`}))`;
}

/*
 * Rulează fn(tx) într-o tranzacție, după ce a luat lock-ul pe fiecare
 * produs (ordine sortată => fără deadlock între două operații).
 */
export async function withProductFairLock(productIds, fn, { db = prisma } = {}) {
  const ids = [...new Set((productIds || []).filter(Boolean).map(String))].sort();
  return db.$transaction(async (tx) => {
    for (const id of ids) await lockProductForFair(tx, id);
    return fn(tx);
  });
}

function isPriceLockWindow(fair, now) {
  if (!fair?.inventoryDeadlineAt) return false;
  if (now < new Date(fair.inventoryDeadlineAt)) return false;
  return !fair.endsAt || now <= new Date(fair.endsAt);
}

/*
 * Map productId -> { priceLocked, forcedUnavailable, deleteLocked, reservedForFairQty }
 */
export async function getFairProductLocks(productIds, { db = prisma, now = new Date() } = {}) {
  const ids = [...new Set((productIds || []).filter(Boolean).map(String))];
  const locks = new Map();
  if (!ids.length) return locks;

  const lines = await db.artfestFairInventoryItem.findMany({
    where: { productId: { in: ids }, status: { in: [...ACTIVE_INVENTORY_STATUSES] } },
    select: {
      productId: true,
      fairId: true,
      onlineReservationMode: true,
      onlineReservedQty: true,
      onlineReleasedQty: true,
      onlineReleasedAt: true,
      onlineRestoredAt: true,
    },
  });
  if (!lines.length) return locks;

  const fairIds = [...new Set(lines.map((l) => l.fairId))];
  const fairs = await db.artfestFair.findMany({
    where: { id: { in: fairIds } },
    select: { id: true, inventoryDeadlineAt: true, endsAt: true },
  });
  const fairById = new Map(fairs.map((f) => [f.id, f]));

  for (const line of lines) {
    const entry = locks.get(line.productId) || {
      priceLocked: false,
      forcedUnavailable: false,
      deleteLocked: true,
      reservedForFairQty: 0,
    };

    if (isPriceLockWindow(fairById.get(line.fairId), now)) entry.priceLocked = true;

    const open = !line.onlineRestoredAt && !line.onlineReleasedAt;
    if (open && line.onlineReservationMode === "FORCED_UNAVAILABLE") entry.forcedUnavailable = true;
    if (open && line.onlineReservationMode === "TRANSFERRED") {
      entry.reservedForFairQty += Math.max(0, (line.onlineReservedQty || 0) - (line.onlineReleasedQty || 0));
    }

    locks.set(line.productId, entry);
  }

  return locks;
}

function changed(next, current) {
  if (next === undefined) return false;
  if (next === null || current === null || current === undefined) return next !== current;
  return String(next) !== String(current);
}

/*
 * Verifică o modificare pe unul sau mai multe produse. `patch` conține doar
 * câmpurile care se scriu (priceCents / availability / readyQty); o valoare
 * identică cu cea curentă nu e considerată modificare (formularele retrimit
 * tot). action: "update" | "delete".
 */
export async function assertProductsNotLockedByFair({
  productIds,
  patch = {},
  action = "update",
  db = prisma,
  now = new Date(),
}) {
  const ids = [...new Set((productIds || []).filter(Boolean).map(String))];
  if (!ids.length) return;

  const locks = await getFairProductLocks(ids, { db, now });
  if (!locks.size) return;

  if (action === "delete") {
    const blocked = ids.filter((id) => locks.get(id)?.deleteLocked);
    if (blocked.length) {
      throw new ProductFairLockError("product_locked_by_fair", FAIR_LOCK_MESSAGES.delete, { productIds: blocked });
    }
    return;
  }

  const touchesPrice = patch.priceCents !== undefined;
  const touchesStock = patch.availability !== undefined || patch.readyQty !== undefined;
  if (!touchesPrice && !touchesStock) return;

  const current = await db.product.findMany({
    where: { id: { in: [...locks.keys()] } },
    select: { id: true, priceCents: true, availability: true, readyQty: true },
  });
  const currentById = new Map(current.map((p) => [p.id, p]));

  const priceBlocked = [];
  const stockBlocked = [];

  for (const [productId, lock] of locks) {
    const product = currentById.get(productId);
    if (!product) continue;

    if (lock.priceLocked && changed(patch.priceCents, product.priceCents)) priceBlocked.push(productId);

    if (
      lock.forcedUnavailable &&
      (changed(patch.availability, product.availability) || changed(patch.readyQty, product.readyQty))
    ) {
      stockBlocked.push(productId);
    }
  }

  if (priceBlocked.length) {
    throw new ProductFairLockError("product_price_locked_by_fair", FAIR_LOCK_MESSAGES.price, {
      productIds: priceBlocked,
    });
  }

  if (stockBlocked.length) {
    throw new ProductFairLockError("product_reserved_for_fair", FAIR_LOCK_MESSAGES.availability, {
      productIds: stockBlocked,
    });
  }
}

export function assertProductNotLockedByFair(productId, patch = {}, options = {}) {
  return assertProductsNotLockedByFair({ ...options, productIds: [productId], patch });
}

const LOCKED_FIELDS = ["priceCents", "availability", "readyQty"];

// doar câmpurile relevante pentru târg din datele unei scrieri
export function fairLockedFields(data = {}) {
  const out = {};
  for (const key of LOCKED_FIELDS) if (data && data[key] !== undefined) out[key] = data[key];
  return out;
}

/*
 * Scriere pe produs(e) verificată pentru târg. Dacă datele nu ating preț /
 * disponibilitate / stoc, scrierea rulează direct (fără tranzacție nouă);
 * altfel: tranzacție + lock pe produs + verificare + scriere.
 *   const updated = await guardedProductUpdate(id, data, (db) => db.product.update(...));
 */
export async function guardedProductUpdate(productIds, data, write, { db = prisma } = {}) {
  const ids = Array.isArray(productIds) ? productIds : [productIds];
  const patch = fairLockedFields(data);
  if (!Object.keys(patch).length) return write(db);

  return withProductFairLock(
    ids,
    async (tx) => {
      await assertProductsNotLockedByFair({ productIds: ids, patch, db: tx });
      return write(tx);
    },
    { db }
  );
}

// ștergere de produs(e) verificată pentru târg
export async function guardedProductDelete(productIds, remove, { db = prisma } = {}) {
  const ids = Array.isArray(productIds) ? productIds : [productIds];
  return withProductFairLock(
    ids,
    async (tx) => {
      await assertProductsNotLockedByFair({ productIds: ids, action: "delete", db: tx });
      return remove(tx);
    },
    { db }
  );
}

/*
 * Pentru UI-ul vendorului: rezervarea de târg a fiecărui produs.
 */
export async function getFairReservationsForProducts(productIds, { db = prisma } = {}) {
  const locks = await getFairProductLocks(productIds, { db });
  const out = {};
  for (const [productId, lock] of locks) {
    out[productId] = {
      reservedForFairQty: lock.reservedForFairQty,
      forcedUnavailable: lock.forcedUnavailable,
      priceLocked: lock.priceLocked,
    };
  }
  return out;
}
