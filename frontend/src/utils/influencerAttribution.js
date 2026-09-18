// src/utils/influencerAttribution.js

/*
 * Atribuire de referral influencer - mirror STRUCTURAL al
 * utils/campaignAttribution.js, dar cheie SEPARATĂ de
 * localStorage și fișier separat (concepte diferite, nu trebuie
 * amestecate).
 *
 * O SINGURĂ cheie globală (nu per-vendor ca la campanii) -
 * atribuirea de influencer e per-sesiune/vizitator, nu per-vendor.
 *
 * IMPORTANT: NU e cheia "artfest.referralCode" folosită de
 * Register.jsx (programul Ambassador, vendor-recomandă-vendor) -
 * sisteme complet separate, deși ambele pornesc de la un query
 * param `?ref=`.
 *
 * Tokenul salvat aici e doar un HINT pentru checkout - serverul
 * revalidează mereu influencerul fresh din DB înainte să facă
 * vreun snapshot pe Shipment (vezi
 * backend/src/services/influencerAttribution.js).
 */

import { hasAttributionConsent } from "../lib/cookieConsent.js";

const STORAGE_KEY = "artfest.influencerAttribution";

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
 * Apelat de InfluencerAttributionCapture.jsx după ce backend-ul
 * confirmă referralCode-ul valid și întoarce un attributionToken.
 * Last-click-wins global - un link de influencer nou accesat
 * suprascrie atribuirea anterioară.
 */
export function storeInfluencerAttribution({
  token,
  influencerId,
  referralCode,
  attributionWindowHours,
}) {
  if (!token) return;

  /*
   * BUGFIX (Cookies v2 §11.2 / audit legal) - token-ul de
   * atribuire NU se scrie în localStorage fără consimțământul
   * categoriei "Atribuire recomandări".
   */
  if (!hasAttributionConsent()) return;

  const windowHours = Math.max(
    1,
    Number(attributionWindowHours) || 168
  );

  const expiresAt = new Date(
    Date.now() + windowHours * 60 * 60 * 1000
  ).toISOString();

  writeEntry({
    token,
    influencerId: influencerId || null,
    referralCode: referralCode || null,
    capturedAt: new Date().toISOString(),
    expiresAt,
  });
}

/**
 * Tokenul curent, gata de trimis ca `influencerAttribution` în
 * body-ul de checkout - sau `null` dacă nu există/a expirat.
 */
export function getInfluencerAttributionForCheckout() {
  if (!hasAttributionConsent()) {
    writeEntry(null);
    return null;
  }

  const entry = readEntry();

  if (!entry) return null;

  if (isExpired(entry)) {
    writeEntry(null);
    return null;
  }

  return entry.token || null;
}
