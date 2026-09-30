// src/utils/campaignAttributionCapture.js
//
// Salvarea atribuirii de CAMPANIE vendor (/c/:slug și modalul de campanie)
// cu aceeași regulă de consimțământ ca referral-urile (influencer / vendor):
//
//  - consimțământ „Atribuire” dat -> tokenul se salvează imediat
//    (storeCampaignAttribution, mecanismul existent, per vendor);
//  - încă fără decizie la banner -> contextul campaniei (tokenul primit deja
//    odată cu datele paginii) e ținut DOAR în memorie, per vendor, și se
//    salvează la `cookie:consent` cu attribution=true;
//  - refuz / retragere -> contextul din memorie e abandonat (tokenul local e
//    șters deja de saveConsent -> clearAttributionStorage);
//  - atribuirea e considerată finalizată DOAR după salvarea confirmată.
//
// Nu face niciun request propriu: tokenul vine din răspunsul paginii
// (GET /api/public/campaigns/...), deci evenimentele repetate de consimțământ
// sau navigarea nu pot genera request-uri duplicate.

import { hasAnyDecision, hasAttributionConsent } from "../lib/cookieConsent.js";
import { storeCampaignAttribution } from "./campaignAttribution.js";
import { COOKIE_CONSENT_EVENT } from "./referralAttributionCapture.js";

export function createCampaignAttributionCapture({
  storeAttribution, // (payload) => boolean (true = token scris)
  hasConsent, // () => boolean, consimțământ „Atribuire”
  hasDecision, // () => boolean, a răspuns deja la banner
}) {
  // vendorId -> payload (last-click-wins per vendor, ca în storage)
  const pending = new Map();

  function offer(payload) {
    const vendorId = String(payload?.vendorId || "");
    if (!vendorId || !payload?.token) return false;

    if (hasConsent()) {
      pending.delete(vendorId);
      return storeAttribution(payload) === true;
    }

    // a refuzat deja atribuirea -> nimic de ținut minte
    if (hasDecision()) {
      pending.delete(vendorId);
      return false;
    }

    pending.set(vendorId, payload);
    return false;
  }

  function handleConsent(detail) {
    const attribution = detail ? detail.attribution === true : hasConsent();

    if (!attribution) {
      pending.clear();
      return 0;
    }

    let stored = 0;
    for (const payload of pending.values()) {
      if (storeAttribution(payload) === true) stored += 1;
    }
    pending.clear();
    return stored;
  }

  function attach(target) {
    const listener = (event) => {
      handleConsent(event?.detail);
    };

    target.addEventListener(COOKIE_CONSENT_EVENT, listener);
    return () => target.removeEventListener(COOKIE_CONSENT_EVENT, listener);
  }

  return {
    offer,
    handleConsent,
    attach,
    // doar pentru teste / diagnostic
    getPendingVendorIds: () => [...pending.keys()],
  };
}

/*
 * Instanța aplicației: una singură, atașată o dată la window - contextul
 * din memorie supraviețuiește navigării în afara paginii campaniei (ex.
 * vizitatorul acceptă cookie-urile pe altă pagină, înainte de checkout).
 */
let appCapture = null;

export function offerCampaignAttribution(payload) {
  if (!appCapture) {
    appCapture = createCampaignAttributionCapture({
      storeAttribution: storeCampaignAttribution,
      hasConsent: hasAttributionConsent,
      hasDecision: hasAnyDecision,
    });

    if (typeof window !== "undefined" && window.addEventListener) {
      appCapture.attach(window);
    }
  }

  return appCapture.offer(payload);
}
