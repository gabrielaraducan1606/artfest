// src/components/VendorReferralAttributionCapture.jsx

/*
 * Captură globală a linkului de referral VENDOR (?ref=<referralCode>),
 * pe ORICE pagină - mirror STRUCTURAL al InfluencerAttributionCapture.jsx.
 *
 * Montată SEPARAT, alături de <InfluencerAttributionCapture />. Ambele
 * componente ascultă ACELAȘI query param `?ref=` (un cod nu poate aparține
 * simultan unui influencer și unui vendor - spațiile de coduri sunt separate
 * în DB) - fiecare interoghează backend-ul ei propriu; dacă niciun vendor nu
 * are acel cod, backend-ul răspunde 404 și codul e ignorat (fără reîncercări).
 *
 * Consimțământ „Atribuire” (aceeași logică ca la influenceri, vezi
 * utils/referralAttributionCapture.js): fără el NU se apelează endpoint-ul
 * (care înregistrează VendorReferralClick) și NU se salvează token; dacă
 * vizitatorul nu a răspuns încă la banner, codul e ținut doar în memorie și
 * captura se reia la `cookie:consent`.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { api } from "../lib/api.js";
import { getSessionId } from "../lib/tracking.js";
import {
  hasAnyDecision,
  hasAttributionConsent,
} from "../lib/cookieConsent.js";
import { storeVendorReferralAttribution } from "../utils/vendorReferralAttribution.js";
import { createVendorReferralAttributionCapture } from "../utils/vendorReferralAttributionCapture.js";

function requestVendorReferralAttribution({ referralCode, pageUrl }) {
  const query = new URLSearchParams({ ref: referralCode });

  // fără sessionId -> nu trimitem textul "null" (ar contopi vizitatori
  // diferiți la deduplicarea click-urilor)
  const sessionId = getSessionId();
  if (sessionId) query.set("sessionId", sessionId);
  if (pageUrl) query.set("pageUrl", pageUrl);

  return api(`/api/public/vendor-referral/attribution?${query.toString()}`);
}

export default function VendorReferralAttributionCapture() {
  const location = useLocation();

  // o singură stare per aplicație (useRef) - fără request-uri duplicate în
  // StrictMode sau la evenimente repetate de consimțământ
  const controllerRef = useRef(null);

  if (!controllerRef.current) {
    controllerRef.current = createVendorReferralAttributionCapture({
      requestAttribution: requestVendorReferralAttribution,
      storeAttribution: storeVendorReferralAttribution,
      hasConsent: hasAttributionConsent,
      hasDecision: hasAnyDecision,
    });
  }

  useEffect(() => controllerRef.current.attach(window), []);

  useEffect(() => {
    const referralCode = new URLSearchParams(location.search).get("ref");
    if (!referralCode) return;

    controllerRef.current.handleRef(referralCode, location.pathname);
  }, [location.search, location.pathname]);

  return null;
}
