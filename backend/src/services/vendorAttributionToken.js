// backend/src/services/vendorAttributionToken.js

/*
 * Token de atribuire pentru referral VENDOR (vendor ca promotor) -
 * mirror STRUCTURAL al influencerAttributionToken.js, fișier
 * separat (concept diferit: vendorul poate fi el însuși promotorul,
 * nu doar beneficiarul unui comision redus ca la campanii).
 *
 * Emis de GET /api/public/vendor-referral/attribution?ref=CODE la
 * detectarea unui link de referral vendor, semnat server-side
 * (JWT). Clientul îl păstrează și îl retrimite la checkout - dar
 * NU e sursă de adevăr singură: checkout-ul revalidează mereu
 * vendorul fresh din DB (isActive, referralCommissionBps) înainte
 * să facă vreun snapshot pe Shipment.
 *
 * Fereastra de atribuire e FIXĂ, aceeași convenție ca la influencer
 * (168h/7 zile).
 */

import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "dev-secret-change-me";

const PURPOSE =
  "vendor_referral_attribution";

export const VENDOR_REFERRAL_ATTRIBUTION_WINDOW_HOURS = 168;

export function signVendorReferralAttributionToken({
  vendorId,
  referralCode,
}) {
  return jwt.sign(
    {
      purpose: PURPOSE,
      vendorId,
      referralCode,
    },
    JWT_SECRET,
    {
      expiresIn: `${VENDOR_REFERRAL_ATTRIBUTION_WINDOW_HOURS}h`,
    }
  );
}

/*
 * Nu aruncă niciodată - un token invalid/expirat înseamnă doar
 * "nicio atribuire", nu o eroare de request (fail-open, la fel
 * ca la campanii/influenceri).
 */
export function verifyVendorReferralAttributionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded?.purpose !== PURPOSE) {
      return null;
    }

    if (!decoded.vendorId || !decoded.referralCode) {
      return null;
    }

    return {
      vendorId: String(decoded.vendorId),
      referralCode: String(decoded.referralCode),

      /*
       * audit 2026-09-15 - necesar pentru regula "global last click
       * wins" între acest token și cel de atribuire VendorCollection
       * (vezi chekoutRoutes.js). Adăugare aditivă - apelanții
       * existenți care destructurează doar {vendorId, referralCode}
       * nu sunt afectați.
       */
      issuedAt:
        typeof decoded.iat === "number"
          ? decoded.iat * 1000
          : null,
    };
  } catch {
    return null;
  }
}
