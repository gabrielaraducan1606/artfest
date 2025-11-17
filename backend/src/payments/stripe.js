// src/payments/rails/stripe.js
export async function startStripe() {
  // Stripe real necesită:
  // - STRIPE_SECRET_KEY
  // - prețuri recurente (ex: STRIPE_PRICE_MONTH_EUR, STRIPE_PRICE_YEAR_EUR)
  // - success/cancel URLs (spre APP_ORIGIN)
  // - webhook pentru evenimentele de plată/abonamente
  throw new Error("Stripe nu este configurat. Configurează cheile și implementează createCheckoutSession.");
}
