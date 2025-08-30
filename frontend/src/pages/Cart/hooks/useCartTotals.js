import { useEffect, useMemo, useState } from "react";
import api from "../../../components/services/api";

/**
 * Calculează totalurile + cere de la backend transportul pe artizan.
 * - Prețurile sunt brute (TVA inclus) — nu mai adăugăm TVA peste.
 * - Pentru coșuri de oaspeți funcționează (endpoint-ul nu cere auth).
 */
export default function useCartTotals(items, appliedCoupon, isPickup) {
  const merchandiseTotal = useMemo(
    () => items.reduce((s, it) => s + Number(it.price || 0) * Number(it.qty || 0), 0),
    [items]
  );

  const discount = useMemo(() => {
    if (!appliedCoupon) return 0;
    const pct = appliedCoupon.type === "percent" ? Number(appliedCoupon.value || 0) : 0;
    const fix = appliedCoupon.type === "fixed" ? Number(appliedCoupon.value || 0) : 0;
    const cap = Math.max(0, merchandiseTotal);
    return Math.min(cap, merchandiseTotal * (pct / 100) + fix);
  }, [appliedCoupon, merchandiseTotal]);

  const [shipping, setShipping] = useState(0);
  const [shippingBreakdown, setShippingBreakdown] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const payload = {
      isPickup: !!isPickup,
      items: items.map(it => ({ productId: it._id, qty: it.qty })),
    };
    (async () => {
      try {
        const res = await api.post("/cart/shipping-quote", payload);
        const data = res.data ?? res;
        if (cancelled) return;
        const total =
          Number(data?.shippingTotal) ||
          Number(data?.shipping?.total) ||
          Number(data?.total) ||
          Number(data?.sum) ||
          0;
        setShipping(Number(total.toFixed(2)));
        setShippingBreakdown(Array.isArray(data?.breakdown) ? data.breakdown : []);
      } catch (e) {
        console.error("shipping-quote failed", e);
        if (!cancelled) {
          // fallback simplu: dacă pickup → 0, altfel 19.99
          setShipping(isPickup ? 0 : 19.99);
          setShippingBreakdown([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [items, isPickup]);

  // Total brut: produse - reducere + transport
  const grandTotal = useMemo(
    () => Math.max(0, merchandiseTotal - discount + shipping),
    [merchandiseTotal, discount, shipping]
  );

  // TVA inclus (informativ) – dacă vrei să-l afișezi
  const vatRate = 0.19;
  const taxableMerch = Math.max(0, merchandiseTotal - discount);
  const vatIncludedMerch = taxableMerch * vatRate / (1 + vatRate);
  const vatIncludedShip = shipping ? shipping * vatRate / (1 + vatRate) : 0;
  const vatIncluded = vatIncludedMerch + (isPickup ? 0 : vatIncludedShip);

  return {
    merchandiseTotal,
    discount,
    shipping,
    shippingBreakdown, // dacă vrei să arăți „Transport Magazin X: …”
    vat: vatIncluded,
    grandTotal,
  };
}

