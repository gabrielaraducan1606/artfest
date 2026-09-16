// backend/src/services/vendorCollectionAttributionToken.js

/*
 * Token de atribuire pentru trafic VendorCollection - mirror
 * STRUCTURAL al vendorAttributionToken.js (referral ?ref=), fișier
 * separat (concept diferit: sursa e vizitarea unei colecții, nu un
 * link de referral direct).
 *
 * Emis la GET /api/public/vendor-collections/:slug (vendorCollectionsRoutes.js),
 * la fiecare încărcare a paginii publice a colecției. Clientul îl
 * păstrează și îl retrimite la checkout - dar NU e sursă de adevăr
 * singură: checkout-ul revalidează mereu colecția + vendorul-
 * proprietar fresh din DB (isActive pe ambele) înainte să facă vreun
 * snapshot pe Shipment (vezi resolveVendorCollectionAttribution din
 * vendorAttribution.js).
 *
 * Fereastra de atribuire (audit 2026-09-15, decizie business):
 * IDENTICĂ cu cea de la referral vendor - 168h/7 zile.
 */

import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "dev-secret-change-me";

const PURPOSE =
  "vendor_collection_attribution";

export const VENDOR_COLLECTION_ATTRIBUTION_WINDOW_HOURS = 168;

export function signVendorCollectionAttributionToken({
  collectionId,
  ownerVendorId,
}) {
  return jwt.sign(
    {
      purpose: PURPOSE,
      collectionId,
      ownerVendorId,
    },
    JWT_SECRET,
    {
      expiresIn: `${VENDOR_COLLECTION_ATTRIBUTION_WINDOW_HOURS}h`,
    }
  );
}

/*
 * Nu aruncă niciodată - un token invalid/expirat înseamnă doar
 * "nicio atribuire", nu o eroare de request (fail-open, identic cu
 * referral vendor). Întoarce și `issuedAt` (din claim-ul JWT `iat`,
 * secunde -> ms) - necesar pentru regula "global last click wins"
 * între acest token și cel de referral ?ref= (vezi chekoutRoutes.js).
 */
export function verifyVendorCollectionAttributionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded?.purpose !== PURPOSE) {
      return null;
    }

    if (!decoded.collectionId || !decoded.ownerVendorId) {
      return null;
    }

    return {
      collectionId: String(decoded.collectionId),
      ownerVendorId: String(decoded.ownerVendorId),
      issuedAt:
        typeof decoded.iat === "number"
          ? decoded.iat * 1000
          : null,
    };
  } catch {
    return null;
  }
}
