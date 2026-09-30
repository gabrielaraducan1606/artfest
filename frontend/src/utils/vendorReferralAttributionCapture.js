// src/utils/vendorReferralAttributionCapture.js
//
// Captura ?ref= pentru referral de VENDOR - aceeași logică și aceleași reguli
// de consimțământ ca la influenceri (./referralAttributionCapture.js). Aici
// doar forma payload-ului salvat.

import { createReferralAttributionCapture } from "./referralAttributionCapture.js";

export function createVendorReferralAttributionCapture(options) {
  return createReferralAttributionCapture({
    ...options,
    toStorePayload: (res) => ({
      token: res.attributionToken,
      vendorId: res.vendor?.id,
      referralCode: res.vendor?.referralCode,
      attributionWindowHours: res.attributionWindowHours,
    }),
  });
}
