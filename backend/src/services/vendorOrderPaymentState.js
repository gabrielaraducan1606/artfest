// backend/src/services/vendorOrderPaymentState.js

/*
 * Mutat NESCHIMBAT din routes/vendorOrdersRoutes.js (audit AWB 2026-09-30),
 * ca să poată fi refolosit și de generarea AWB (couriers/awb) fără să
 * importăm tot routerul de comenzi. Sursă unică pentru regula
 * „CARD online neplătit” - vendorOrdersRoutes.js îl importă de aici.
 */

/* ----------------------------------------------------
   Helper: status plată pentru vendor

   Important:
   - comenzile manuale CARD create de vendor nu sunt
     confundate automat cu plățile Stripe;
   - considerăm CARD online dacă există user/guest
     sau identificatori Stripe.
----------------------------------------------------- */

export function computeVendorOrderPaymentState(
  order
) {
  const paymentMethod =
    String(
      order?.paymentMethod ||
        ""
    )
      .trim()
      .toUpperCase();

  const orderStatus =
    String(
      order?.status ||
        ""
    )
      .trim()
      .toUpperCase();

  const isCard =
    paymentMethod ===
    "CARD";

  const isOnlineCard =
    isCard &&
    (
      Boolean(
        order?.userId
      ) ||
      order?.isGuestOrder ===
        true ||
      Boolean(
        order?.stripeCheckoutSessionId
      ) ||
      Boolean(
        order?.stripePaymentIntentId
      ) ||
      Boolean(
        order?.paidAt
      )
    );

  const isPaid =
    isOnlineCard &&
    (
      orderStatus ===
        "PAID" ||
      Boolean(
        order?.paidAt
      )
    );

  const paymentStatus =
    paymentMethod ===
    "COD"
      ? "COD"
      : !isOnlineCard
        ? "CARD"
        : isPaid
          ? "PAID"
          : "PENDING";

  const waitingForCardPayment =
    isOnlineCard &&
    !isPaid;

  return {
    paymentMethod,

    paymentStatus,

    isOnlineCard,

    paid:
      isPaid,

    waitingForCardPayment,

    canProcess:
      !waitingForCardPayment,
  };
}
