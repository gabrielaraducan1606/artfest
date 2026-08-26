// backend/src/services/campaignAttributionToken.js

/*
 * Token de atribuire pentru campanii vendor.
 *
 * Emis de GET /api/public/campaigns/:slug la accesarea reală
 * a linkului public, semnat server-side (JWT). Clientul îl
 * păstrează (per vendor) și îl retrimite la checkout - dar
 * NU e sursă de adevăr singură: checkout-ul revalidează mereu
 * campania direct din DB (isActive/expirare/vendor activ)
 * înainte să aplice orice discount/comision redus.
 *
 * Scop: clientul nu poate falsifica singur "am accesat linkul
 * campaniei X" fără ca serverul să fi emis chiar el tokenul.
 */

import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "dev-secret-change-me";

const PURPOSE =
  "campaign_attribution";

/*
 * Plafon de siguranță, indiferent de
 * attributionWindowHours configurat pe campanie.
 */
const MAX_WINDOW_HOURS =
  24 * 30;

export function signCampaignAttributionToken({
  campaignId,
  vendorId,
  slug,
  attributionWindowHours,
}) {
  const windowHours =
    Math.min(
      MAX_WINDOW_HOURS,
      Math.max(
        1,
        Number(attributionWindowHours) || 168
      )
    );

  return jwt.sign(
    {
      purpose: PURPOSE,
      campaignId,
      vendorId,
      slug,
    },
    JWT_SECRET,
    {
      expiresIn: `${windowHours}h`,
    }
  );
}

/*
 * Nu aruncă niciodată - un token invalid/expirat
 * înseamnă doar "nicio atribuire", nu o eroare de request.
 */
export function verifyCampaignAttributionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded?.purpose !== PURPOSE) {
      return null;
    }

    if (!decoded.campaignId || !decoded.vendorId) {
      return null;
    }

    return {
      campaignId: String(decoded.campaignId),
      vendorId: String(decoded.vendorId),
      slug: decoded.slug || null,
    };
  } catch {
    return null;
  }
}
