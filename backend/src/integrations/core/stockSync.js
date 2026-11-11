// backend/src/integrations/core/stockSync.js
//
// Sincronizarea stocului între Artfest și magazinul extern, pe unități de
// stoc (ExternalVariantLink):
//   - legătura produsului ("" ) -> Product.readyQty (stoc pe produs) sau
//     Product.variantPoolQty (stocul comun al variantelor „parent”);
//   - legătura unei variații cu stoc propriu -> ProductVariant.stockQty;
//   - variațiile „parent” nu au stoc propriu (se sincronizează prin părinte);
//   - variațiile neurmărite: doar epuizat / disponibil.
//
// Sursa principală (ExternalStoreConnection.stockMaster):
//   EXTERNAL (implicit) - magazinul extern dă stocul; vânzările Artfest
//     încă netrimise (pendingOutboundDelta, negativ) se scad din valoarea
//     primită, ca o citire din magazin să nu „readucă” bucăți deja vândute;
//   ARTFEST - Artfest dă stocul; valorile externe doar se înregistrează.
//
// Protecții:
//   - supravânzare: Artfest scade atomic la comandă (inventoryService);
//     aici stocul se scrie compare-and-set (valoarea citită trebuie să fie
//     încă valoarea curentă), cu reîncercare - o comandă Artfest simultană
//     nu e suprascrisă; rezerva de siguranță (safetyBufferQty) se scade
//     din stocul extern;
//   - sincronizare circulară: mișcările EXTERNAL_SYNC nu se trimit NICIODATĂ
//     înapoi în magazin; o valoare primită egală cu ultima trimisă de noi
//     (ecou), fără vânzări netrimise, nu se rescrie;
//   - idempotență: fiecare aplicare are cheia sursei (livrarea webhook-ului
//     / rularea reconcilierii) - aceeași sursă nu se aplică de două ori;
//   - Târgul: produsele cu inventar activ la Târg nu se sincronizează (stocul
//     lor online e gestionat de Târg).
// Limitările WooCommerce la scriere: adapters/woocommerce/adapter.js.

import { getFairProductLocks, lockProductForFair } from "../../services/fairProductLock.js";
import { syncVariantAggregate } from "../../services/inventory/inventoryService.js";
import { IntegrationError } from "./errors.js";
import { enqueueJob } from "./syncQueue.js";

const CAS_ATTEMPTS = 3;

export const LINK_INCLUDE = {
  productLink: {
    include: {
      product: { select: { id: true, stockScope: true, availability: true, readyQty: true, variantPoolQty: true } },
      connection: true,
    },
  },
  variant: { select: { id: true, productId: true, stockMode: true, stockQty: true, availability: true, isActive: true } },
};

/** Unde se scrie în Artfest stocul acestei unități externe. */
export function artfestTargetFor(link) {
  const product = link.productLink.product;
  if (link.externalVariantId === "") {
    return product.stockScope === "VARIANT" ? { target: "VARIANT_POOL" } : { target: "PRODUCT" };
  }
  if (link.stockManagedAt === "PARENT") return { target: null, reason: "uses_parent_stock" };
  if (!link.variant || !link.variant.isActive) return { target: null, reason: "variant_not_linked" };
  if (link.stockManagedAt === "NONE") return { target: "VARIANT_STATUS" };
  return { target: "VARIANT" };
}

async function readCurrent(tx, link, target) {
  if (target === "PRODUCT") {
    const p = await tx.product.findUnique({ where: { id: link.productLink.productId }, select: { readyQty: true, availability: true } });
    return { qty: p.readyQty, availability: p.availability };
  }
  if (target === "VARIANT_POOL") {
    const p = await tx.product.findUnique({ where: { id: link.productLink.productId }, select: { variantPoolQty: true } });
    return { qty: p.variantPoolQty };
  }
  const v = await tx.productVariant.findUnique({ where: { id: link.variantId }, select: { stockQty: true, stockMode: true, availability: true } });
  return { qty: v.stockQty, stockMode: v.stockMode, availability: v.availability };
}

// compare-and-set: scrie doar dacă valoarea e încă cea citită
async function writeIfUnchanged(tx, link, target, current, next) {
  const productId = link.productLink.productId;
  if (target === "PRODUCT") {
    const stockBased = current.availability === "READY" || current.availability === "SOLD_OUT";
    const res = await tx.product.updateMany({
      where: { id: productId, stockScope: "PRODUCT", readyQty: current.qty },
      data: { readyQty: next, ...(stockBased ? { availability: next > 0 ? "READY" : "SOLD_OUT" } : {}) },
    });
    return res.count === 1;
  }
  if (target === "VARIANT_POOL") {
    const res = await tx.product.updateMany({
      where: { id: productId, stockScope: "VARIANT", variantPoolQty: current.qty },
      data: { variantPoolQty: next },
    });
    return res.count === 1;
  }
  const res = await tx.productVariant.updateMany({
    where: { id: link.variantId, stockMode: "OWN", stockQty: current.qty },
    data: { stockQty: next },
  });
  return res.count === 1;
}

