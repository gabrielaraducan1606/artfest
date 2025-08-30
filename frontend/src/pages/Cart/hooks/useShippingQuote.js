// frontend/pages/Cart/hooks/useShippingQuote.js
import { useEffect, useMemo, useState, useCallback } from "react";
import api from "../../../components/services/api";

export default function useShippingQuote({ items = [], address = {}, isPickup = false }) {
  const [shippingTotal, setShippingTotal] = useState(0);
  const [breakdown, setBreakdown] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 1) Destructure address -> deps primitive, stabile
  const {
    country = "",
    county  = "",
    city    = "",
    street  = "",
    zip     = ""
  } = address || {};

  // 2) Adresă "safe" derivată din primitive (memo)
  const safeAddress = useMemo(
    () => ({ country, county, city, street, zip }),
    [country, county, city, street, zip]
  );

  // 3) Payload stabil (memo)
  const payload = useMemo(() => ({
    items: (items || []).map(it => ({
      // încearcă toate variantele posibile, în ordinea cea mai fiabilă
      productId: it.productId || it.product?._id || it._id,
      qty: Math.max(1, Number(it.qty) || 1),
    })),
    isPickup: !!isPickup,
    address: safeAddress,
  }), [items, isPickup, safeAddress]);

  // 4) fetchQuote stabil cu useCallback, depinde doar de payload
  const fetchQuote = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      if (!payload.items.length) {
        setShippingTotal(0);
        setBreakdown([]);
        return;
      }

      const { data } = await api.post("/cart/shipping-quote", payload);
      setShippingTotal(Number(data?.shippingTotal ?? 0));
      setBreakdown(Array.isArray(data?.breakdown) ? data.breakdown : []);
    } catch (e) {
      console.error("shipping-quote error", e);
      setError("Nu am putut calcula transportul.");
      setShippingTotal(0);
      setBreakdown([]);
    } finally {
      setLoading(false);
    }
  }, [payload]);

  // 5) Rulează la schimbarea fetchQuote (=> implicit la schimbarea payload)
  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  return { shippingTotal, breakdown, loading, error, refresh: fetchQuote };
}
