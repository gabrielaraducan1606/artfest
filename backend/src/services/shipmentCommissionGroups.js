// backend/src/services/shipmentCommissionGroups.js
//
// Clasificarea PER ITEM a liniilor unui shipment în grupuri de comision -
// SURSĂ UNICĂ pentru COD (computeVendorEarningForShipment,
// vendorOrdersRoutes.js) și CARD (computeOrderSplits, marketplaceCalc.js),
// ca cele două să nu poată diverge.
//
// Nu există formulă nouă: fiecare grup e calculat ulterior cu
// computeGroupedCommissionBreakdown (commissionCalc.js), exact ca split-ul
// de campanie existent. Se decide DOAR ce itemi intră în ce grup:
//
//  1. own-sale CLASIC (?ref= propriu / cod de reducere al vendorului) -
//     shipment cu vendorReferralCommissionOverrideBps și FĂRĂ itemi cu
//     snapshot de colecție -> UN singur grup, toți itemii (comportament
//     neschimbat, inclusiv prioritatea own-sale > campanie);
//
//  2. VendorCollection PER ITEM (request-based) - itemii cu
//     ShipmentItem.vendorCollectionIdSnapshot sunt singurii atribuiți
//     colecției (snapshot la checkout, NU colecția live):
//       - item din colecție, shipment own-sale      -> own-sale (override bps)
//       - item în afara colecției, eligibil campanie -> campaignCommissionBps
//       - restul                                    -> comisionul planului
//
//  3. fără own-sale: campanie (eligibili) + plan (restul) - neschimbat.
//
// Referral cross-vendor din colecție: comisionul SELLERULUI rămâne cel de
// mai sus (plan / campanie per item); remunerația referrer-ului se calculează
// doar din itemii cu snapshot (collectionReferralItems).

import { isProductEligibleForCampaign } from "./campaignAttribution.js";

export const COMMISSION_GROUP_LABELS = Object.freeze({
  VENDOR_COLLECTION_OWN_SALE: "vendor_collection_own_sale",
  VENDOR_REFERRAL_OWN_SALE: "vendor_referral_own_sale",
  CAMPAIGN: "campaign",
  PLAN: "plan",
});

const COLLECTION_MARKER_PREFIX = "COLLECTION:";

const isSet = (value) => value !== null && value !== undefined;

export function hasVendorCollectionSnapshot(item) {
  return Boolean(item?.vendorCollectionIdSnapshot);
}

/*
 * ROLUL snapshot-ului unui item (FAZA 2 - colecții proprii + cross-vendor în
 * același shipment), dedus DOAR din valori înghețate la checkout:
 *  - REFERRAL: shipment-ul are referrer din colecție (marcaj "COLLECTION:<slug>")
 *    și item-ul are snapshot cu ACELAȘI slug -> baza referral-ului cross-vendor;
 *  - PROPRIU: orice alt item cu snapshot -> colecția proprie a sellerului
 *    (own-sale 5% per item, reducere finanțată de vendor).
 * Fără citiri din colecția live.
 */
export function referralCollectionSlug(shipment) {
  const marker = shipment?.referrerVendorReferralCodeSnapshot;
  if (!shipment?.referrerVendorId || typeof marker !== "string" || !marker.startsWith(COLLECTION_MARKER_PREFIX)) {
    return null;
  }
  return marker.slice(COLLECTION_MARKER_PREFIX.length) || null;
}

export function isReferralCollectionItem(item, shipment) {
  const slug = referralCollectionSlug(shipment);
  return Boolean(slug) && hasVendorCollectionSnapshot(item) && item.vendorCollectionSlugSnapshot === slug;
}

export function isOwnCollectionItem(item, shipment) {
  return hasVendorCollectionSnapshot(item) && !isReferralCollectionItem(item, shipment);
}

/**
 * @param {object} params
 * @param {object} params.shipment - câmpurile de atribuire ale shipment-ului
 * @param {Array} params.items - ShipmentItem-urile shipment-ului
 * @param {number} params.baseCommissionBps - comisionul planului
 * @param {{scope, selectedProductIds}|null} params.campaignEligibilityInfo
 * @returns {Array<{label: string, commissionBps: number, items: Array}>}
 *   grupurile (pot fi goale - computeGroupedCommissionBreakdown le ignoră)
 */
export function classifyShipmentCommissionItems({
  shipment,
  items = [],
  baseCommissionBps,
  campaignEligibilityInfo = null,
}) {
  const list = Array.isArray(items) ? items : [];

  const hasOwnSale = isSet(shipment?.vendorReferralCommissionOverrideBps);
  const hasCampaign = isSet(shipment?.campaignCommissionBps);
  const perItemCollection = list.some((item) => isOwnCollectionItem(item, shipment));

  /* ---------- 1. own-sale clasic: tot shipment-ul (neschimbat) ---------- */

  if (hasOwnSale && !perItemCollection) {
    const marker = shipment?.referrerVendorReferralCodeSnapshot;
    const isCollectionMarker =
      typeof marker === "string" && marker.startsWith(COLLECTION_MARKER_PREFIX);

    return [
      {
        label: isCollectionMarker
          ? COMMISSION_GROUP_LABELS.VENDOR_COLLECTION_OWN_SALE
          : COMMISSION_GROUP_LABELS.VENDOR_REFERRAL_OWN_SALE,
        commissionBps: Number(shipment.vendorReferralCommissionOverrideBps),
        items: list,
      },
    ];
  }

  /* ---------- 2. / 3. per item ---------- */

  const ownSaleItems = [];
  const campaignItems = [];
  const planItems = [];

  for (const item of list) {
    if (hasOwnSale && isOwnCollectionItem(item, shipment)) {
      ownSaleItems.push(item);
    } else if (
      hasCampaign &&
      campaignEligibilityInfo &&
      isProductEligibleForCampaign(item?.productId, campaignEligibilityInfo)
    ) {
      campaignItems.push(item);
    } else {
      planItems.push(item);
    }
  }

  const groups = [];

  if (hasOwnSale) {
    groups.push({
      label: COMMISSION_GROUP_LABELS.VENDOR_COLLECTION_OWN_SALE,
      commissionBps: Number(shipment.vendorReferralCommissionOverrideBps),
      items: ownSaleItems,
    });
  }

  if (hasCampaign) {
    groups.push({
      label: COMMISSION_GROUP_LABELS.CAMPAIGN,
      commissionBps: Number(shipment.campaignCommissionBps),
      items: campaignItems,
    });
  }

  groups.push({
    label: COMMISSION_GROUP_LABELS.PLAN,
    commissionBps: Number(baseCommissionBps || 0),
    items: planItems,
  });

  return groups;
}

/**
 * Itemii care generează remunerație de referral cross-vendor din colecție
 * (snapshot la checkout), sau null dacă shipment-ul NU e un referral din
 * colecție per item (referral clasic ?ref= / cod -> tot shipment-ul, ca
 * înainte).
 */
export function collectionReferralItems({ shipment, items = [] }) {
  if (!referralCollectionSlug(shipment)) return null; // referral clasic -> tot shipment-ul

  const list = Array.isArray(items) ? items : [];
  // legacy (token, fără snapshot-uri) -> comportamentul de dinainte, tot shipment-ul
  if (!list.some(hasVendorCollectionSnapshot)) return null;

  return list.filter((item) => isReferralCollectionItem(item, shipment));
}
