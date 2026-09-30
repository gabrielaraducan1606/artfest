// backend/src/lib/guestOrderAccessToken.js
//
// Token STATELESS de acces guest la o comandă + retururile ei, trimis în
// emailul „predat curierului” (/comanda-guest/:id?orderToken=... și
// /retur-guest/:id?orderToken=...).
//
// Același tipar ca guestPaymentAccessToken.js / guestReturnAccessToken.js:
// - NU se salvează în DB și NU atinge guestAccessTokenHash, deci nu
//   invalidează linkurile din emailurile anterioare (fără câmp Prisma nou);
// - payload strict: { type: "guest_order_return", orderId };
// - valabil cel mult până la expirarea accesului guest al comenzii
//   (guestAccessExpiresAt, 90 de zile de la plasare) - nu prelungește
//   accesul existent;
// - permite DOAR: vizualizarea comenzii (inclusiv statusul livrării) și
//   fluxul guest de retur (cerere nouă după DELIVERED, poze, urmărire,
//   răspuns). NU permite plata, avansul sau retragerea din contract - pentru
//   acestea rămâne tokenul original al comenzii.

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET is required in production");
}

export const GUEST_ORDER_ACCESS_PURPOSE = "guest_order_return";

// aceeași durată ca accesul guest de la checkout (guestAccessExpiresAt)
const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60;

/*
 * expiresAt: expirarea accesului guest al comenzii (guestAccessExpiresAt).
 * Întoarce null dacă accesul a expirat deja - apelantul nu afișează link.
 */
export function createGuestOrderAccessToken({ orderId, expiresAt = null, now = Date.now() }) {
  if (!orderId) throw new Error("orderId is required");

  const nowSec = Math.floor(now / 1000);
  let exp = nowSec + DEFAULT_TTL_SECONDS;

  if (expiresAt) {
    const limitSec = Math.floor(new Date(expiresAt).getTime() / 1000);
    if (!Number.isFinite(limitSec) || limitSec <= nowSec) return null;
    exp = Math.min(exp, limitSec);
  }

  return jwt.sign(
    { type: GUEST_ORDER_ACCESS_PURPOSE, orderId: String(orderId), iat: nowSec, exp },
    JWT_SECRET
  );
}

// { type, orderId, iat, exp } sau null (nu aruncă): semnătură, expirare, purpose
export function verifyGuestOrderAccessToken(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return null;

  try {
    const payload = jwt.verify(normalized, JWT_SECRET);
    if (payload?.type !== GUEST_ORDER_ACCESS_PURPOSE || !payload?.orderId) return null;
    return payload;
  } catch {
    return null;
  }
}
