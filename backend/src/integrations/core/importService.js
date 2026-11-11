// backend/src/integrations/core/importService.js
//
// Crearea produselor Artfest din planuri de import CONFIRMATE
// (importPlanner.applyConfirmations).
//
//   - fără importuri duplicate: un produs extern se leagă o singură dată pe
//     conexiune (ExternalProductLink unic pe connectionId + externalProductId);
//     reîncercarea aceluiași import întoarce „duplicate”, nu un produs nou;
//   - imaginile se copiază întâi în R2 (imageCopier) - produsul folosește
//     doar URL-urile R2;
//   - produsul, variantele, legăturile și istoricul stocului inițial
//     (InventoryMovement IMPORT) se creează într-o singură tranzacție;
//   - moderarea Artfest NU e ocolită: produsul intră PENDING, iar după
//     creare rulează aceeași moderare ca la produsele create în editor.

import { syncVariantAggregate } from "../../services/inventory/inventoryService.js";
import { IntegrationError } from "./errors.js";
import { copyImagesToR2 } from "./imageCopier.js";

const SOURCE_BY_PLATFORM = { WOOCOMMERCE: "WOOCOMMERCE", SHOPIFY: "SHOPIFY", EASYSALES: "EASYSALES" };

// după creare: moderarea și titlul pentru feed, ca la produsele din editor (încărcate la nevoie)
async function defaultAfterCreate({ db, product }) {
  const [{ moderateSavedProduct }, { queueFeedTitleRefresh }] = await Promise.all([
    import("../../services/productAiModeration.js"),
    import("../../services/feedTitleService.js"),
  ]);
  await moderateSavedProduct({ prisma: db, product });
  queueFeedTitleRefresh(product.id);
}

function importMovement({ connection, plan, productId, variantId = null, target, qty, now }) {
  return {
    productId,
    variantId,
    target,
    delta: qty,
    qtyBefore: 0,
    qtyAfter: qty,
    reason: "IMPORT",
    idempotencyKey: `import:${connection.id}:${plan.externalProductId}:${variantId || target}`,
    connectionId: connection.id,
    note: "stoc inițial din magazinul extern",
    createdAt: now,
  };
}

/**
 * @param {Object} options
 * @param {Object} options.connection     ExternalStoreConnection
 * @param {Object} options.plan           plan confirmat (applyConfirmations)
 * @param {string} options.serviceId      magazinul Artfest al vânzătorului
 * @param {string} options.ownerUserId    utilizatorul vânzătorului (cheile R2)
 * @returns {{ status: "imported" | "duplicate", productId: string, failedImages?: Object[] }}
 */
