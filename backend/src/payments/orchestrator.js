// src/payments/orchestrator.js
import { startNetopia } from "./netopia.js";
import { startStripe } from "./stripe.js";

/**
 * Alege rail-ul de plată în funcție de țară, monedă, preferințe și wallet hints.
 * Poți rafina logica oricând.
 */
export async function chooseRail({ userCountry = "RO", currency = "RON", vendorPrefs = {}, walletHints = {} }) {
  const hasStripeKeys =
    !!process.env.STRIPE_SECRET_KEY &&
    !!process.env.STRIPE_PRICE_MONTH_EUR &&
    !!process.env.STRIPE_PRICE_YEAR_EUR;

  // 1) Dacă e RO + RON -> Netopia
  if (String(userCountry).toUpperCase() === "RO" && String(currency).toUpperCase() === "RON")
    return "netopia";

  // 2) Dacă utilizatorul are ApplePay/GooglePay și ai Stripe configurat -> Stripe
  if (hasStripeKeys && (walletHints.applePay || walletHints.googlePay))
    return "stripe";

  // 3) Dacă vendorul a setat preferință explicită (ex: "stripe" / "netopia")
  if (vendorPrefs?.prefer && ["stripe", "netopia"].includes(vendorPrefs.prefer))
    return vendorPrefs.prefer;

  // 4) Fallback: dacă Stripe e configurat, stripe; altfel netopia
  if (hasStripeKeys) return "stripe";
  return "netopia";
}

/**
 * Pornește plata pe rail-ul ales. Întoarce { url, provider } pentru redirect din FE.
 * NOTĂ: Pentru Netopia aici e încă mock până implementezi criptarea/semnarea.
 */
export async function startPayment({
  rail,
  plan,          // SubscriptionPlan Prisma
  period,        // "month" | "year"
  vendor,        // Vendor Prisma
  user,          // user din JWT
  subscription,  // VendorSubscription Prisma
  amountRON,     // număr (lei) calculat de ruta ta
  description,   // ex: "Abonament Pro (month)"
}) {
  switch (rail) {
    case "netopia":
      return startNetopia({ plan, period, vendor, user, subscription, amountRON, description });
    case "stripe":
      return startStripe({ plan, period, vendor, user, subscription, amountRON, description });
    default:
      // fallback de siguranță
      return startNetopia({ plan, period, vendor, user, subscription, amountRON, description });
  }
}
