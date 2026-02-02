import { prisma } from "../lib/prisma.js";
import { stripe } from "../payments/stripe.client.js";
import { PAYOUT_DELAY_DAYS, PAYOUT_ONLY_AFTER_DELIVERY } from "../constants/billing.js";

export async function runVendorPayoutsJob() {
  // 1) selectăm entries eligibile
  const entries = await prisma.vendorEarningEntry.findMany({
    where: {
      type: "SALE",
      payoutId: null,
      // opțional: doar cele cu shipment livrat
      ...(PAYOUT_ONLY_AFTER_DELIVERY
        ? { shipment: { status: "DELIVERED" } }
        : {}),
    },
    include: { vendor: true, shipment: true },
    orderBy: { occurredAt: "asc" },
  });

  // 2) aplicăm delay (ex: deliveredAt + 3 zile)
  const eligible = entries.filter(e => {
    if (!PAYOUT_ONLY_AFTER_DELIVERY) return true;
    if (!e.shipment?.deliveredAt) return false;
    const ms = PAYOUT_DELAY_DAYS * 24 * 3600 * 1000;
    return Date.now() - new Date(e.shipment.deliveredAt).getTime() > ms;
  });

  // 3) group by vendor
  const byVendor = new Map();
  for (const e of eligible) {
    if (!e.vendor?.stripeAccountId) continue; // vendor ne-onboarded => skip
    const list = byVendor.get(e.vendorId) || [];
    list.push(e);
    byVendor.set(e.vendorId, list);
  }

  // 4) pentru fiecare vendor: creezi payout + transfer
  for (const [vendorId, list] of byVendor.entries()) {
    const vendor = list[0].vendor;
    const totalVendorNet = list.reduce((s, e) => s + Number(e.vendorNet), 0);

    // create Stripe transfer
    const transfer = await stripe.transfers.create({
      amount: Math.round(totalVendorNet * 100),
      currency: "ron",
      destination: vendor.stripeAccountId,
      metadata: { vendorId },
    });

    // create VendorPayout
    const payout = await prisma.vendorPayout.create({
      data: {
        vendorId,
        periodFrom: list[0].occurredAt,
        periodTo: list[list.length - 1].occurredAt,
        currency: "RON",
        totalItemsNet: list.reduce((s, e) => s + Number(e.itemsNet), 0),
        totalCommissionNet: list.reduce((s, e) => s + Number(e.commissionNet), 0),
        totalVendorNet: totalVendorNet,
        status: "PAID",
        paidAt: new Date(),
        // poți salva transfer id în invoice/meta dacă vrei
      },
    });

    // link entries
    await prisma.vendorEarningEntry.updateMany({
      where: { id: { in: list.map(x => x.id) } },
      data: { payoutId: payout.id, stripeTransferId: transfer.id },
    });
  }
}