const MOVEMENT_TARGET = { PRODUCT: "PRODUCT", VARIANT: "VARIANT", VARIANT_POOL: "VARIANT_POOL" };

/**
 * Aplică în Artfest stocul citit din magazinul extern pentru o unitate.
 * @param {Object} options.link       ExternalVariantLink cu LINK_INCLUDE
 * @param {Object} options.external   ExternalStock (core/normalize.js)
 * @param {string} options.sourceKey  livrarea webhook-ului / rularea reconcilierii
 * @returns {{ applied: boolean, reason?: string, before?: number, after?: number }}
 */
export async function applyExternalStock({ db, link, external, sourceKey, now = new Date() }) {
  const connection = link.productLink.connection;
  const product = link.productLink.product;
  const seen = {
    lastExternalStock: external.managed ? external.quantity : null,
    lastExternalStockStatus: external.status,
    lastExternalSeenAt: now,
  };
  const remember = () => db.externalVariantLink.update({ where: { id: link.id }, data: seen });

  if (link.productLink.status !== "ACTIVE") return { applied: false, reason: "link_inactive" };
  if (connection.stockMaster !== "EXTERNAL" || !connection.syncStock) {
    await remember();
    return { applied: false, reason: "artfest_is_stock_master" };
  }

  const { target, reason } = artfestTargetFor(link);
  if (!target) {
    await remember();
    return { applied: false, reason };
  }

  if ((await getFairProductLocks([product.id], { db })).size) {
    await remember();
    return { applied: false, reason: "fair_inventory" };
  }

  /* --- variații neurmărite: doar epuizat / disponibil --- */
  if (target === "VARIANT_STATUS") {
    const availability = external.status === "outofstock" ? "SOLD_OUT" : external.status === "instock" ? null : undefined;
    if (availability === undefined) {
      await remember();
      return { applied: false, reason: "backorder_needs_vendor" };
    }
    await db.$transaction(async (tx) => {
      await tx.productVariant.updateMany({ where: { id: link.variantId, stockMode: "UNTRACKED" }, data: { availability } });
      await syncVariantAggregate(tx, product.id);
      await tx.externalVariantLink.update({ where: { id: link.id }, data: seen });
    });
    return { applied: true, reason: "status_only" };
  }

  if (!external.managed) {
    await remember();
    return { applied: false, reason: "external_stock_not_managed" };
  }
  if (target === "PRODUCT" && !["READY", "SOLD_OUT"].includes(product.availability)) {
    // la comandă / precomandă: alegerea vânzătorului, nu stocul magazinului
    await remember();
    return { applied: false, reason: "not_stock_based" };
  }

  // ecou: valoarea e chiar cea trimisă de noi și nu există vânzări netrimise
  if (link.lastPushedStock !== null && external.quantity === link.lastPushedStock && link.pendingOutboundDelta === 0) {
    await remember();
    return { applied: false, reason: "echo" };
  }

  const idempotencyKey = `ext:${connection.id}:${link.id}:${sourceKey}`.slice(0, 191);

  for (let attempt = 1; attempt <= CAS_ATTEMPTS; attempt += 1) {
    const result = await db.$transaction(async (tx) => {
      if (await tx.inventoryMovement.findUnique({ where: { idempotencyKey }, select: { id: true } })) {
        return { applied: false, reason: "already_applied" };
      }
      // aceeași serializare ca operațiile Târgului pe produs
      await lockProductForFair(tx, product.id);

      const fresh = await tx.externalVariantLink.findUnique({ where: { id: link.id }, select: { pendingOutboundDelta: true } });
      const current = await readCurrent(tx, link, target);
      if (current.qty === null || current.qty === undefined) {
        return { applied: false, reason: "artfest_stock_not_tracked" };
      }

      const next = Math.max(0, external.quantity + fresh.pendingOutboundDelta - connection.safetyBufferQty);
      if (next !== current.qty) {
        if (!(await writeIfUnchanged(tx, link, target, current, next))) return { retry: true };
        await tx.inventoryMovement.create({
          data: {
            productId: product.id,
            variantId: target === "PRODUCT" ? null : link.variantId || (await poolVariantId(tx, product.id)),
            target: MOVEMENT_TARGET[target],
            delta: next - current.qty,
            qtyBefore: current.qty,
            qtyAfter: next,
            reason: "EXTERNAL_SYNC",
            idempotencyKey,
            connectionId: connection.id,
            note: `stoc extern ${external.quantity}${fresh.pendingOutboundDelta ? `, vânzări netrimise ${fresh.pendingOutboundDelta}` : ""}${connection.safetyBufferQty ? `, rezervă ${connection.safetyBufferQty}` : ""}`,
          },
        });
        if (target !== "PRODUCT") await syncVariantAggregate(tx, product.id);
      }
      await tx.externalVariantLink.update({ where: { id: link.id }, data: seen });
      return { applied: next !== current.qty, before: current.qty, after: next, reason: next === current.qty ? "unchanged" : undefined };
    });
    if (!result.retry) return result;
  }

  throw new IntegrationError("stock_changed_concurrently", "Stocul s-a modificat în timpul sincronizării; se reîncearcă.", { retryable: true });
}

