// src/components/InfluencerAttributionCapture.jsx

/*
 * Captură globală a linkului de referral influencer
 * (?ref=<referralCode>), pe ORICE pagină - mirror al
 * ScrollManager.jsx (component mic, montat o singură dată direct
 * în <BrowserRouter>, care reacționează la schimbarea rutei).
 *
 * Spre deosebire de campaniile vendor (captură STRICT pe pagina
 * de destinație /c/:slug), linkurile de influencer trebuie să
 * funcționeze de pe orice pagină (ex. homepage) - de-aia nu
 * există un precedent identic de reutilizat, doar principiul
 * (token semnat server-side, revalidat la checkout).
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { api } from "../lib/api.js";
import { getSessionId } from "../lib/tracking.js";
import { storeInfluencerAttribution } from "../utils/influencerAttribution.js";

export default function InfluencerAttributionCapture() {
  const location = useLocation();
  const lastCapturedRef = useRef("");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const referralCode = params.get("ref");

    if (!referralCode) return;

    /*
     * Evită re-capturarea la fiecare navigare cât timp URL-ul
     * încă poartă același ?ref= (ex. navigare internă care
     * păstrează query string-ul) - o singură cerere per cod nou.
     */
    if (lastCapturedRef.current === referralCode) return;
    lastCapturedRef.current = referralCode;

    let cancelled = false;

    const query = new URLSearchParams({
      ref: referralCode,
      sessionId: getSessionId(),
      pageUrl: window.location.pathname,
    });

    api(`/api/public/influencer/attribution?${query.toString()}`)
      .then((res) => {
        if (cancelled || !res?.ok || !res?.attributionToken) return;

        storeInfluencerAttribution({
          token: res.attributionToken,
          influencerId: res.influencer?.id,
          referralCode: res.influencer?.referralCode,
          attributionWindowHours: res.attributionWindowHours,
        });
      })
      .catch(() => {
        /*
         * Fail-open - un cod invalid/expirat/inactiv nu trebuie
         * să afecteze navigarea în niciun fel.
         */
      });

    return () => {
      cancelled = true;
    };
  }, [location.search]);

  return null;
}
