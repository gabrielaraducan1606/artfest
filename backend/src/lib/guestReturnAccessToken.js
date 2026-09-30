// backend/src/lib/guestReturnAccessToken.js
//
// Token de acces pentru URMĂRIREA retururilor unei comenzi guest, trimis în
// emailurile de status ale returului (/retur-guest/:orderId?returnToken=...).
//
// Același tipar ca guestPaymentAccessToken.js:
// - NU se salvează în DB (fără câmp Prisma nou) - e semnat cu JWT_SECRET;
// - permite DOAR: vizualizarea cererilor de retur ale comenzii din JWT și
//   răspunsul la mesajele vânzătorului. NU permite crearea unei cereri noi
//   și nici accesul la restul comenzii (pentru asta e nevoie de tokenul
//   original al comenzii, din emailul de confirmare).

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET is required in production");
}

const TOKEN_TYPE = "guest_return_access";

const EXPIRES_IN = "60d";

export function createGuestReturnAccessToken({ orderId }) {
  if (!orderId) throw new Error("orderId is required");

  return jwt.sign({ type: TOKEN_TYPE, orderId: String(orderId) }, JWT_SECRET, {
    expiresIn: EXPIRES_IN,
  });
}

// { type, orderId, iat, exp } sau null (nu aruncă)
export function verifyGuestReturnAccessToken(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return null;

  try {
    const payload = jwt.verify(normalized, JWT_SECRET);
    if (payload?.type !== TOKEN_TYPE || !payload?.orderId) return null;
    return payload;
  } catch {
    return null;
  }
}
