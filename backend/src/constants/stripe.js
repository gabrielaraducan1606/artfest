export const STRIPE_CURRENCY = "ron";

export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "payment_intent.succeeded",
  "charge.refunded",
  "account.updated",
  // pentru abonamente:
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
];
