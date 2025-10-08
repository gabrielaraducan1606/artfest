// src/lib/cookiesConsent.js
const KEY = "cookie:consent:v1"; // { necessary:true, analytics:boolean, marketing:boolean, timestamp }

export const defaultConsent = { necessary: true, analytics: false, marketing: false };

export function readConsent() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultConsent };
    const obj = JSON.parse(raw);
    return {
      necessary: true,
      analytics: !!obj.analytics,
      marketing: !!obj.marketing,
      timestamp: obj.timestamp || Date.now(),
    };
  } catch {
    return { ...defaultConsent };
  }
}

export function saveConsent(partial) {
  const v = { ...defaultConsent, ...readConsent(), ...partial, timestamp: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(v));
  // declanșează un event pentru inițializări/dezactivări tag-uri
  try { window.dispatchEvent(new CustomEvent("cookie:consent", { detail: v })); } catch {""}
  return v;
}

export function hasAnyDecision() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}
