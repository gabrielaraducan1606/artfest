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
        platformFundingBps: true,
        vendorFundingBps: true,
        fundingSource: true,
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
      platformFundingBps: campaign.platformFundingBps,
      vendorFundingBps: campaign.vendorFundingBps,
      fundingSource: campaign.fundingSource,
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
 * SELECTED_PRODUCTS).
 *
 * SCHIMBARE (audit 2026-09-14, lifecycle VendorCampaign):
 * comisionul redus de campanie ACUM depinde de asta - vezi
 * getCampaignEligibilityInfo / splitItemsByCampaignEligibility mai
 * jos. Funcția rămâne neschimbată ca semnătură/comportament (doar
 * comentariul vechi, care spunea contrariul, era depășit).
 */
export function isProductEligibleForCampaign(productId, attribution) {
  if (!attribution) return false;

  if (attribution.scope === "SELECTED_PRODUCTS") {
    return attribution.selectedProductIds.has(String(productId));
  }

  return true;
}

/**
 * Info de eligibilitate a UNEI campanii deja atribuite unui shipment
 * (shipment.campaignId), pentru calculul comisionului - NU pentru
 * atribuire. Diferă de `resolveVendorCampaignAttributions` prin
 * faptul că nu verifică token/fereastră/isActive/date - la momentul
 * calculului comisionului (checkout, ledger, refund, preview) e
 * INTENȚIONAT să folosim campania așa cum a fost la creare
 * shipment-ului (campaignId e deja un snapshot server-side validat
 * o dată, la checkout), nu să o revalidăm din nou fiecare dată.
 *
 * @returns {Promise<{scope: string, selectedProductIds: Set<string>} | null>}
 */
export async function getCampaignEligibilityInfo(campaignId) {
  if (!campaignId) return null;

  const campaign = await prisma.vendorCampaign.findUnique({
    where: { id: String(campaignId) },
    select: {
      scope: true,
      products: { select: { productId: true } },
    },
  });

  if (!campaign) return null;

  return {
    scope: campaign.scope,
    selectedProductIds: new Set(
      Array.isArray(campaign.products)
        ? campaign.products.map((p) => p.productId).filter(Boolean)
        : []
    ),
  };
}

/**
 * Variantă batch a `getCampaignEligibilityInfo`, pentru CARD
 * (computeOrderSplits), unde o comandă poate avea mai multe
 * shipment-uri/campaignId-uri de interogat o singură dată.
 *
 * @returns {Promise<Map<string, {scope, selectedProductIds}>>}
 */
export async function getCampaignEligibilityInfoMap(campaignIds = []) {
  const ids = Array.from(
    new Set((campaignIds || []).map((id) => String(id || "")).filter(Boolean))
  );

  const map = new Map();
  if (!ids.length) return map;

  const campaigns = await prisma.vendorCampaign.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      scope: true,
      products: { select: { productId: true } },
    },
  });

  for (const campaign of campaigns) {
    map.set(campaign.id, {
      scope: campaign.scope,
      selectedProductIds: new Set(
        Array.isArray(campaign.products)
          ? campaign.products.map((p) => p.productId).filter(Boolean)
          : []
      ),
    });
  }

  return map;
}

/**
 * Împarte itemii unui shipment/vendor în două grupuri, pe baza
 * eligibilității REALE pentru campania atașată:
 * - eligible: beneficiază de comisionul redus de campanie
 * - standard: rămân pe comisionul standard (plan)
 *
 * ATTRIBUTION vs COMMISSION ELIGIBILITY: `eligibilityInfo === null`
 * (fără campanie atașată, sau campanie negăsită) => toate itemii merg
 * în `standard`. Atribuirea (campaignId pe shipment, pentru
 * analytics) poate exista fără ca vreun item să fie eligibil pentru
 * comision - acesta e exact cazul separat de mai jos.
 */
export function splitItemsByCampaignEligibility(items, eligibilityInfo) {
  const eligible = [];
  const standard = [];

  for (const item of items || []) {
    if (
      eligibilityInfo &&
      isProductEligibleForCampaign(item.productId, eligibilityInfo)
    ) {
      eligible.push(item);
    } else {
      standard.push(item);
    }
  }

  return { eligible, standard };
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
      fundingSource: attribution.fundingSource,
      platformFundingBps: attribution.platformFundingBps,
      vendorFundingBps: attribution.vendorFundingBps,
    });

    if (promotion) {
      map.set(product.id, promotion);
    }
  }

  return map;
}
