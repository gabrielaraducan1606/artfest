// src/utils/promotionContext.js
//
// Contextul de promoție din navigarea curentă, trimis endpoint-urilor de
// PREȚ (produs, listări, coș, sumar, validare cod) - aceeași memorie ca la
// checkout, fără storage:
//  - campaignSlugs           (VendorCampaign legacy; campaniile migrate sunt
//                             mapate pe server la colecția lor);
//  - vendorCollectionSlugs   (VendorCollection: reducerea colecției, DOAR pe
//                             produsele proprii ale ownerului, finanțată de vendor).

import { buildCampaignSlugsApiQuery, getCampaignSlugsForCheckout } from "./campaignAttribution.js";
import { getReferralCheckoutFields } from "./referralMemory.js";

function vendorCollectionSlugList() {
  const entries = getReferralCheckoutFields().vendorCollectionSlugs || [];
  return entries.map((e) => (typeof e === "string" ? e : e?.slug)).filter(Boolean);
}

// query pentru GET-uri: "campaignSlugs=a&vendorCollectionSlugs=x%2Cy" sau ""
export function buildPromotionApiQuery() {
  const parts = [];
  const campaignQuery = buildCampaignSlugsApiQuery();
  if (campaignQuery) parts.push(campaignQuery);

  const collections = vendorCollectionSlugList();
  if (collections.length) parts.push(`vendorCollectionSlugs=${encodeURIComponent(collections.join(","))}`);

  return parts.join("&");
}

// câmpuri pentru body-uri POST (coș merge, sumar guest, validare cod)
export function getPromotionBodyFields() {
  return {
    campaignSlugs: getCampaignSlugsForCheckout(),
    vendorCollectionSlugs: getReferralCheckoutFields().vendorCollectionSlugs,
  };
}