async function poolVariantId(tx, productId) {
  const v = await tx.productVariant.findFirst({ where: { productId, stockMode: "PRODUCT_POOL" }, select: { id: true } });
  return v?.id || null;
}

/* ===================== Artfest -> magazinul extern ===================== */

/**
 * Mișcări de stoc Artfest (comenzi, anulări) pe produse legate: se adună
 * în pendingOutboundDelta și se pune în coadă trimiterea către magazin.
 * Mișcările EXTERNAL_SYNC / IMPORT nu se trimit (fără bucle).
 * Se apelează în tranzacția care a scris mișcările.
 */
export async function recordArtfestStockChanges(tx, movements) {
  const relevant = (movements || []).filter((m) => m?.delta && !["EXTERNAL_SYNC", "IMPORT", "RECONCILE"].includes(m.reason));
  if (!relevant.length) return 0;

  const links = await tx.externalProductLink.findMany({
    where: { productId: { in: [...new Set(relevant.map((m) => m.productId))] }, status: "ACTIVE", connection: { status: { not: "DISCONNECTED" }, syncStock: true } },
    include: { variantLinks: true },
  });
  let queued = 0;

  for (const m of relevant) {
    const link = links.find((l) => l.productId === m.productId);
    if (!link) continue;
    const unit =
      m.target === "VARIANT"
        ? link.variantLinks.find((v) => v.variantId === m.variantId && v.stockManagedAt === "VARIANT")
        : link.variantLinks.find((v) => v.externalVariantId === "");
    if (!unit) continue;

    await tx.externalVariantLink.update({ where: { id: unit.id }, data: { pendingOutboundDelta: { increment: m.delta } } });
    const { deduped } = await enqueueJob(tx, {
      connectionId: link.connectionId,
      type: "PUSH_STOCK",
      payload: { variantLinkId: unit.id },
      dedupeKey: `push:${unit.id}`,
      priority: 10,
    });
    if (!deduped) queued += 1;
  }
  return queued;
}

const MAX_PUSH_ROUNDS = 5;

/**
 * Trimite în magazin vânzările Artfest netrimise ale unei unități
 * (EXTERNAL) sau stocul Artfest (ARTFEST). Relativ la stocul citit chiar
 * înainte de scriere; pendingOutboundDelta scade exact cu cât s-a trimis
 * (vânzările apărute între timp rămân pentru runda următoare).
 */
export async function pushStock({ db, adapter, variantLinkId, now = new Date() }) {
  const link = await db.externalVariantLink.findUnique({ where: { id: variantLinkId }, include: LINK_INCLUDE });
  if (!link || link.productLink.status !== "ACTIVE") return { pushed: false, reason: "link_inactive" };
  const connection = link.productLink.connection;
  const ref = { externalProductId: link.productLink.externalProductId, externalVariantId: link.externalVariantId || null };

  if (connection.stockMaster === "ARTFEST") {
    const { target } = artfestTargetFor(link);
    if (!target || target === "VARIANT_STATUS") return { pushed: false, reason: "no_artfest_stock" };
    const current = await readCurrent(db, link, target);
    if (current.qty === null || current.qty === undefined) return { pushed: false, reason: "artfest_stock_not_tracked" };
    const after = await adapter.setStock(ref, current.qty);
    await db.externalVariantLink.update({
      where: { id: link.id },
      data: { pendingOutboundDelta: 0, lastPushedStock: after.quantity, lastPushedAt: now, lastExternalStock: after.quantity, lastExternalSeenAt: now },
    });
    return { pushed: true, quantity: after.quantity };
  }

  let rounds = 0;
  let last = null;
  for (; rounds < MAX_PUSH_ROUNDS; rounds += 1) {
    const { pendingOutboundDelta: pending } = await db.externalVariantLink.findUnique({ where: { id: link.id }, select: { pendingOutboundDelta: true } });
    if (!pending) break;

    const current = await adapter.getStock(ref);
    if (!current.managed) {
      await db.externalVariantLink.update({ where: { id: link.id }, data: { pendingOutboundDelta: { decrement: pending } } });
      return { pushed: false, reason: "external_stock_not_managed", dropped: pending };
    }

    const wanted = current.quantity + pending;
    const next = Math.max(0, wanted);
    const after = await adapter.setStock(ref, next);
    last = { before: current.quantity, after: after.quantity, oversold: wanted < 0 ? -wanted : 0 };

    await db.externalVariantLink.updateMany({
      where: { id: link.id },
      data: {
        pendingOutboundDelta: { decrement: pending },
        lastPushedStock: after.quantity,
        lastPushedAt: now,
        lastExternalStock: after.quantity,
        lastExternalStockStatus: after.status,
        lastExternalSeenAt: now,
      },
    });
  }

  return { pushed: Boolean(last), rounds, ...last };
}
