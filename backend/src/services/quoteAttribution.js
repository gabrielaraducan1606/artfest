// backend/src/services/quoteAttribution.js

/*
 * Snapshot de attribution pentru flow-ul QuoteRequest/QuoteOffer.
 *
 * NU e un motor nou de attribution - rezolvarea propriu-zisă
 * (influencer/vendor referral/VendorCollection) rămâne EXCLUSIV
 * în resolveInfluencerAttribution/resolveVendorReferralAttribution/
 * resolveVendorCollectionAttribution (influencerAttribution.js,
 * vendorAttribution.js) și în resolveEffectiveRefVendorAttribution/
 * resolveShipmentPromoter/buildShipmentAttributionFields
 * (chekoutRoutes.js) - identic cu checkout-ul normal.
 *
 * Acest fișier doar:
 * 1. la creare QuoteRequest, îngheață rezultatul rezolvării de mai
 *    sus într-un obiect versionat, salvat în
 *    QuoteRequest.requestData.attributionSnapshot;
 * 2. la acceptarea ofertei, traduce înapoi acel obiect înghețat în
 *    forma pe care resolveShipmentPromoter/buildShipmentAttributionFields
 *    o așteaptă - FĂRĂ să revalideze vreun token (dacă attribution-ul
 *    era valid la crearea cererii, rămâne valid pentru acceptarea ei,
 *    indiferent cât timp a trecut între timp).
 */

export const QUOTE_ATTRIBUTION_SNAPSHOT_VERSION = 1;
export const QUOTE_ATTRIBUTION_SNAPSHOT_SOURCE = "QUOTE_REQUEST_CREATE";

/**
 * @param {object} params
 * @param {{influencerId, referralCodeSnapshot, commissionBpsSnapshot}|null} params.influencerAttribution
 * @param {{vendorId, referralCodeSnapshot, commissionBpsSnapshot, issuedAt}|null} params.vendorReferralAttribution
 * @param {{vendorId, referralCodeSnapshot, commissionBpsSnapshot, collectionId, collectionSlug, issuedAt}|null} params.vendorCollectionAttribution
 * @param {boolean} params.vendorCollectionProductWasMember - membership-ul
 *   REAL al produsului cerut în colecție, calculat la crearea cererii -
 *   niciodată reevaluat mai târziu.
 * @param {{vendorId, referralCodeSnapshot, commissionBpsSnapshot, collectionId, collectionSlug, issuedAt}|null} params.effectiveVendorAttribution -
 *   rezultatul resolveEffectiveRefVendorAttribution (câștigătorul
 *   "referral pasiv" între vendorReferral și vendorCollection,
 *   deja aplicând regula own-sale + membership) - ăsta e cel folosit
 *   efectiv la acceptare, celelalte două rămân doar istoric/audit.
 *
 * @returns {object} mereu un obiect explicit, niciodată null - chiar
 *   și fără nicio atribuire detectată, ca să fie clar că am VERIFICAT.
 */
export function buildQuoteAttributionSnapshot({
  influencerAttribution = null,
  vendorReferralAttribution = null,
  vendorCollectionAttribution = null,
  vendorCollectionProductWasMember = false,
  effectiveVendorAttribution = null,
} = {}) {
  const capturedAt = new Date().toISOString();

  return {
    version: QUOTE_ATTRIBUTION_SNAPSHOT_VERSION,
    capturedAt,
    source: QUOTE_ATTRIBUTION_SNAPSHOT_SOURCE,

    influencer: influencerAttribution
      ? {
          influencerId: influencerAttribution.influencerId,
          referralCodeSnapshot: influencerAttribution.referralCodeSnapshot,
          commissionBpsSnapshot: influencerAttribution.commissionBpsSnapshot,
          capturedAt,
        }
      : null,

    vendorReferral: vendorReferralAttribution
      ? {
          vendorId: vendorReferralAttribution.vendorId,
          referralCodeSnapshot: vendorReferralAttribution.referralCodeSnapshot,
          commissionBpsSnapshot:
            vendorReferralAttribution.commissionBpsSnapshot,
          capturedAt,
        }
      : null,

    vendorCollection: vendorCollectionAttribution
      ? {
          collectionId: vendorCollectionAttribution.collectionId,
          collectionSlug: vendorCollectionAttribution.collectionSlug || null,
          ownerVendorId: vendorCollectionAttribution.vendorId,
          referralCodeSnapshot:
            vendorCollectionAttribution.referralCodeSnapshot,
          commissionBpsSnapshot:
            vendorCollectionAttribution.commissionBpsSnapshot,
          productWasMember: Boolean(vendorCollectionProductWasMember),
          capturedAt,
        }
      : null,

    /*
     * Câștigătorul "referral pasiv" (vendor), deja decis la creare -
     * own-sale vs referral cross-vendor, cu membership-ul înghețat.
     * `via` distinge sursa DOAR pentru audit - buildShipmentAttributionFields
     * decide own-sale/cross-vendor din vendorId, nu din `via`.
     */
    effectiveVendorAttribution: effectiveVendorAttribution
      ? {
          via: effectiveVendorAttribution.collectionId
            ? "VENDOR_COLLECTION"
            : "VENDOR_REFERRAL",
          vendorId: effectiveVendorAttribution.vendorId,
          referralCodeSnapshot: effectiveVendorAttribution.referralCodeSnapshot,
          commissionBpsSnapshot:
            effectiveVendorAttribution.commissionBpsSnapshot,
          collectionId: effectiveVendorAttribution.collectionId || null,
          collectionSlug: effectiveVendorAttribution.collectionSlug || null,
        }
      : null,
  };
}

/**
 * Traduce attributionSnapshot-ul înghețat înapoi în candidații
 * "referral pasiv" pe care resolveShipmentPromoter îi așteaptă
 * (refInfluencerAttribution/refVendorAttribution) - FĂRĂ nicio
 * interogare DB, FĂRĂ nicio revalidare de token. Folosit STRICT la
 * acceptarea ofertei.
 *
 * @param {object|null} attributionSnapshot - QuoteRequest.requestData.attributionSnapshot
 * @returns {{
 *   refInfluencerAttribution: {influencerId, referralCodeSnapshot, commissionBpsSnapshot}|null,
 *   refVendorAttribution: {vendorId, referralCodeSnapshot, commissionBpsSnapshot, collectionSlug}|null,
 * }}
 */
export function resolvePassiveAttributionFromSnapshot(attributionSnapshot) {
  const influencer = attributionSnapshot?.influencer || null;
  const effectiveVendor = attributionSnapshot?.effectiveVendorAttribution || null;

  return {
    refInfluencerAttribution: influencer
      ? {
          influencerId: influencer.influencerId,
          referralCodeSnapshot: influencer.referralCodeSnapshot,
          commissionBpsSnapshot: influencer.commissionBpsSnapshot,
        }
      : null,

    refVendorAttribution: effectiveVendor
      ? {
          vendorId: effectiveVendor.vendorId,
          referralCodeSnapshot: effectiveVendor.referralCodeSnapshot,
          commissionBpsSnapshot: effectiveVendor.commissionBpsSnapshot,
          collectionSlug: effectiveVendor.collectionSlug || null,
        }
      : null,
  };
}
