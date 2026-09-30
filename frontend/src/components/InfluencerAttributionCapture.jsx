// src/components/InfluencerAttributionCapture.jsx

/*
 * Captură globală a linkului de referral influencer
 * (?ref=<referralCode>), pe ORICE pagină - mirror al
 * ScrollManager.jsx (component mic, montat o singură dată direct
 * în <BrowserRouter>, care reacționează la schimbarea rutei).
 *
 * Spre deosebire de campaniile vendor (captură STRICT pe pagina
 * de destinație /c/:slug), linkurile de influencer trebuie să
 * funcționeze de pe orice pagină (ex. homepage, /selectii/:slug,
 * produs) - token semnat server-side, revalidat la checkout.
 *
 * Consimțământ „Atribuire” (vezi utils/influencerAttributionCapture.js):
 * fără el NU se apelează endpoint-ul (care înregistrează click-ul) și
 * NU se salvează token; dacă vizitatorul nu a răspuns încă la banner,
 * codul e ținut doar în memorie și captura se reia la `cookie:consent`.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { api } from "../lib/api.js";
import { getSessionId } from "../lib/tracking.js";
import {
  hasAnyDecision,
  hasAttributionConsent,
} from "../lib/cookieConsent.js";
import { storeInfluencerAttribution } from "../utils/influencerAttribution.js";
import { createInfluencerAttributionCapture } from "../utils/influencerAttributionCapture.js";

function requestInfluencerAttribution({ referralCode, pageUrl }) {
  const query = new URLSearchParams({ ref: referralCode });

  // fără sessionId -> nu trimitem textul "null" (ar contopi vizitatori
  // diferiți la deduplicarea click-urilor)
  const sessionId = getSessionId();
  if (sessionId) query.set("sessionId", sessionId);
  if (pageUrl) query.set("pageUrl", pageUrl);

  return api(`/api/public/influencer/attribution?${query.toString()}`);
}

export default function InfluencerAttributionCapture() {
  const location = useLocation();

  /*
   * Controller-ul trăiește cât componenta (useRef, nu useEffect) - în
   * StrictMode efectele rulează de două ori, dar starea (cod în
   * așteptare / capturat / request în curs) rămâne una singură, deci
   * fără request-uri duplicate.
   */
  const controllerRef = useRef(null);

  if (!controllerRef.current) {
    controllerRef.current = createInfluencerAttributionCapture({
      requestAttribution: requestInfluencerAttribution,
      storeAttribution: storeInfluencerAttribution,
      hasConsent: hasAttributionConsent,
      hasDecision: hasAnyDecision,
    });
  }

  useEffect(() => controllerRef.current.attach(window), []);

  useEffect(() => {
    const referralCode = new URLSearchParams(location.search).get("ref");
    if (!referralCode) return;

    // pagina de aterizare (ex. /selectii/:slug), păstrată și dacă
    // consimțământul vine după navigare
    controllerRef.current.handleRef(referralCode, location.pathname);
  }, [location.search, location.pathname]);

  return null;
}
