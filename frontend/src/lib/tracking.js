// src/lib/tracking.js
import { api } from "./api";
import {
  hasAnalyticsConsent,
  hasAttributionConsent,
} from "./cookieConsent.js";

/*
 * BUGFIX (Cookies v2 §12 / audit legal) - af_sess_id e folosit
 * atât pentru statistici de vizitator (Analytics), cât și ca
 * sessionId trimis de componentele de captare a atribuirii
 * (influencer/vendor referral) - deci se activează doar dacă
 * userul a acceptat cel puțin una din categoriile "Statistici" sau
 * "Atribuire recomandări". Fără niciuna dintre ele, NU generăm și
 * NU persistăm un identificator - funcțiile de tracking de mai jos
 * pur și simplu nu trimit evenimentul.
 */
export function getSessionId() {
  try {
    if (!hasAnalyticsConsent() && !hasAttributionConsent()) {
      return null;
    }

    const k = "af_sess_id";
    let id = localStorage.getItem(k);
    if (!id) {
      id = (crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`);
      localStorage.setItem(k, id);
    }
    return id;
  } catch { return null; }
}

function basePayload(vendorId, extra = {}) {
  const sessionId = getSessionId();
  if (!sessionId) return null;

  return {
    vendorId,
    pageUrl: typeof window !== "undefined" ? window.location.pathname : undefined,
    referrer: typeof document !== "undefined" ? document.referrer : undefined,
    sessionId,
    ...extra,
  };
}

// ------------- evenimente -------------
export async function trackPageview(vendorId, extra = {}) {
  if (!vendorId) return;
  const payload = basePayload(vendorId, extra);
  if (!payload) return;
  try { await api("/api/visitors/track", { method: "POST", body: { ...payload, type: "PAGEVIEW" } }); } catch {""}
}

export async function trackCTA(vendorId, ctaLabel, extra = {}) {
  if (!vendorId) return;
  const payload = basePayload(vendorId, extra);
  if (!payload) return;
  try { await api("/api/visitors/track", { method: "POST", body: { ...payload, type: "CTA_CLICK", ctaLabel } }); } catch {""}
}

export async function trackMessage(vendorId, ctaLabel = "Mesaj", extra = {}) {
  if (!vendorId) return;
  const payload = basePayload(vendorId, extra);
  if (!payload) return;
  try { await api("/api/visitors/track", { method: "POST", body: { ...payload, type: "MESSAGE", ctaLabel } }); } catch {""}
}

// opțional: log de căutare internă pe magazin (public, cu vendorId)
export async function logVendorSearch(vendorId, query, hits = 1) {
  if (!vendorId || !query) return;
  if (!hasAnalyticsConsent() && !hasAttributionConsent()) return;
  try { await api("/api/visitors/search", { method: "POST", body: { vendorId, query, hits } }); } catch {""}
}
