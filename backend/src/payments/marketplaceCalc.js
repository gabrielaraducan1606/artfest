// src/payments/marketplaceCalc.js
import { prisma } from "../lib/prisma.js";

/**
 * IMPORTANT:
 * - În DB, ShipmentItem.price este presupus "gross" (include TVA), exact cât a plătit clientul per unitate.
 * - Comisionul platformei se calculează pe NET fără TVA (doar pe produse).
 * - Transportul NU intră în baza de comision (în exemplul tău).
 * - Stripe fee total se aplică o singură dată pe charge și îl aloci proporțional la vendors (după gross).
 */

const dec2 = (n) => Number.parseFloat((Number(n || 0)).toFixed(2));

function parseVatRateToFraction(vatRate) {
  // Acceptă: "19", 19, "0.19", 0.19, "19%", null
  if (vatRate == null) return 0;

  const raw = String(vatRate).trim().replace("%", "");
  const x = Number(raw);
  if (!Number.isFinite(x) || x < 0) return 0;

  // dacă e > 1, considerăm că e procent (19 => 0.19)
  if (x > 1) return x / 100;
  return x; // deja fracție (0.19)
}

async function getActivePlanForVendor(vendorId) {
  const now = new Date();

  const sub = await prisma.vendorSubscription.findFirst({
    where: { vendorId, status: "active", endAt: { gt: now } },
    include: { plan: true },
    orderBy: { endAt: "desc" },
  });

  if (sub?.plan) return sub.plan;

  const starter = await prisma.subscriptionPlan.findUnique({
    where: { code: "starter" },
  });

  return starter ?? { code: "starter", name: "Starter", commissionBps: 0 };
}

/**
 * Returnează:
 * - per vendor: itemsGross, itemsNetExVat, itemsVat, shippingGross, shippingNetExVat, shippingVat
 * - commissionNet (platform) calculat pe itemsNetExVat
 *
 * NOTE:
 * - Dacă vendor nu e TVA activ, vatRate = 0 => net=gross.
 */
export async function computeOrderSplits(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      shipments: {
        include: {
          items: true,
        },
      },
    },
  });
  if (!order) throw new Error("order_not_found");

  // luăm vatRate per vendor din VendorBilling (batch query)
  const vendorIds = Array.from(
    new Set((order.shipments || []).map((s) => String(s.vendorId)))
  );

  const vendorRows = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
    select: {
      id: true,
      billing: {
        select: {
          tvaActive: true,
          vatRate: true,
          vatStatus: true,
        },
      },
    },
  });

  const vatByVendor = new Map(
    vendorRows.map((v) => {
      const tvaActive = !!v.billing?.tvaActive;
      const vatFraction = tvaActive ? parseVatRateToFraction(v.billing?.vatRate) : 0;
      return [String(v.id), { tvaActive, vatFraction }];
    })
  );

  const byVendor = new Map();

  for (const sh of order.shipments || []) {
    const vendorId = String(sh.vendorId);

    const { vatFraction } = vatByVendor.get(vendorId) || { vatFraction: 0 };

    // PRODUSE
    const itemsGross = dec2(
      (sh.items || []).reduce(
        (s, it) => s + Number(it.price || 0) * Number(it.qty || 0),
        0
      )
    );

    // net fără TVA (dacă TVA=0 => net=gross)
    const itemsNetExVat = vatFraction > 0 ? dec2(itemsGross / (1 + vatFraction)) : itemsGross;
    const itemsVat = dec2(itemsGross - itemsNetExVat);

    // TRANSPORT (în modelul tău, shipping ajunge la vendor)
    const shippingGross = dec2(Number(sh.price || 0));
    const shippingNetExVat =
      vatFraction > 0 ? dec2(shippingGross / (1 + vatFraction)) : shippingGross;
    const shippingVat = dec2(shippingGross - shippingNetExVat);

    if (!byVendor.has(vendorId)) {
      byVendor.set(vendorId, {
        vendorId,

        // produse
        itemsGross: 0,
        itemsNetExVat: 0,
        itemsVat: 0,

        // transport
        shippingGross: 0,
        shippingNetExVat: 0,
        shippingVat: 0,
      });
    }

    const row = byVendor.get(vendorId);

    row.itemsGross = dec2(row.itemsGross + itemsGross);
    row.itemsNetExVat = dec2(row.itemsNetExVat + itemsNetExVat);
    row.itemsVat = dec2(row.itemsVat + itemsVat);

    row.shippingGross = dec2(row.shippingGross + shippingGross);
    row.shippingNetExVat = dec2(row.shippingNetExVat + shippingNetExVat);
    row.shippingVat = dec2(row.shippingVat + shippingVat);
  }

  const vendors = Array.from(byVendor.values());

  // attach commission bps per vendor (din plan) + calc comision pe NET fără TVA
  for (const v of vendors) {
    const plan = await getActivePlanForVendor(v.vendorId);
    const bps = Number(plan?.commissionBps ?? 0);

    v.planCode = plan?.code || "starter";
    v.commissionBps = Number.isFinite(bps) ? bps : 0;

    // ✅ comision doar pe produse, pe net fără TVA
    v.commissionNet = dec2((v.itemsNetExVat * v.commissionBps) / 10000);
  }

  const totalItemsGross = dec2(vendors.reduce((s, v) => s + v.itemsGross, 0));
  const totalShippingGross = dec2(
    vendors.reduce((s, v) => s + v.shippingGross, 0)
  );
  const totalGross = dec2(totalItemsGross + totalShippingGross);

  return {
    order: {
      id: order.id,
      currency: order.currency || "RON",
      totalGross,
      totalItemsGross,
      totalShippingGross,
    },
    vendors,
  };
}

/**
 * feeNet = fee Stripe real (RON) de pe charge (o singură dată),
 * îl alocăm proporțional după gross share per vendor:
 *   weight = itemsGross + shippingGross
 */
export function allocateStripeFee(vendors, feeNet) {
  feeNet = dec2(feeNet);
  if (feeNet <= 0) return vendors.map((v) => ({ ...v, stripeFeeAllocated: 0 }));

  const weights = vendors.map((v) => ({
    vendorId: v.vendorId,
    gross: dec2((v.itemsGross || 0) + (v.shippingGross || 0)),
  }));

  const sumGross = dec2(weights.reduce((s, w) => s + w.gross, 0));
  if (sumGross <= 0) return vendors.map((v) => ({ ...v, stripeFeeAllocated: 0 }));

  let allocated = 0;

  return vendors.map((v, idx) => {
    const gross = dec2((v.itemsGross || 0) + (v.shippingGross || 0));

    let part = 0;
    if (idx < vendors.length - 1) {
      part = dec2((feeNet * gross) / sumGross);
      allocated = dec2(allocated + part);
    } else {
      part = dec2(feeNet - allocated); // remainder
    }

    return { ...v, stripeFeeAllocated: part };
  });
}

/**
 * Vendor payout:
 * vendor primește GROSS (include TVA + transport),
 * minus comisionul tău (pe net fără TVA din produse),
 * minus partea lui din fee Stripe alocată.
 */
export function computeVendorPayouts(vendors) {
  return vendors.map((v) => {
    const gross = dec2((v.itemsGross || 0) + (v.shippingGross || 0));
    const payout = dec2(gross - (v.commissionNet || 0) - (v.stripeFeeAllocated || 0));

    return {
      ...v,
      gross,
      vendorPayoutNet: payout,
    };
  });
}
