import { stripe } from "./stripe.client.js";
import { handleSuccessfulPayment } from "./stripe.payouts.service.js";

export async function stripeWebhookHandler(req, res) {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send("Webhook error");
  }

  if (event.type === "checkout.session.completed") {
    await handleSuccessfulPayment(event.data.object);
  }

  res.json({ received: true });
}
