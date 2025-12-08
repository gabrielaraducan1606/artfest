// src/payments/orchestrator.js
import { startNetopia, startNetopiaOrder } from "./netopia.js";
import { startStripe } from "./stripe.js";
import { railsConfig } from "./rails.config.js";
import { isNetopiaHealthy, isStripeHealthy } from "./health.js";

/**
 * Alege rail-ul de plată în funcție de țară, monedă, preferințe și wallet hints.
 * Poți rafina logica oricând.
 */
export async function chooseRail({
  userCountry = "RO",
  currency = "RON",
  vendorPrefs = {},
  walletHints = {},
}) {
  const hasStripeKeys = !!process.env.STRIPE_SECRET_KEY;

  // 1) Dacă e RO + RON -> Netopia (dacă e sănătos)
  if (
    String(userCountry).toUpperCase() === "RO" &&
    String(currency).toUpperCase() === "RON" &&
    (await isNetopiaHealthy())
  ) {
    return "netopia";
  }

  // 2) Dacă utilizatorul are ApplePay/GooglePay și ai Stripe configurat -> Stripe
  if (
    hasStripeKeys &&
    (await isStripeHealthy()) &&
    (walletHints.applePay || walletHints.googlePay)
  ) {
    return "stripe";
  }

  // 3) Preferință explicită vendor
  if (vendorPrefs?.prefer && ["stripe", "netopia"].includes(vendorPrefs.prefer))
    return vendorPrefs.prefer;

  // 4) Fallback: Stripe dacă este configurat și sănătos, altfel Netopia
  if (hasStripeKeys && (await isStripeHealthy())) return "stripe";
  if (await isNetopiaHealthy()) return "netopia";

  throw new Error("Niciun provider de plată nu este disponibil.");
}

/**
 * Flow-ul tău existent pentru abonamente – îl păstrăm.
 */
export async function startPayment({
  rail,
  plan,
  period,
  vendor,
  user,
  subscription,
  amountRON,
  description,
}) {
  switch (rail) {
    case "netopia":
      return startNetopia({
        plan,
        period,
        vendor,
        user,
        subscription,
        amountRON,
        description,
      });
    case "stripe":
      return startStripe({
        plan,
        period,
        vendor,
        user,
        subscription,
        amountRON,
        description,
      });
    default:
      return startNetopia({
        plan,
        period,
        vendor,
        user,
        subscription,
        amountRON,
        description,
      });
  }
}

/**
 * ⬇️ NOU: inițiere plată pentru o comandă (checkout clasic).
 * Order vine din Prisma (tabela Order).
 */
export async function createPaymentForOrder(order) {
  const currency = (order.currency || "RON").toUpperCase();

  // simplu: folosim auto/Netopia pentru RON
  let rail = railsConfig.default;
  if (rail === "auto") {
    rail = await chooseRail({
      userCountry: "RO", // dacă vei salva țara în shippingAddress, o poți lua de acolo
      currency,
    });
  }

  if (rail === "netopia") {
    const { url, provider } = await startNetopiaOrder({ order });
    return {
      provider,
      redirectUrl: url,
    };
  }

  if (rail === "stripe") {
    const { url } = await startStripe({ order });
    return {
      provider: "stripe",
      redirectUrl: url,
    };
  }

  throw new Error(`Rail necunoscut: ${rail}`);
}
