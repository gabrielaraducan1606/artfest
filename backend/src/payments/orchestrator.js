// backend/src/payments/orchestrator.js
/**
 * Orchestrator TEMP (fără importuri externe).
 * - Exportă: chooseRail, startPayment, createPaymentForOrder
 * - Nu importă netopia/stripe/health/rails.config (ca să nu crape serverul)
 * - Este tolerant la semnături diferite (vechi vs nou)
 */

const DEFAULT_APP_ORIGIN =
  process.env.APP_ORIGIN ||
  process.env.FRONTEND_URL ||
  "http://localhost:5173";

function truthy(v) {
  if (v === true) return true;
  if (typeof v === "string") return ["1", "true", "yes", "on"].includes(v.toLowerCase());
  return false;
}

function hasStripeKeys() {
  return !!process.env.STRIPE_SECRET_KEY;
}

function hasNetopiaKeys() {
  // Pune aici env-urile tale reale dacă vrei, momentan e tolerant:
  // return !!process.env.NETOPIA_SIGNATURE && !!process.env.NETOPIA_PUBLIC_KEY;
  return !!process.env.NETOPIA_KEY || !!process.env.NETOPIA_SIGNATURE || !!process.env.NETOPIA_PUBLIC_KEY;
}

/**
 * chooseRail — acceptă 2 stiluri:
 * 1) stil NOU (din subscriptionRoutes): { applePay, googlePay, plan, period, ... }
 * 2) stil VECHI (din orchestratorul tău): { userCountry, currency, vendorPrefs, walletHints }
 *
 * Returnează string: "stripe" | "netopia"
 */
export async function chooseRail(input = {}) {
  // --- Normalizează input (nou + vechi) ---
  const userCountry = (input.userCountry || "RO").toString().toUpperCase();
  const currency = (input.currency || (input.plan?.currency ?? "RON")).toString().toUpperCase();

  // wallet hints (nou: applePay/googlePay; vechi: walletHints.applePay/googlePay)
  const applePay = truthy(input.applePay ?? input.walletHints?.applePay);
  const googlePay = truthy(input.googlePay ?? input.walletHints?.googlePay);

  // preferință explicită vendor (vechi)
  const vendorPrefer = input.vendorPrefs?.prefer;

  // --- Logică minimală, fără health checks ---
  // 1) Preferință vendor, dacă are cheile necesare
  if (vendorPrefer === "stripe" && hasStripeKeys()) return "stripe";
  if (vendorPrefer === "netopia" && hasNetopiaKeys()) return "netopia";

  // 2) Dacă wallet hints și ai Stripe keys -> Stripe
  if ((applePay || googlePay) && hasStripeKeys()) return "stripe";

  // 3) RO+RON -> Netopia dacă există keys, altfel Stripe dacă există keys
  if (userCountry === "RO" && currency === "RON") {
    if (hasNetopiaKeys()) return "netopia";
    if (hasStripeKeys()) return "stripe";
  }

  // 4) Fallback: Stripe dacă există, altfel Netopia dacă există
  if (hasStripeKeys()) return "stripe";
  if (hasNetopiaKeys()) return "netopia";

  // 5) Nimic configurat
  return "stripe"; // fallback harmless; startPayment va întoarce ok:false cu mesaj clar
}

/**
 * startPayment — tolerant la 2 semnături:
 *
 * A) NOU (din subscriptionRoutes):
 *    startPayment({ rail, vendorId, userId, planCode, period, appOrigin })
 *
 * B) VECHI (din orchestratorul tău):
 *    startPayment({ rail, plan, period, vendor, user, subscription, amountRON, description })
 *
 * Returnează un obiect JSON "safe" pentru UI.
 */
export async function startPayment(args = {}) {
  const rail = args.rail || "stripe";
  const appOrigin = args.appOrigin || DEFAULT_APP_ORIGIN;

  // Detectare stil NOU
  const isNewShape = !!(args.vendorId && args.userId && args.planCode);

  if (rail === "stripe") {
    if (!hasStripeKeys()) {
      return {
        ok: false,
        rail: "stripe",
        code: "payments_not_configured",
        message: "Stripe not configured (missing STRIPE_SECRET_KEY).",
        upgradeUrl: `${appOrigin}/onboarding/details?tab=plata&stripe=setup`,
      };
    }

    // TEMP: până implementezi stripe subscriptions real
    if (isNewShape) {
      return {
        ok: false,
        rail: "stripe",
        code: "stripe_subscriptions_not_implemented",
        message: "Stripe subscription checkout not implemented yet.",
        // unde vrei să trimiți userul în UI
        upgradeUrl: `${appOrigin}/onboarding/details?tab=plata&stripe=todo`,
      };
    }

    // stil VECHI — tot return safe
    return {
      ok: false,
      rail: "stripe",
      code: "stripe_not_implemented",
      message: "Stripe payment flow not implemented yet.",
      upgradeUrl: `${appOrigin}/onboarding/details?tab=plata&stripe=todo`,
    };
  }

  if (rail === "netopia") {
    if (!hasNetopiaKeys()) {
      return {
        ok: false,
        rail: "netopia",
        code: "payments_not_configured",
        message: "Netopia not configured (missing NETOPIA env keys).",
        upgradeUrl: `${appOrigin}/onboarding/details?tab=plata&netopia=setup`,
      };
    }

    // TEMP: până implementezi netopia
    return {
      ok: false,
      rail: "netopia",
      code: "netopia_not_implemented",
      message: "Netopia payment flow not implemented yet.",
      upgradeUrl: `${appOrigin}/onboarding/details?tab=plata&netopia=todo`,
    };
  }

  // fallback safe
  return {
    ok: false,
    rail,
    code: "unsupported_rail",
    message: `Unsupported rail: ${rail}`,
    upgradeUrl: `${appOrigin}/onboarding/details?tab=plata`,
  };
}

/**
 * createPaymentForOrder(order)
 * - păstrează API-ul tău existent
 * - returnează { provider, redirectUrl } fără să depindă de Stripe/Netopia modules
 */
export async function createPaymentForOrder(order) {
  const currency = (order?.currency || "RON").toUpperCase();
  const rail = await chooseRail({ userCountry: "RO", currency });

  const appOrigin = DEFAULT_APP_ORIGIN;

  // TEMP: returnează un redirect intern/placeholder
  // Când implementezi real, aici vei crea Checkout Session și vei întoarce url-ul Stripe/Netopia.
  if (rail === "stripe") {
    if (!hasStripeKeys()) {
      return {
        provider: "stripe",
        redirectUrl: `${appOrigin}/checkout/error?code=stripe_not_configured`,
      };
    }
    return {
      provider: "stripe",
      redirectUrl: `${appOrigin}/checkout/error?code=stripe_not_implemented`,
    };
  }

  if (rail === "netopia") {
    if (!hasNetopiaKeys()) {
      return {
        provider: "netopia",
        redirectUrl: `${appOrigin}/checkout/error?code=netopia_not_configured`,
      };
    }
    return {
      provider: "netopia",
      redirectUrl: `${appOrigin}/checkout/error?code=netopia_not_implemented`,
    };
  }

  return {
    provider: "unknown",
    redirectUrl: `${appOrigin}/checkout/error?code=unsupported_rail`,
  };
}
