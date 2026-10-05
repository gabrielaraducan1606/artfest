// src/utils/influencerAttributionApp.js
//
// Legătura dintre URL-uri și memoria de referral (./referralMemory.js),
// fără request și fără stocare:
//  - components/InfluencerAttributionCapture.jsx -> ?ref= / ?cref= din URL
//    (influencer SAU vendor - tipul îl decide serverul la checkout);
//  - pages/Influencer/PublicInfluencerCollectionPage -> proprietarul colecției
//    vizitate fără ?ref= (fallback de colecție);
//  - linkurile produselor din colecție și Coș -> /checkout.

import {
  COLLECTION_REF_PARAM,
  REF_PARAM,
  buildCheckoutReferralQuery,
  captureCollectionReferralCode,
  captureReferralsFromSearch,
} from "./referralMemory.js";

export { buildCheckoutReferralQuery };

// parametrii ?ref= / ?cref= (și legacy refSource=collection) din URL
export function captureReferralsFromUrl(search) {
  return captureReferralsFromSearch(search);
}

// proprietarul colecției de influencer (fallback de colecție)
// eslint-disable-next-line no-unused-vars
export function captureInfluencerReferral(referralCode, pageUrl) {
  return captureCollectionReferralCode(referralCode);
}

/*
 * Query-ul pentru linkurile produselor dintr-o colecție de influencer:
 *  - URL-ul colecției are ?ref= explicit -> îl propagăm (rămâne explicit);
 *  - altfel -> ?cref= al proprietarului (fallback de colecție), ca
 *    deschiderea unui produs (inclusiv în tab nou / refresh) să păstreze
 *    atribuirea fără să suprascrie un ?ref= explicit.
 */
export function buildCollectionProductLinkQuery({ urlRef, ownerReferralCode }) {
  const explicit = String(urlRef || "").trim();
  if (explicit) return `${REF_PARAM}=${encodeURIComponent(explicit)}`;

  const owner = String(ownerReferralCode || "").trim();
  if (!owner) return "";
  return `${COLLECTION_REF_PARAM}=${encodeURIComponent(owner)}`;
}
