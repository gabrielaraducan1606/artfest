// src/utils/vendorCollectionAttribution.js

/*
 * Atribuire de trafic VendorCollection (audit 2026-09-15, persistent
 * attribution) - mirror STRUCTURAL al utils/vendorReferralAttribution.js
 * (?ref=), dar cheie SEPARATĂ de localStorage, fișier separat.
 *
 * O SINGURĂ cheie globală (nu per-colecție) - vizitarea unei colecții
 * noi suprascrie atribuirea anterioară de colecție (last-click-wins
 * LOCAL; regula GLOBALĂ, între acest token și cel de ?ref=, se decide
 * server-side la checkout, comparând `iat`-ul semnat al fiecărui
 * token - vezi resolveEffectiveRefVendorAttribution, chekoutRoutes.js).
 *
 * Tokenul salvat aici e doar un HINT pentru checkout - serverul
 * revalidează mereu colecția + vendorul-proprietar fresh din DB
 * înainte să facă vreun snapshot pe Shipment (vezi
 * resolveVendorCollectionAttribution, vendorAttribution.js).
 */

const STORAGE_KEY = "artfest.vendorCollectionAttribution";

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
 * Apelat la încărcarea paginii publice a unei VendorCollection, după
 * ce backend-ul întoarce collection + attributionToken (vezi
 * GET /api/public/vendor-collections/:slug, vendorCollectionsRoutes.js).
 * Last-click-wins local - o colecție nouă vizitată suprascrie
 * atribuirea anterioară de colecție.
 *
 * NU se șterge la refresh/logout/coș nou/după prima comandă - rămâne
 * validă până expiră natural (7 zile) sau e suprascrisă de o vizită
 * mai nouă.
 */
export function storeVendorCollectionAttribution({
  token,
  collectionId,
  collectionSlug,
  attributionWindowHours,
}) {
  if (!token) return;

  const windowHours = Math.max(1, Number(attributionWindowHours) || 168);

  const expiresAt = new Date(
    Date.now() + windowHours * 60 * 60 * 1000
  ).toISOString();

  writeEntry({
    token,
    collectionId: collectionId || null,
    collectionSlug: collectionSlug || null,
    capturedAt: new Date().toISOString(),
    expiresAt,
  });
}

/**
 * Tokenul curent, gata de trimis ca `vendorCollectionAttribution` în
 * body-ul de checkout - sau `null` dacă nu există/a expirat.
 */
export function getVendorCollectionAttributionForCheckout() {
  const entry = readEntry();

  if (!entry) return null;

  if (isExpired(entry)) {
    writeEntry(null);
    return null;
  }

  return entry.token || null;
}
