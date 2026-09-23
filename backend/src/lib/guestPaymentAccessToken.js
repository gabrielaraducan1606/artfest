// backend/src/lib/guestPaymentAccessToken.js
//
// Token de acces temporar pentru reluarea plății CARD a unei comenzi
// guest, folosit de reminder-ul automat de plată neterminată
// (src/jobs/guestPaymentReminderJob.js) și de pagina publică
// /comanda-guest/:id (?paymentToken=...).
//
// IMPORTANT:
// - NU se salvează niciun hash al acestui token în DB (spre deosebire
//   de guestAccessTokenHash) - e semnat cu JWT_SECRET și verificat
//   direct, la fel ca tokenul de avans (guest_deposit_access) din
//   guestOrderRoutes.js.
// - Permite acces DOAR la comanda indicată de `orderId` din JWT.

import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET;

if (
  !JWT_SECRET &&
  process.env.NODE_ENV ===
    "production"
) {
  throw new Error(
    "JWT_SECRET is required in production"
  );
}

const TOKEN_TYPE =
  "guest_payment_access";

const EXPIRES_IN =
  "7d";

/* =========================================================
   createGuestPaymentAccessToken({ orderId })
========================================================= */

export function createGuestPaymentAccessToken({
  orderId,
}) {
  if (!orderId) {
    throw new Error(
      "orderId is required"
    );
  }

  return jwt.sign(
    {
      type:
        TOKEN_TYPE,

      orderId:
        String(
          orderId
        ),
    },

    JWT_SECRET,

    {
      expiresIn:
        EXPIRES_IN,
    }
  );
}

/* =========================================================
   verifyGuestPaymentAccessToken(token)

   Întoarce payload-ul ({ type, orderId, iat, exp }) dacă
   tokenul este valid, semnat corect, neexpirat și de tipul
   așteptat - altfel `null` (nu aruncă).
========================================================= */

export function verifyGuestPaymentAccessToken(
  token
) {
  const normalized =
    String(
      token || ""
    ).trim();

  if (!normalized) {
    return null;
  }

  try {
    const payload =
      jwt.verify(
        normalized,
        JWT_SECRET
      );

    if (
      payload?.type !==
      TOKEN_TYPE
    ) {
      return null;
    }

    if (
      !payload?.orderId
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
