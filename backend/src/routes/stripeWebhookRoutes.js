// src/routes/stripeWebhook.routes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { stripe } from "../payments/stripe.js";
import { computeOrderSplits, allocateStripeFee, computeVendorPayouts } from "../payments/marketplaceCalc.js";

const router = Router();

/**
 * IMPORTANT:
 * - această rută trebuie montată cu express.raw({type:'application/json'})
 * - altfel signature verification pică
 */
router.post("/stripe/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error("[stripe webhook] signature fail:", err?.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // idempotency guard (DB)
  try {
    await prisma.stripeEvent.create({
      data: {
        eventId: event.id,
        type: event.type,
        livemode: !!event.livemode,
        payload: event.data?.object ?? {},
      },
    });
  } catch (e) {
    // duplicate event => OK
    return res.json({ received: true, duplicate: true });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = session?.metadata?.orderId;
      if (!orderId) throw new Error("missing_orderId_metadata");

      // PaymentIntent id
      const piId = session.payment_intent;
      if (piId) {
        await prisma.order.update({
          where: { id: orderId },
          data: { stripePaymentIntentId: String(piId) },
        });
      }
    }

    if (event.type === "payment_intent.succeeded") {
      const pi = event.data.object;
      const orderId = pi?.metadata?.orderId;
      if (!orderId) throw new Error("missing_orderId_metadata");

      // fetch charge to get fee
      const charges = pi.charges?.data || [];
      const charge = charges[0];
      const chargeId = charge?.id;

      // fee is on balance_transaction
      let feeNet = 0;
      if (charge?.balance_transaction) {
        const bt = await stripe.balanceTransactions.retrieve(String(charge.balance_transaction));
        feeNet = Math.abs((bt.fee || 0) / 100);
      }

      // mark order paid (idempotent)
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) throw new Error("order_not_found");

      if (order.status !== "PAID") {
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status: "PAID",
            paidAt: new Date(),
            stripeChargeId: chargeId ? String(chargeId) : null,
          },
        });
      }

      // compute splits
      const splits = await computeOrderSplits({ orderId });
      const vendorsWithFee = allocateStripeFee({ vendors: splits.vendors, feeNet });
      const payouts = computeVendorPayouts({ vendors: vendorsWithFee });

      // load vendor stripeAccountId
      const vendorIds = payouts.map((p) => p.vendorId);
      const vendors = await prisma.vendor.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, stripeAccountId: true },
      });
      const stripeByVendor = new Map(vendors.map((v) => [v.id, v.stripeAccountId || null]));

      // create transfers (only for connected vendors)
      for (const p of payouts) {
        const acct = stripeByVendor.get(p.vendorId);
        if (!acct) {
          console.warn("[payout] vendor has no stripeAccountId:", p.vendorId);
          continue;
        }

        const amountCents = Math.round(Number(p.vendorPayoutNet || 0) * 100);
        if (!Number.isFinite(amountCents) || amountCents <= 0) continue;

        const transfer = await stripe.transfers.create({
          amount: amountCents,
          currency: (splits.order.currency || "RON").toLowerCase(),
          destination: acct,
          transfer_group: `order_${orderId}`,
          metadata: {
            orderId,
            vendorId: p.vendorId,
          },
        });

        // log earning entry (simplificat)
        await prisma.vendorEarningEntry.create({
          data: {
            vendorId: p.vendorId,
            orderId,
            type: "SALE",
            currency: splits.order.currency || "RON",
            itemsNet: p.itemsNet,
            commissionNet: p.commissionNet,
            vendorNet: p.vendorPayoutNet,
            stripeTransferId: transfer.id,
            meta: {
              stripeFeeAllocated: p.stripeFeeAllocated,
              shippingNet: p.shippingNet,
              commissionBps: p.commissionBps,
              planCode: p.planCode,
            },
          },
        });
      }

      // aici poți crea Invoice PLATFORM_TO_CLIENT în DB (dacă vrei)
      // await createPlatformInvoiceForClient({ orderId, feeNet, payouts })

    }

    await prisma.stripeEvent.updateMany({
      where: { eventId: event.id },
      data: { processedAt: new Date() },
    });

    return res.json({ received: true });
  } catch (e) {
    console.error("[stripe webhook] handler error:", e);
    await prisma.stripeEvent.updateMany({
      where: { eventId: event.id },
      data: { error: String(e?.message || e), processedAt: new Date() },
    });
    return res.status(500).json({ error: "webhook_handler_failed" });
  }
});

export default router;
