// src/payments/vendorStripeStatus.js
//
// Sursă unică de adevăr pentru "vendorul are Stripe activ".
//
// Condiția canonică (identică peste tot unde se decide dacă un
// vendor poate încasa plăți CARD/avans online): vendorul trebuie să
// aibă cont Stripe Connect, cu charges + payouts + onboarding
// complete, ȘI statusul nostru intern trebuie să fie "enabled".
import { prisma } from "../db.js";

export const VENDOR_STRIPE_STATUS_SELECT = {
  stripeAccountId: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeDetailsSubmitted: true,
  stripeConnectStatus: true,
};

export function isVendorStripeReady(vendor) {
  return (
    Boolean(vendor?.stripeAccountId) &&
    vendor?.stripeChargesEnabled === true &&
    vendor?.stripePayoutsEnabled === true &&
    vendor?.stripeDetailsSubmitted === true &&
    vendor?.stripeConnectStatus === "enabled"
  );
}

/*
 * Pentru summary-ul de checkout: CARD e disponibil doar dacă TOȚI
 * vendorii din comandă/coș sunt Stripe-ready. Fără vendori
 * relevanți (coș gol) considerăm CARD disponibil - oricum nu se
 * poate plasa o comandă goală.
 */
export function computeCardPaymentAvailability(vendors = []) {
  if (!Array.isArray(vendors) || vendors.length === 0) return true;
  return vendors.every((vendor) => isVendorStripeReady(vendor));
}

export const VENDOR_STRIPE_NOT_ACTIVE_MESSAGE =
  "Plata online nu este disponibilă momentan pentru toate produsele din această comandă. Te rugăm să alegi plata ramburs.";

export const VENDOR_NOT_FOUND_MESSAGE =
  "Plata online nu poate fi inițiată pentru această comandă. Te rugăm să alegi plata ramburs.";

/*
 * Eroare coerentă, reutilizată de orice flux care încearcă o plată
 * CARD (creare comandă, retry payment, accept ofertă) - codul
 * "vendor_stripe_not_active" e cel deja folosit în producție, NU
 * inventăm alt cod.
 */
export class CardPaymentUnavailableError extends Error {
  constructor(code = "vendor_stripe_not_active", message = VENDOR_STRIPE_NOT_ACTIVE_MESSAGE) {
    super(message);
    this.name = "CardPaymentUnavailableError";
    this.code = code;
    this.status = 400;
  }
}

/*
 * Verificare server-side OBLIGATORIE înainte de a crea orice
 * PaymentIntent/Checkout Session CARD pentru o comandă deja
 * persistată (are shipments). Nu presupune că starea Stripe de la
 * crearea comenzii mai este valabilă - reîncarcă vendorii curenți.
 *
 * Aruncă CardPaymentUnavailableError dacă oricare vendor din
 * comandă nu (mai) este Stripe-ready.
 */
export async function assertOrderCardPaymentAllowed(orderId) {
  const shipments = await prisma.shipment.findMany({
    where: { orderId },
    select: { vendorId: true },
  });

  const vendorIds = [
    ...new Set(shipments.map((s) => s.vendorId).filter(Boolean)),
  ];

  if (!vendorIds.length) return;

  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
    select: VENDOR_STRIPE_STATUS_SELECT,
  });

  if (vendors.length !== vendorIds.length) {
    throw new CardPaymentUnavailableError("vendor_not_found", VENDOR_NOT_FOUND_MESSAGE);
  }

  if (!computeCardPaymentAvailability(vendors)) {
    throw new CardPaymentUnavailableError();
  }
}
