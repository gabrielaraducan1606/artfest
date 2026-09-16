// src/utils/vendorReferralAttribution.js

/*
 * Atribuire de referral VENDOR - mirror STRUCTURAL al
 * utils/influencerAttribution.js, dar cheie SEPARATĂ de
 * localStorage și fișier separat (fișierul influencer NU e
 * atins - cerință explicită).
 *
 * O SINGURĂ cheie globală (nu per-vendor) - atribuirea prin
 * ?ref= e per-sesiune/vizitator, nu per-vendor promovat.
 *
 * NU e cheia "artfest.referralCode" folosită de Register.jsx
 * (programul Ambassador, vendor-recomandă-vendor-nou) - sistem
 * complet separat.
 *
 * Tokenul salvat aici e doar un HINT pentru checkout - serverul
 * revalidează mereu vendorul fresh din DB înainte să facă vreun
 * snapshot pe Shipment (vezi backend/src/services/vendorAttribution.js).
 */

const STORAGE_KEY = "artfest.vendorReferralAttribution";

function readEntry() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeEntry(entry) {
  try {
    if (!entry) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage indisponibil (mod privat etc.) - degradăm silențios.
  }
}

function isExpired(entry, now = Date.now()) {
  if (!entry?.expiresAt) return true;
  const expiresAt = new Date(entry.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

/**
 * Apelat de VendorReferralAttributionCapture.jsx după ce backend-ul
 * confirmă referralCode-ul valid și întoarce un attributionToken.
 * Last-click-wins global - un link de vendor nou accesat suprascrie
 * atribuirea anterioară.
 */
export function storeVendorReferralAttribution({
  token,
  vendorId,
  referralCode,
  attributionWindowHours,
}) {
  if (!token) return;

  const windowHours = Math.max(1, Number(attributionWindowHours) || 168);

  const expiresAt = new Date(
    Date.now() + windowHours * 60 * 60 * 1000
  ).toISOString();

  writeEntry({
    token,
    vendorId: vendorId || null,
    referralCode: referralCode || null,
    capturedAt: new Date().toISOString(),
    expiresAt,
  });
}

/**
 * Tokenul curent, gata de trimis ca `vendorReferralAttribution` în
 * body-ul de checkout - sau `null` dacă nu există/a expirat.
 */
export function getVendorReferralAttributionForCheckout() {
  const entry = readEntry();

  if (!entry) return null;

  if (isExpired(entry)) {
    writeEntry(null);
    return null;
  }

  return entry.token || null;
}
