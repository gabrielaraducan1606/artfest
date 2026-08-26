// backend/src/services/campaignAttribution.js

/*
 * Revalidare server-side a atribuirii de campanie, folosită
 * EXCLUSIV la checkout.
 *
 * Client-ul trimite un attributionToken (emis de
 * GET /api/public/campaigns/:slug) per vendorId - dar
 * tokenul dovedește doar "acest server a emis asta pentru
 * campania X la momentul Y", nu că regulile campaniei sunt
 * încă valabile ACUM. De aceea revalidăm mereu direct din DB
 * (isActive, vendor activ, interval startsAt/endsAt), la fel
 * ca GET /api/public/campaigns/:slug.
 *
 * Fail open: orice atribuire invalidă/expirată/lipsă e
 * ignorată silențios - comanda continuă normal, fără discount
 * și fără comision redus. Nu blocăm niciodată checkout-ul din
 * cauza unei campanii.
 */

import { prisma } from "../db.js";
import { verifyCampaignAttributionToken } from "./campaignAttributionToken.js";
import { campaignToPromotion } from "./productPromotionPrice.js";

/**
 * @param {object} params
 * @param {string[]} params.vendorIds - vendorii prezenți în coșul curent
 * @param {Record<string,string>} params.tokensByVendorId - { [vendorId]: attributionToken }
 * @returns {Promise<Map<string, {
 *   campaignId: string,
 *   discountPercent: number,
 *   scope: "ALL_PRODUCTS" | "SELECTED_PRODUCTS",
 *   selectedProductIds: Set<string>,
 * }>>} cheie = vendorId
 */
export async function resolveVendorCampaignAttributions({
  vendorIds = [],
  tokensByVendorId = {},
}) {
  const result = new Map();

  const candidateVendorIds = vendorIds
    .map((id) => String(id || ""))
    .filter((id) => id && tokensByVendorId?.[id]);

  if (!candidateVendorIds.length) {
    return result;
  }

  const now = new Date();

  for (const vendorId of candidateVendorIds) {
    const payload = verifyCampaignAttributionToken(
      tokensByVendorId[vendorId]
    );

    if (!payload || payload.vendorId !== vendorId) {
      continue;
    }

    const campaign = await prisma.vendorCampaign.findFirst({
      where: {
        id: payload.campaignId,
        vendorId,
      },

      select: {
        id: true,
        vendorId: true,
        isActive: true,
        scope: true,
        discountPercent: true,
        startsAt: true,
        endsAt: true,

        vendor: {
          select: {
            isActive: true,
          },
        },

        products: {
          select: {
            productId: true,
          },
        },
      },
    });

    if (!campaign) continue;
    if (campaign.vendor?.isActive === false) continue;
    if (!campaign.isActive) continue;
    if (campaign.startsAt && campaign.startsAt > now) continue;
    if (campaign.endsAt && campaign.endsAt <= now) continue;

    result.set(vendorId, {
      campaignId: campaign.id,
      discountPercent: Number(campaign.discountPercent || 0),
      scope: campaign.scope,
      selectedProductIds: new Set(
        Array.isArray(campaign.products)
          ? campaign.products.map((p) => p.productId).filter(Boolean)
          : []
      ),
    });
  }

  return result;
}

/**
 * Verifică dacă un produs anume e eligibil pentru discountul
 * campaniei atribuite vendorului său (ALL_PRODUCTS vs
 * SELECTED_PRODUCTS). Comisionul redus NU depinde de asta -
 * se aplică la nivel de shipment, indiferent ce produse conține.
 */
export function isProductEligibleForCampaign(productId, attribution) {
  if (!attribution) return false;

  if (attribution.scope === "SELECTED_PRODUCTS") {
    return attribution.selectedProductIds.has(String(productId));
  }

  return true;
}

/**
 * Construiește Map<productId, promotionCandidate> pentru
 * discountul de campanie, pornind de la atribuirile deja
 * revalidate server-side (una per vendor prezent în coș/comandă).
 *
 * `products` - listă plată de produse, fiecare cu `.id` și
 * `.service.vendorId` (formă comună coș, checkout, summary).
 *
 * Comisionul redus NU depinde de asta - se decide separat,
 * per shipment, la crearea shipment-urilor.
 */
export function buildCampaignPromotionsByProductId(
  products,
  attributionsByVendorId
) {
  const map = new Map();

  if (!attributionsByVendorId || !attributionsByVendorId.size) {
    return map;
  }

  for (const product of products || []) {
    const vendorId = product?.service?.vendorId
      ? String(product.service.vendorId)
      : null;

    if (!vendorId || !product?.id) continue;

    const attribution = attributionsByVendorId.get(vendorId);
    if (!attribution) continue;

    if (!isProductEligibleForCampaign(product.id, attribution)) continue;

    const promotion = campaignToPromotion({
      discountPercent: attribution.discountPercent,
    });

    if (promotion) {
      map.set(product.id, promotion);
    }
  }

  return map;
}
