// services/shipping.service.js
function pickPolicyForDestination(policy = {}, address = {}) {
  if (!Array.isArray(policy.zones) || policy.zones.length === 0) return policy;
  const z = policy.zones.find(z =>
    (!z.country || z.country === address.country) &&
    (!z.county  || z.county  === address.county)
  );
  return z ? { ...policy, ...z } : policy;
}

function calcSellerShipping({ subtotal, itemsCount, policy = {}, isPickup, address }) {
  const p = pickPolicyForDestination(policy, address);
  if (isPickup && p.pickupAvailable) return { method: "pickup", cost: 0, freeOver: p.freeOver ?? null };

  const freeOver = p.freeOver ?? Infinity;
  if (subtotal >= freeOver) return { method: "courier", cost: 0, freeOver };

  const base = Number(p.baseCost ?? 0);
  const perItem = Number(p.perItem ?? 0) * Math.max(0, itemsCount - 1);
  return { method: "courier", cost: +(base + perItem).toFixed(2), freeOver };
}

/** items: [{ product, qty }] cu product.seller populat */
async function quoteBySellers({ items = [], address = {}, isPickup = false }) {
  const groups = new Map();
  for (const it of items) {
    const sellerId = String(it.product.seller._id);
    if (!groups.has(sellerId)) groups.set(sellerId, []);
    groups.get(sellerId).push(it);
  }

  const bySeller = [];
  let merchandise = 0;
  let shippingTotal = 0;

  for (const [sellerId, list] of groups.entries()) {
    const seller = list[0].product.seller;
    const subtotal = list.reduce((s, x) => s + (x.product.price * x.qty), 0);
    const itemsCount = list.reduce((s, x) => s + x.qty, 0);
    const shipping = calcSellerShipping({ subtotal, itemsCount, policy: seller.shippingPolicy || {}, isPickup, address });

    bySeller.push({
      sellerId,
      sellerName: seller.name,
      subtotal,
      itemsCount,
      shipping,
      total: +(subtotal + shipping.cost).toFixed(2)
    });

    merchandise += subtotal;
    shippingTotal += shipping.cost;
  }

  return {
    bySeller,
    merchandise: +merchandise.toFixed(2),
    shippingTotal: +shippingTotal.toFixed(2)
  };
}

module.exports = { quoteBySellers, calcSellerShipping };
