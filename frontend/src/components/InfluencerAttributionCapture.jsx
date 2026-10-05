// src/components/InfluencerAttributionCapture.jsx

/*
 * Captură globală a parametrilor de atribuire din URL, pe ORICE pagină -
 * component mic, montat o singură dată direct în <BrowserRouter>, care
 * reacționează la schimbarea rutei.
 *
 * Referral (influencer ȘI vendor): ?ref= (+ ?cref= - proprietarul unei
 * colecții de influencer). Tipul codului NU e cunoscut aici - codurile sunt
 * ținute DOAR în memoria aplicației (utils/referralMemory.js) și trimise la
 * checkout, unde serverul le validează și decide tipul
 * (services/referralAttribution.js).
 *
 * Colecție vendor: ?vcol=<slug> (refresh / tab nou pe produsul din colecție
 * sau pe /checkout) -> aceeași memorie de referral (vendorCollectionSlugs).
 *
 * Campanie vendor: ?camp=<slug> (refresh pe produsul din campanie / pe
 * /checkout) -> memoria de campanie (utils/campaignAttribution.js),
 * revalidată server-side (services/campaignAttribution.js).
 *
 * Fără request, fără localStorage / cookie, fără click tracking.
 * Consimțământ referral: politica unică ATTRIBUTION_REQUIRES_CONSENT
 * (config/features.js), aplicată în utils/referralMemory.js. Campaniile nu
 * depind de consimțământ.
 */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { captureReferralsFromUrl } from "../utils/influencerAttributionApp.js";
import { CAMPAIGN_PARAM, captureCampaignsFromSearch } from "../utils/campaignAttribution.js";
import { VENDOR_COLLECTION_PARAM } from "../utils/referralMemory.js";

export default function InfluencerAttributionCapture() {
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);

    if (params.has("ref") || params.has("cref") || params.has(VENDOR_COLLECTION_PARAM)) {
      captureReferralsFromUrl(location.search);
    }

    if (params.has(CAMPAIGN_PARAM)) {
      captureCampaignsFromSearch(location.search);
    }
  }, [location.search]);

  return null;
}