export async function importExternalProduct({
  db,
  connection,
  plan,
  serviceId,
  ownerUserId,
  importItem = null,
  copyImages = copyImagesToR2,
  afterCreate = defaultAfterCreate,
  now = new Date(),
}) {
  if (!plan?.confirmed) throw new IntegrationError("plan_not_confirmed", "Produsul trebuie confirmat înainte de import.");

  const service = await db.vendorService.findFirst({ where: { id: serviceId, vendorId: connection.vendorId }, select: { id: true } });
  if (!service) throw new IntegrationError("service_not_found", "Magazinul Artfest nu a fost găsit.", { status: 404 });

  const existing = await db.externalProductLink.findUnique({
    where: { connectionId_externalProductId: { connectionId: connection.id, externalProductId: plan.externalProductId } },
    select: { productId: true },
  });
  if (existing) return { status: "duplicate", productId: existing.productId };

  // imaginile în R2 înainte de produs; dacă nu se copiază niciuna, nu creăm un produs fără poze
  let images = [];
  let failedImages = [];
  if (plan.product.images.length) {
    const copied = await copyImages({ urls: plan.product.images, ownerUserId });
    images = copied.urls;
    failedImages = copied.failed;
    if (!images.length) {
      throw new IntegrationError("images_copy_failed", "Imaginile produsului nu au putut fi copiate.", {
        retryable: true,
        details: { failed: failedImages },
      });
    }
  }

  const p = plan.product;
  let product;
  try {
    product = await db.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          serviceId,
          title: p.title,
          description: p.description || null,
          priceCents: p.priceCents,
          currency: "RON",
          images,
          category: p.category || null,
          orderMode: p.orderMode,
          availability: p.availability,
          readyQty: p.stockScope === "VARIANT" ? null : p.readyQty,
          leadTimeDays: p.leadTimeDays,
          stockScope: p.stockScope,
          variantPoolQty: p.stockScope === "VARIANT" ? p.variantPoolQty : null,
          optionsSchema: p.optionsSchema,
          customSchema: p.customSchema || [],
          acceptsCustom: (p.customSchema || []).length > 0,
          // profilul logistic din magazin (convertit în importPlanner); lipsă = null -> tariful de rezervă
          shippingWeightGrams: p.shippingWeightGrams ?? null,
          shippingLengthCm: p.shippingLengthCm ?? null,
          shippingWidthCm: p.shippingWidthCm ?? null,
          shippingHeightCm: p.shippingHeightCm ?? null,
          isActive: true,
          moderationStatus: "PENDING",
        },
      });

      const link = await tx.externalProductLink.create({
        data: {
          connectionId: connection.id,
          productId: created.id,
          externalProductId: plan.externalProductId,
          externalType: plan.externalType,
          externalSku: plan.externalSku,
          lastSyncedAt: now,
        },
      });

      const movements = [];

      if (plan.productStockLink) {
        await tx.externalVariantLink.create({
          data: {
            productLinkId: link.id,
            externalVariantId: "",
            externalSku: plan.externalSku,
            stockManagedAt: plan.productStockLink.stockManagedAt,
            lastExternalStock: plan.productStockLink.externalStock?.quantity ?? null,
            lastExternalStockStatus: plan.productStockLink.externalStock?.status ?? null,
            lastExternalSeenAt: now,
          },
        });
        if (p.stockScope === "PRODUCT" && p.readyQty > 0) {
          movements.push(importMovement({ connection, plan, productId: created.id, target: "PRODUCT", qty: p.readyQty, now }));
        }
      }

      let poolVariantId = null;
      for (const v of plan.variants) {
        const variant = await tx.productVariant.create({
          data: {
            productId: created.id,
            combinationKey: v.combinationKey,
            selections: v.selections,
            label: v.label || null,
            sku: v.sku || null,
            stockMode: v.stockMode,
            stockQty: v.stockMode === "OWN" ? v.stockQty : null,
            availability: v.availability || null,
            origin: "EXTERNAL",
          },
        });
        await tx.externalVariantLink.create({
          data: {
            productLinkId: link.id,
            variantId: variant.id,
            externalVariantId: v.externalVariantId,
            // SKU-ul din magazin (informativ); asocierea e după externalVariantId
            externalSku: (v.externalSku ?? v.sku) || null,
            stockManagedAt: v.stockManagedAt,
            lastExternalStock: v.externalStock?.quantity ?? null,
            lastExternalStockStatus: v.externalStock?.status ?? null,
            lastExternalSeenAt: now,
          },
        });
        if (v.stockMode === "PRODUCT_POOL" && !poolVariantId) poolVariantId = variant.id;
        if (v.stockMode === "OWN" && v.stockQty > 0) {
          movements.push(importMovement({ connection, plan, productId: created.id, variantId: variant.id, target: "VARIANT", qty: v.stockQty, now }));
        }
      }

      // stocul comun: istoricul îl leagă de prima variantă care îl folosește
      if (poolVariantId && p.variantPoolQty > 0) {
        movements.push(importMovement({ connection, plan, productId: created.id, variantId: poolVariantId, target: "VARIANT_POOL", qty: p.variantPoolQty, now }));
      }

      if (movements.length) await tx.inventoryMovement.createMany({ data: movements, skipDuplicates: true });
      if (p.stockScope === "VARIANT") await syncVariantAggregate(tx, created.id);

      if (importItem) {
        await tx.productImportItem.update({
          where: { id: importItem.id },
          data: { status: "IMPORTED", productId: created.id, importedAt: now, warnings: plan.warnings.length ? plan.warnings : undefined },
        });
      }

      return tx.product.findUnique({ where: { id: created.id } });
    });
  } catch (error) {
    // import concurent al aceluiași produs extern: unicitatea legăturii a oprit al doilea
    if (error?.code === "P2002") {
      const again = await db.externalProductLink.findUnique({
        where: { connectionId_externalProductId: { connectionId: connection.id, externalProductId: plan.externalProductId } },
        select: { productId: true },
      });
      if (again) return { status: "duplicate", productId: again.productId };
    }
    throw error;
  }

  try {
    await afterCreate({ db, product });
  } catch (error) {
    // produsul rămâne PENDING; moderarea manuală / următoarea salvare îl preia
    console.error("[integrations] after-create (moderation) failed:", product.id, error?.message || error);
  }

  return { status: "imported", productId: product.id, failedImages };
}

