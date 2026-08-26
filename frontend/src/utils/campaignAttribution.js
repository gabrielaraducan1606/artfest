// src/utils/campaignAttribution.js

/*
 * Atribuire de campanie, per vendor, în localStorage.
 *
 * De ce nu o singură cheie globală (ca la referralCode din
 * Register.jsx): campania Vendorului A NU trebuie să șteargă
 * atribuirea Vendorului B dacă vizitatorul accesează ambele
 * link-uri într-o sesiune. Fiecare vendor are propriul slot,
 * suprascris doar când e accesat DIN NOU link-ul ACELUIAȘI
 * vendor (last-click-wins per vendor).
 *
 * Tokenul salvat aici e doar un HINT pentru checkout - server-ul
 * revalidează mereu campania fresh din DB înainte să aplice
 * orice discount/comision redus (vezi
 * backend/src/services/campaignAttribution.js).
 */

const STORAGE_KEY = "artfest.campaignAttribution";

function readMap() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage indisponibil (mod privat etc.) - degradăm silențios,
    // pur și simplu nu se salvează atribuirea.
  }
}

function isExpired(entry, now = Date.now()) {
  if (!entry?.expiresAt) return true;
  const expiresAt = new Date(entry.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

/**
 * Apelat la accesarea /c/:slug (după ce backend-ul confirmă
 * campania validă și întoarce un attributionToken).
 */
export function storeCampaignAttribution({
  vendorId,
  token,
  campaignId,
  slug,
  attributionWindowHours,
}) {
  if (!vendorId || !token) return;

  const windowHours = Math.max(1, Number(attributionWindowHours) || 168);
  const expiresAt = new Date(
    Date.now() + windowHours * 60 * 60 * 1000
  ).toISOString();

  const map = readMap();

  map[String(vendorId)] = {
    token,
    campaignId: campaignId || null,
    slug: slug || null,
    capturedAt: new Date().toISOString(),
    expiresAt,
  };

  writeMap(map);
}

/**
 * { [vendorId]: attributionToken } - gata de trimis ca
 * `campaignAttribution` în body-ul de checkout. Elimină automat
 * intrările expirate.
 */
export function getAttributionsForCheckout() {
  const map = readMap();
  const now = Date.now();
  const result = {};
  let changed = false;

  for (const [vendorId, entry] of Object.entries(map)) {
    if (isExpired(entry, now)) {
      changed = true;
      continue;
    }

    if (entry?.token) {
      result[vendorId] = entry.token;
    }
  }

  if (changed) {
    const pruned = {};
    for (const [vendorId, entry] of Object.entries(map)) {
      if (!isExpired(entry, now)) pruned[vendorId] = entry;
    }
    writeMap(pruned);
  }

  return result;
}
