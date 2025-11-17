// src/payments/rails.config.js
export const railsConfig = {
  default: "auto",           // "stripe" | "netopia" | "auto"
  abTestPctStripeInRO: 0.2,  // 20% Stripe în RO (A/B test)
  preferNetopiaRON: true,    // preferă Netopia pentru RON + user din RO
  preferStripeWallets: true, // preferă Stripe dacă detectăm Apple/Google Pay
};