/**
 * Lot de import (istoric în ProductImport / ProductImportItem, ca importul
 * din fișiere): fiecare produs separat; un produs eșuat nu oprește lotul.
 *
 * @param {{ rowNumber: number, plan: Object, raw?: Object }[]} items  planuri confirmate
 */
export async function importBatch({ db, connection, serviceId, ownerUserId, items, ...options }) {
  const now = options.now || new Date();
  const service = await db.vendorService.findFirst({ where: { id: serviceId, vendorId: connection.vendorId }, select: { id: true } });
  if (!service) throw new IntegrationError("service_not_found", "Magazinul Artfest nu a fost găsit.", { status: 404 });

  const batch = await db.productImport.create({
    data: {
      vendorId: connection.vendorId,
      serviceId,
      source: SOURCE_BY_PLATFORM[connection.platform],
      connectionId: connection.id,
      status: "IMPORTING",
      totalRows: items.length,
      startedAt: now,
    },
  });

  const results = [];
  for (const item of items) {
    const row = await db.productImportItem.create({
      data: {
        importId: batch.id,
        rowNumber: item.rowNumber,
        rawData: item.raw ?? { externalProductId: item.plan.externalProductId },
        normalizedData: { externalProductId: item.plan.externalProductId, title: item.plan.product.title },
        status: "PENDING",
      },
    });
    try {
      const result = await importExternalProduct({ db, connection, plan: item.plan, serviceId, ownerUserId, importItem: row, ...options });
      if (result.status === "duplicate") {
        await db.productImportItem.update({ where: { id: row.id }, data: { status: "SKIPPED", productId: result.productId, warnings: ["already_imported"] } });
      }
      results.push({ rowNumber: item.rowNumber, ...result });
    } catch (error) {
      await db.productImportItem.update({
        where: { id: row.id },
        data: { status: "FAILED", errors: [{ code: error?.code || "import_failed", message: error?.message || "Import eșuat" }] },
      });
      results.push({ rowNumber: item.rowNumber, status: "failed", code: error?.code || "import_failed" });
    }
  }

  const count = (status) => results.filter((r) => r.status === status).length;
  await db.productImport.update({
    where: { id: batch.id },
    data: {
      status: count("failed") ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
      importedRows: count("imported"),
      skippedRows: count("duplicate"),
      failedRows: count("failed"),
      completedAt: new Date(),
    },
  });

  return { importId: batch.id, results };
}

/**
 * Previzualizare pentru interfața Importuri: o pagină de produse din
 * magazin, cu planul fiecăruia (decizii sigure / de confirmat) și
 * produsele deja importate marcate (nu se pot importa a doua oară).
 */
export async function previewProducts({ db, connection, adapter, page = 1, perPage = 20, storeCurrency = null, planImport }) {
  const result = await adapter.listProducts({ page, perPage });
  const linked = await db.externalProductLink.findMany({
    where: { connectionId: connection.id, externalProductId: { in: result.items.map((p) => p.externalId) } },
    select: { externalProductId: true, productId: true, status: true },
  });
  const linkedById = new Map(linked.map((l) => [l.externalProductId, l]));

  return {
    page: result.page,
    total: result.total,
    totalPages: result.totalPages,
    items: result.items.map((product) => ({
      externalProductId: product.externalId,
      title: product.name,
      type: product.type,
      sku: product.sku,
      image: product.images[0] || null,
      alreadyImported: linkedById.get(product.externalId) || null,
      plan: planImport(product, { storeCurrency }),
    })),
  };
}
