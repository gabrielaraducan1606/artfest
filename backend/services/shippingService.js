// ESM

/**
 * Politici suportate (exemplu):
 * {
 *   baseCost: 19.99,
 *   perItem: 2.5,          // cost pe articol (după primul)
 *   freeOver: 250,         // transport gratuit peste suma asta
 *   pickupAvailable: true, // ridicare personală
 *   zones: [               // opțional, per destinație
 *     { country: "România", county: "Cluj", baseCost: 14.99, freeOver: 199 }
 *   ]
 * }
 */

export function pickPolicyForDestination(policy = {}, address = {}) {
  if (!Array.isArray(policy.zones) || policy.zones.length === 0) return policy;
  const z = policy.zones.find(z =>
    (!z.country || z.country === address.country) &&
    (!z.county  || z.county  === address.county)
  );
  return z ? { ...policy, ...z } : policy;
}

export function calcSellerShipping({ subtotal, itemsCount, policy = {}, isPickup, address }) {
  const p = pickPolicyForDestination(policy, address);

  if (isPickup && p.pickupAvailable) {
    return { method: "pickup", cost: 0, freeOver: p.freeOver ?? null, etaDays: 0 };
  }

  const freeOver = p.freeOver ?? Infinity;
  if (Number.isFinite(freeOver) && subtotal >= freeOver) {
    return { method: "courier", cost: 0, freeOver, etaDays: p.standardEtaDays ?? 2 };
  }

  const base = Number(p.baseCost ?? 0);
  const perItem = Number(p.perItem ?? 0) * Math.max(0, itemsCount - 1);
  const cost = +(base + perItem).toFixed(2);

  return { method: "courier", cost, freeOver, etaDays: p.standardEtaDays ?? 2 };
}

/**
 * items: [{ product: { price, seller: { _id, name, shippingPolicy } }, qty }]
 * address: { country?, county? ... }
 */
export async function quoteBySellers({ items = [], address = {}, isPickup = false }) {
  const groups = new Map();
  for (const it of items) {
    const sid = String(it.product.seller._id);
    if (!groups.has(sid)) groups.set(sid, []);
    groups.get(sid).push(it);
  }

  const bySeller = [];
  let merchandise = 0;
  let shippingTotal = 0;

  for (const [sellerId, list] of groups.entries()) {
    const seller = list[0].product.seller;
    const subtotal   = list.reduce((s, x) => s + Number(x.product.price || 0) * Number(x.qty || 1), 0);
    const itemsCount = list.reduce((s, x) => s + Number(x.qty || 1), 0);

    const shipping = calcSellerShipping({
      subtotal,
      itemsCount,
      policy: seller.shippingPolicy || {},
      isPickup,
      address
    });

    bySeller.push({
      sellerId,
      sellerName: seller.name || "Magazin",
      subtotal: +subtotal.toFixed(2),
      itemsCount,
      shipping,
      total: +(subtotal + shipping.cost).toFixed(2)
    });

    merchandise  += subtotal;
    shippingTotal += shipping.cost;
  }

  return {
    bySeller,
    merchandise: +merchandise.toFixed(2),
    shippingTotal: +shippingTotal.toFixed(2),
    currency: "RON"
  };
}
