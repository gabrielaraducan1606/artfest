// src/utils/influencerAttributionCapture.js
//
// Captura ?ref= pentru INFLUENCERI - logica comună e în
// ./referralAttributionCapture.js (consimțământ „Atribuire”, cod ținut doar în
// memorie până la `cookie:consent`, marcare doar după salvarea tokenului,
// fără request-uri duplicate). Aici doar forma payload-ului salvat.

import { createReferralAttributionCapture } from "./referralAttributionCapture.js";

export { COOKIE_CONSENT_EVENT } from "./referralAttributionCapture.js";

export function createInfluencerAttributionCapture(options) {
  return createReferralAttributionCapture({
    ...options,
    toStorePayload: (res) => ({
      token: res.attributionToken,
      influencerId: res.influencer?.id,
      referralCode: res.influencer?.referralCode,
      attributionWindowHours: res.attributionWindowHours,
    }),
  });
}
