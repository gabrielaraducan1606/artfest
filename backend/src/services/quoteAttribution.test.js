// src/services/quoteAttribution.test.js
//
// Teste deterministe, unitare, pentru snapshot-ul de attribution al
// flow-ului QuoteRequest/QuoteOffer (buildQuoteAttributionSnapshot,
// resolvePassiveAttributionFromSnapshot) compuse cu funcțiile PURE de
// attribution din checkout (resolveShipmentPromoter,
// buildShipmentAttributionFields, resolveEffectiveRefVendorAttribution)
// - exact regulile A-D + prioritatea codului explicit cerute pentru
// task-ul QuoteRequest attribution.
//
// Nu ating DB - toate funcțiile testate sunt pure.

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildQuoteAttributionSnapshot,
  resolvePassiveAttributionFromSnapshot,
} from "./quoteAttribution.js";

import {
  resolveShipmentPromoter,
  buildShipmentAttributionFields,
  resolveEffectiveRefVendorAttribution,
} from "../routes/chekoutRoutes.js";

const VENDOR_A = "vendor-a";
const VENDOR_B = "vendor-b";

function noPromoter(overrides = {}) {
  return {
    shipmentWonByDiscountCode: false,
    shipmentEligibleForVendorAttributionByDiscountCode: false,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution: null,
    refInfluencerAttribution: null,
    refVendorAttribution: null,
    ...overrides,
  };
}

test("snapshot gol - explicit, versionat, toate câmpurile null", () => {
  const snapshot = buildQuoteAttributionSnapshot({});

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.source, "QUOTE_REQUEST_CREATE");
  assert.ok(snapshot.capturedAt);
  assert.equal(snapshot.influencer, null);
  assert.equal(snapshot.vendorReferral, null);
  assert.equal(snapshot.vendorCollection, null);
  assert.equal(snapshot.effectiveVendorAttribution, null);
});

test("resolvePassiveAttributionFromSnapshot(null) -> nici o eroare, totul null (quote-uri vechi, fără câmp)", () => {
  const { refInfluencerAttribution, refVendorAttribution } =
    resolvePassiveAttributionFromSnapshot(null);

  assert.equal(refInfluencerAttribution, null);
  assert.equal(refVendorAttribution, null);
});

test("A. Collection A -> produs propriu A, ERA în colecție: own-sale 500bps, zero referral", () => {
  const vendorCollectionAttribution = {
    vendorId: VENDOR_A,
    referralCodeSnapshot: "COLA",
    commissionBpsSnapshot: 2000,
    collectionId: "col-1",
    collectionSlug: "colectia-a",
    issuedAt: 100,
  };

  const effectiveVendorAttribution = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: null,
    refCollectionAttribution: vendorCollectionAttribution,
    shipmentVendorId: VENDOR_A,
    shipmentEligibleByCollectionMembership: true,
  });

  const snapshot = buildQuoteAttributionSnapshot({
    vendorCollectionAttribution,
    vendorCollectionProductWasMember: true,
    effectiveVendorAttribution,
  });

  assert.equal(snapshot.vendorCollection.productWasMember, true);
  assert.equal(snapshot.effectiveVendorAttribution.via, "VENDOR_COLLECTION");

  const { refInfluencerAttribution, refVendorAttribution } =
    resolvePassiveAttributionFromSnapshot(snapshot);

  const promoter = resolveShipmentPromoter(
    noPromoter({ refInfluencerAttribution, refVendorAttribution })
  );

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_A,
    discountCodeScope: null,
    discountCodeCollectionSlug: null,
  });

  assert.equal(fields.vendorReferralCommissionOverrideBps, 500);
  assert.ok(fields.vendorReferralOwnSaleAttributedAt);
  assert.equal(fields.referrerVendorId, null);
  assert.equal(fields.referrerVendorCommissionBpsSnapshot, null);
});

test("B. Collection A -> produs propriu A, NU era în colecție: plan normal, zero atribuire", () => {
  const vendorCollectionAttribution = {
    vendorId: VENDOR_A,
    referralCodeSnapshot: "COLA",
    commissionBpsSnapshot: 2000,
    collectionId: "col-1",
    collectionSlug: "colectia-a",
    issuedAt: 100,
  };

  const effectiveVendorAttribution = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: null,
    refCollectionAttribution: vendorCollectionAttribution,
    shipmentVendorId: VENDOR_A,
    shipmentEligibleByCollectionMembership: false,
  });

  assert.equal(effectiveVendorAttribution, null);

  const snapshot = buildQuoteAttributionSnapshot({
    vendorCollectionAttribution,
    vendorCollectionProductWasMember: false,
    effectiveVendorAttribution,
  });

  assert.equal(snapshot.effectiveVendorAttribution, null);

  const { refInfluencerAttribution, refVendorAttribution } =
    resolvePassiveAttributionFromSnapshot(snapshot);

  assert.equal(refVendorAttribution, null);

  const promoter = resolveShipmentPromoter(
    noPromoter({ refInfluencerAttribution, refVendorAttribution })
  );

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_A,
    discountCodeScope: null,
    discountCodeCollectionSlug: null,
  });

  assert.equal(fields.vendorReferralCommissionOverrideBps, null);
  assert.equal(fields.referrerVendorId, null);
});

