// src/lib/tracking.js
import { api } from "./api";

// ------------- sesiune unică pe vizitator -------------
function getSessionId() {
  try {
    const k = "af_sess_id";
    let id = localStorage.getItem(k);
    if (!id) {
      id = (crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`);
      localStorage.setItem(k, id);
    }
    return id;
  } catch { return `${Date.now()}_${Math.random().toString(16).slice(2)}`; }
}

function basePayload(vendorId, extra = {}) {
  return {
    vendorId,
    pageUrl: typeof window !== "undefined" ? window.location.pathname : undefined,
    referrer: typeof document !== "undefined" ? document.referrer : undefined,
    sessionId: getSessionId(),
    ...extra,
  };
}

// ------------- evenimente -------------
export async function trackPageview(vendorId, extra = {}) {
  if (!vendorId) return;
  try { await api("/api/visitors/track", { method: "POST", body: { ...basePayload(vendorId, extra), type: "PAGEVIEW" } }); } catch {""}
}

export async function trackCTA(vendorId, ctaLabel, extra = {}) {
  if (!vendorId) return;
  try { await api("/api/visitors/track", { method: "POST", body: { ...basePayload(vendorId, extra), type: "CTA_CLICK", ctaLabel } }); } catch {""}
}

export async function trackMessage(vendorId, ctaLabel = "Mesaj", extra = {}) {
  if (!vendorId) return;
  try { await api("/api/visitors/track", { method: "POST", body: { ...basePayload(vendorId, extra), type: "MESSAGE", ctaLabel } }); } catch {""}
}

// opțional: log de căutare internă pe magazin (public, cu vendorId)
export async function logVendorSearch(vendorId, query, hits = 1) {
  if (!vendorId || !query) return;
  try { await api("/api/visitors/search", { method: "POST", body: { vendorId, query, hits } }); } catch {""}
}
