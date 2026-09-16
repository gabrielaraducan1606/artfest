// src/components/VendorReferralAttributionCapture.jsx

/*
 * Captură globală a linkului de referral VENDOR (?ref=<referralCode>),
 * pe ORICE pagină - mirror STRUCTURAL al InfluencerAttributionCapture.jsx.
 *
 * Montată SEPARAT, alături de <InfluencerAttributionCapture /> (NU
 * o înlocuiește, NU o modifică) - fișierul influencer rămâne
 * neatins, per cerință explicită.
 *
 * Ambele componente ascultă ACELAȘI query param `?ref=` (un cod nu
 * poate aparține simultan unui influencer și unui vendor - spațiile
 * de coduri sunt separate în DB) - fiecare interoghează backend-ul
 * ei propriu; dacă niciun vendor nu are acel cod, backend-ul
 * răspunde 404 și nu se salvează nimic aici (fail-open, ca la
 * influencer).
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { api } from "../lib/api.js";
import { getSessionId } from "../lib/tracking.js";
import { storeVendorReferralAttribution } from "../utils/vendorReferralAttribution.js";

export default function VendorReferralAttributionCapture() {
  const location = useLocation();
  const lastCapturedRef = useRef("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const referralCode = params.get("ref");

    if (!referralCode) return;

    if (lastCapturedRef.current === referralCode) return;
    lastCapturedRef.current = referralCode;

    let cancelled = false;

    const query = new URLSearchParams({
      ref: referralCode,
      sessionId: getSessionId(),
      pageUrl: window.location.pathname,
    });

    api(`/api/public/vendor-referral/attribution?${query.toString()}`)
      .then((res) => {
        if (cancelled || !res?.ok || !res?.attributionToken) return;

        storeVendorReferralAttribution({
          token: res.attributionToken,
          vendorId: res.vendor?.id,
          referralCode: res.vendor?.referralCode,
          attributionWindowHours: res.attributionWindowHours,
        });
      })
      .catch(() => {
        /*
         * Fail-open - un cod invalid/inexistent (ex. e cod de
         * influencer, nu de vendor) nu trebuie să afecteze
         * navigarea în niciun fel.
         */
      });

    return () => {
      cancelled = true;
    };
  }, [location.search]);

  return null;
}