test("C. Collection A -> produs Vendor B: seller B normal, A primește referral earning", () => {
  const vendorCollectionAttribution = {
    vendorId: VENDOR_A,
    referralCodeSnapshot: "COLA",
    commissionBpsSnapshot: 2000,
    collectionId: "col-1",
    collectionSlug: "colectia-a",
    issuedAt: 100,
  };

  const effectiveVendorAttribution = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: null,
    refCollectionAttribution: vendorCollectionAttribution,
    shipmentVendorId: VENDOR_B,
    shipmentEligibleByCollectionMembership: true,
  });

  assert.ok(effectiveVendorAttribution);

  const snapshot = buildQuoteAttributionSnapshot({
    vendorCollectionAttribution,
    vendorCollectionProductWasMember: true,
    effectiveVendorAttribution,
  });

  const { refInfluencerAttribution, refVendorAttribution } =
    resolvePassiveAttributionFromSnapshot(snapshot);

  const promoter = resolveShipmentPromoter(
    noPromoter({ refInfluencerAttribution, refVendorAttribution })
  );

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_B,
    discountCodeScope: null,
    discountCodeCollectionSlug: null,
  });

  assert.equal(fields.referrerVendorId, VENDOR_A);
  assert.ok(fields.referrerVendorAttributedAt);
  assert.equal(fields.vendorReferralCommissionOverrideBps, null);
});

test("D. produs Vendor B NU era în colecție, dar traffic attribution valid: A tot primește referral (cross-vendor nu cere membership)", () => {
  const vendorCollectionAttribution = {
    vendorId: VENDOR_A,
    referralCodeSnapshot: "COLA",
    commissionBpsSnapshot: 2000,
    collectionId: "col-1",
    collectionSlug: "colectia-a",
    issuedAt: 100,
  };

  const effectiveVendorAttribution = resolveEffectiveRefVendorAttribution({
    refVendorAttribution: null,
    refCollectionAttribution: vendorCollectionAttribution,
    shipmentVendorId: VENDOR_B,
    shipmentEligibleByCollectionMembership: false,
  });

  assert.ok(effectiveVendorAttribution);

  const snapshot = buildQuoteAttributionSnapshot({
    vendorCollectionAttribution,
    vendorCollectionProductWasMember: false,
    effectiveVendorAttribution,
  });

  const { refInfluencerAttribution, refVendorAttribution } =
    resolvePassiveAttributionFromSnapshot(snapshot);

  const promoter = resolveShipmentPromoter(
    noPromoter({ refInfluencerAttribution, refVendorAttribution })
  );

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_B,
    discountCodeScope: null,
    discountCodeCollectionSlug: null,
  });

  assert.equal(fields.referrerVendorId, VENDOR_A);
});

test("Prioritate: cod explicit legat de un ALT vendor câștigă peste attribution-ul pasiv din snapshot, dar snapshot-ul istoric rămâne intact", () => {
  const snapshot = buildQuoteAttributionSnapshot({
    influencerAttribution: {
      influencerId: "inf-1",
      referralCodeSnapshot: "INF1",
      commissionBpsSnapshot: 1000,
    },
    effectiveVendorAttribution: {
      vendorId: VENDOR_A,
      referralCodeSnapshot: "COLA",
      commissionBpsSnapshot: 2000,
      collectionId: "col-1",
      collectionSlug: "colectia-a",
    },
  });

  assert.equal(snapshot.influencer.influencerId, "inf-1");
  assert.equal(snapshot.effectiveVendorAttribution.vendorId, VENDOR_A);

  const { refInfluencerAttribution, refVendorAttribution } =
    resolvePassiveAttributionFromSnapshot(snapshot);

  const discountCodeVendorAttribution = {
    vendorId: VENDOR_B,
    referralCodeSnapshot: "CODEB",
    commissionBpsSnapshot: 2000,
  };

  const promoter = resolveShipmentPromoter({
    shipmentWonByDiscountCode: true,
    shipmentEligibleForVendorAttributionByDiscountCode: true,
    shipmentEligibleForInfluencerByDiscountCode: false,
    discountCodeInfluencerAttribution: null,
    discountCodeVendorAttribution,
    refInfluencerAttribution,
    refVendorAttribution,
  });

  assert.equal(promoter.type, "VENDOR");
  assert.equal(promoter.vendor.vendorId, VENDOR_B);

  const fields = buildShipmentAttributionFields({
    promoter,
    shipmentVendorId: VENDOR_B,
    discountCodeScope: "VENDOR_ALL_PRODUCTS",
    discountCodeCollectionSlug: null,
  });

  assert.equal(fields.vendorReferralCommissionOverrideBps, 500);

  /*
   * Traffic source (istoric) vs commission winner (efectiv) -
   * snapshot-ul original din QuoteRequest NU se modifică niciodată.
   */
  assert.equal(snapshot.influencer.influencerId, "inf-1");
  assert.equal(snapshot.effectiveVendorAttribution.vendorId, VENDOR_A);
});

test("NU revalidează TTL - snapshot-ul înghețat e folosit direct, fără token, fără verificare de expirare", () => {
  const snapshot = buildQuoteAttributionSnapshot({
    influencerAttribution: {
      influencerId: "inf-old",
      referralCodeSnapshot: "OLD",
      commissionBpsSnapshot: 800,
    },
  });

  const { refInfluencerAttribution } =
    resolvePassiveAttributionFromSnapshot(snapshot);

  const promoter = resolveShipmentPromoter(
    noPromoter({ refInfluencerAttribution })
  );

  assert.equal(promoter.type, "INFLUENCER");
  assert.equal(promoter.influencer.influencerId, "inf-old");
});
