// backend/src/services/vendorCollectionPricing.js
//
// „Axa proprie” a VendorCollection (preia rolul VendorCampaign):
// pentru FIECARE vendor din coș / listare, cea mai recentă colecție PROPRIE
// (owner == seller) activă în interval, din navigarea curentă
// (vendorCollectionSlugs; + campaignSlugs vechi mapate prin legacyCampaignId).
//
//  - membership propriu: allOwnProducts=true (toate produsele ownerului, inclusiv
//    cele publicate ulterior) SAU VendorCollectionItem;
//  - reducere: discountPercent > 0 -> promoție de același tip ca reducerea de
//    campanie (campaignToPromotion), FINANȚARE FORȚATĂ VENDOR
//    (platformFundingBps = 0 -> Artfest nu finanțează nimic), DOAR pe produsele
//    proprii membre; produsele altor vendori nu primesc niciodată reducerea;
//  - comision: own-sale 5% per item (checkout scrie snapshot-ul pe itemii membri).
//
// Fără formule noi: promoția intră în același motor (chooseBestPromotion /
// calculateProductPromotionPricing) ca orice reducere de campanie.

import { prisma } from "../db.js";
import { campaignToPromotion } from "./productPromotionPrice.js";
import { normalizeCampaignSlugs } from "./campaignAttribution.js";
import { normalizeVendorCollectionSlugs } from "./referralAttribution.js";
import { isOwnCollectionMember, isVendorCollectionLive } from "./vendorCollectionRules.js";

const OWN_COLLECTION_SELECT = {
  id: true,
  vendorId: true,
  slug: true,
  title: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  discountPercent: true,
  allOwnProducts: true,
  legacyCampaignId: true,
  vendor: { select: { isActive: true } },
};

/**
 * @returns {Promise<Map<string, {
 *   collectionId, slug, title, vendorId, discountPercent, allOwnProducts,
 *   selectedProductIds: Set<string>, capturedAt: number|null, legacyCampaignId
 * }>>} cheie = vendorId (owner == seller)
 */
