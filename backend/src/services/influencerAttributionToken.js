// backend/src/services/influencerAttributionToken.js

/*
 * Token de atribuire pentru influenceri - mirror STRUCTURAL al
 * campaignAttributionToken.js, dar în fișier SEPARAT (concepte
 * diferite: comision Artfest redus per shipment la campanii,
 * remunerație influencer aici - nu trebuie amestecate).
 *
 * Emis de GET /api/public/influencer/attribution?ref=CODE la
 * detectarea reală a linkului de referral, semnat server-side
 * (JWT). Clientul îl păstrează și îl retrimite la checkout - dar
 * NU e sursă de adevăr singură: checkout-ul revalidează mereu
 * influencerul direct din DB (status ACTIVE) înainte să facă
 * vreun snapshot pe Shipment.
 *
 * Fereastra de atribuire e FIXĂ (nu configurabilă per influencer,
 * spre deosebire de campanii) - reutilizează convenția existentă
 * de 168h/7 zile.
 */

import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "dev-secret-change-me";

const PURPOSE =
  "influencer_attribution";

export const INFLUENCER_ATTRIBUTION_WINDOW_HOURS = 168;

export function signInfluencerAttributionToken({
  influencerId,
  referralCode,
}) {
  return jwt.sign(
    {
      purpose: PURPOSE,
      influencerId,
      referralCode,
    },
    JWT_SECRET,
    {
      expiresIn: `${INFLUENCER_ATTRIBUTION_WINDOW_HOURS}h`,
    }
  );
}

/*
 * Nu aruncă niciodată - un token invalid/expirat înseamnă doar
 * "nicio atribuire", nu o eroare de request (fail-open, la fel
 * ca la campanii).
 */
export function verifyInfluencerAttributionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded?.purpose !== PURPOSE) {
      return null;
    }

    if (!decoded.influencerId || !decoded.referralCode) {
      return null;
    }

    return {
      influencerId: String(decoded.influencerId),
      referralCode: String(decoded.referralCode),
    };
  } catch {
    return null;
  }
}