export async function resolveOwnCollectionAttributions({
  vendorIds = [],
  vendorCollectionSlugs,
  campaignSlugs,
  db = prisma,
  now = new Date(),
} = {}) {
  const result = new Map();
  const vendorSet = new Set((vendorIds || []).map((id) => String(id || "")).filter(Boolean));
  if (!vendorSet.size) return result;

  const explicit = normalizeVendorCollectionSlugs(vendorCollectionSlugs);
  const legacySlugs = normalizeCampaignSlugs(campaignSlugs);
  const candidates = []; // cele mai recente întâi

  if (explicit.length) {
    const rows = await db.vendorCollection.findMany({
      where: { slug: { in: explicit.map((e) => e.slug) }, vendorId: { in: [...vendorSet] } },
      select: OWN_COLLECTION_SELECT,
    });
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    for (const e of explicit) {
      const c = bySlug.get(e.slug);
      if (c) candidates.push({ collection: c, at: e.at });
    }
  }

  // compatibilitate: slug de campanie migrată -> colecția cu legacyCampaignId
  if (legacySlugs.length) {
    const campaigns = await db.vendorCampaign.findMany({
      where: { slug: { in: legacySlugs } },
      select: { id: true, slug: true },
    });

    if (campaigns.length) {
      const rows = await db.vendorCollection.findMany({
        where: { legacyCampaignId: { in: campaigns.map((c) => c.id) }, vendorId: { in: [...vendorSet] } },
        select: OWN_COLLECTION_SELECT,
      });
      const byLegacyId = new Map(rows.map((r) => [String(r.legacyCampaignId), r]));
      const campaignIdBySlug = new Map(campaigns.map((c) => [c.slug, String(c.id)]));

      for (const slug of legacySlugs) {
        const c = byLegacyId.get(campaignIdBySlug.get(slug));
        if (c) candidates.push({ collection: c, at: null });
      }
    }
  }

  const live = candidates.filter(
    ({ collection }) =>
      vendorSet.has(String(collection.vendorId)) &&
      collection.vendor?.isActive !== false &&
      isVendorCollectionLive(collection, now)
  );

  // selecțiile explicite PROPRII (produse ale ownerului) - itemii altor vendori
  // nu fac parte din axa proprie (ei țin de referral-ul cross-vendor)
  const explicitIds = [...new Set(live.filter((x) => !x.collection.allOwnProducts).map((x) => x.collection.id))];
  const items = explicitIds.length
    ? await db.vendorCollectionItem.findMany({
        where: { collectionId: { in: explicitIds } },
        select: { collectionId: true, productId: true, product: { select: { service: { select: { vendorId: true } } } } },
      })
    : [];

  const ownItemIdsByCollection = new Map();
  for (const collection of new Set(live.map((x) => x.collection))) {
    ownItemIdsByCollection.set(
      collection.id,
      new Set(
        items
          .filter((i) => i.collectionId === collection.id && String(i.product?.service?.vendorId) === String(collection.vendorId))
          .map((i) => String(i.productId))
      )
    );
  }

  /*
   * Per vendor: cea mai recentă colecție PROPRIE cu potențial propriu
   * (allOwnProducts sau ≥1 produs propriu selectat). O colecție a lui A care
   * listează doar produse ale altor vendori nu „acoperă” colecția proprie.
   */
  for (const { collection, at } of live) {
    const vendorId = String(collection.vendorId);
    if (result.has(vendorId)) continue;

    const ownItemIds = ownItemIdsByCollection.get(collection.id) || new Set();
    if (!collection.allOwnProducts && !ownItemIds.size) continue;

    result.set(vendorId, {
      collectionId: collection.id,
      slug: collection.slug,
      title: collection.title,
      vendorId,
      discountPercent: Math.max(0, Number(collection.discountPercent || 0)),
      allOwnProducts: Boolean(collection.allOwnProducts),
      selectedProductIds: ownItemIds,
      capturedAt: Number(at) || null,
      legacyCampaignId: collection.legacyCampaignId || null,
    });
  }

  return result;
}

/** Reducerea colecției pentru UN produs propriu membru (sau null). Artfest = 0. */
export function ownCollectionPromotionForProduct(product, ownCollectionsByVendorId) {
  const vendorId = product?.service?.vendorId ? String(product.service.vendorId) : null;
  if (!vendorId || !product?.id) return null;

  const attribution = ownCollectionsByVendorId?.get(vendorId);
  if (!attribution || !isOwnCollectionMember(attribution, product.id, vendorId)) return null;

  const promotion = campaignToPromotion({
    discountPercent: attribution.discountPercent,
    campaignName: `Colecția ${attribution.title || ""}`.trim(),
    fundingSource: "VENDOR",
    platformFundingBps: 0,
    vendorFundingBps: 10000,
  });

  return promotion ? { ...promotion, vendorCollectionId: attribution.collectionId } : null;
}

/*
 * Adaugă reducerile colecțiilor proprii peste map-ul promoțiilor de campanie
 * (legacy) - per produs rămâne cea mai mare reducere a vendorului (ambele sunt
 * finanțate de vendor, pe produsele lui). Restul surselor (Artfest Collection,
 * homepage, cod) concurează apoi normal în chooseBestPromotion.
 */
export function withOwnCollectionPromotions(campaignPromotionsByProductId, products, ownCollectionsByVendorId) {
  const merged = new Map(campaignPromotionsByProductId || []);
  if (!ownCollectionsByVendorId?.size) return merged;

  for (const product of products || []) {
    const promotion = ownCollectionPromotionForProduct(product, ownCollectionsByVendorId);
    if (!promotion) continue;

    const existing = merged.get(product.id);
    if (!existing || Number(promotion.totalDiscountPercent) >= Number(existing.totalDiscountPercent || 0)) {
      merged.set(product.id, promotion);
    }
  }

  return merged;
}
