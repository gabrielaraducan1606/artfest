import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../../components/services/api"; // baseURL: '/api'
import useAuthToken from "./useAuthToken";
import useDebouncedCallback from "./useDebouncedCallback";
import ls from "../utils/ls";

/** Normalizează item-ul venit din diverse surse */
export const normalizeItem = (row) => ({
  _id: row._id || row.id || row.productId?._id || row.productId,
  title: row.productId?.title || row.title || "Produs",
  price: row.productId?.price ?? row.price ?? 0,
  qty: row.qty ?? row.quantity ?? 1,
  image: row.productId?.images?.[0] || row.image,
  seller: row.productId?.seller || row.seller || null,
  stock: row.productId?.stock ?? row.stock ?? 999,
  attrs: row.productId?.attrs || row.attrs || {}
});

export default function useCartState() {
  const token = useAuthToken();

  const [items, setItems] = useState([]);
  const [saveForLater, setSaveForLater] = useState([]);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyIds, setBusyIds] = useState(() => new Set());

  // Load cart + SFL
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const sfl = ls.getJSON("sfl", []);
        if (!token) {
          if (!mounted) return;
          setItems(ls.getJSON("cart", []).map(normalizeItem));
          setSaveForLater(sfl);
          setError("");
          return;
        }
        const data = await api.get("/cart").then(r => r.data ?? r);
        if (!mounted) return;
        setItems((Array.isArray(data) ? data : []).map(normalizeItem));
        setSaveForLater(sfl);
        setError("");
      } catch (e) {
        console.error(e);
        if (mounted) setError("Nu am putut încărca coșul.");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [token]);

  // Helpers
  const markBusy = useCallback((id) =>
    setBusyIds(prev => { const n = new Set(prev); n.add(id); return n; }), []);
  const unbusy = useCallback((id) =>
    setBusyIds(prev => { const n = new Set(prev); n.delete(id); return n; }), []);

  // Update qty (optimist) + persistență locală dacă e user neautentificat
  const setQty = useCallback(async (id, nextQty) => {
    const clamped = Math.max(1, Math.min(999, nextQty));
    markBusy(id);
    setItems(prev => {
      const next = prev.map(it => it._id === id ? { ...it, qty: clamped } : it);
      if (!token) ls.setJSON("cart", next);
      return next;
    });

    if (!token) { unbusy(id); return; }

    try {
      await api.patch(`/cart/${id}`, { qty: clamped });
    } catch (e) {
      console.error(e);
      setError("Nu am putut actualiza cantitatea.");
    } finally {
      unbusy(id);
    }
  }, [markBusy, unbusy, token]);

  const debouncedQty = useDebouncedCallback(setQty, 350);

  // Remove item
  const removeItem = useCallback(async (id) => {
    markBusy(id);
    if (!token) {
      setItems(prev => {
        const next = prev.filter(it => it._id !== id);
        ls.setJSON("cart", next);
        return next;
      });
      unbusy(id);
      return;
    }
    const snapshot = items;
    setItems(prev => prev.filter(it => it._id !== id));
    try {
      await api.delete(`/cart/${id}`);
    } catch (e) {
      console.error(e);
      setItems(snapshot);
      setError("Nu am putut șterge produsul.");
    } finally {
      unbusy(id);
    }
  }, [items, token, markBusy, unbusy]);

  // Apply coupon
  const applyCoupon = useCallback(async (code) => {
    const trimmed = code?.trim();
    if (!trimmed) return { ok: false };
    try {
      const res = await api.post("/cart/apply-coupon", { code: trimmed });
      const payload = res.data ?? res;
      if (payload?.ok) {
        setAppliedCoupon(payload.coupon);
        return { ok: true, coupon: payload.coupon };
      }
      setAppliedCoupon(null);
      setError(payload?.message || "Cupon invalid.");
      return { ok: false };
    } catch (e) {
      console.error(e);
      setError("Eroare la aplicarea cuponului.");
      return { ok: false };
    }
  }, []);

  // Move to Save For Later
  const moveToSFL = useCallback((id) => {
    setItems(prev => {
      const it = prev.find(x => x._id === id);
      if (!it) return prev;
      const rest = prev.filter(x => x._id !== id);
      setSaveForLater(curr => {
        const next = [it, ...curr.filter(x => x._id !== id)];
        ls.setJSON("sfl", next);
        return next;
      });
      if (!token) ls.setJSON("cart", rest);
      return rest;
    });
  }, [token]);

  // Add back from Save For Later
  const addBackFromSFL = useCallback(async (id) => {
    const it = saveForLater.find(x => x._id === id);
    if (!it) return;

    if (!token) {
      setItems(prev => {
        const next = [it, ...prev];
        ls.setJSON("cart", next);
        return next;
      });
      const rest = saveForLater.filter(x => x._id !== id);
      setSaveForLater(rest);
      ls.setJSON("sfl", rest);
      return;
    }

    try {
      await api.post("/cart", { productId: id, qty: it.qty || 1 });
      setItems(prev => [it, ...prev]);
      const rest = saveForLater.filter(x => x._id !== id);
      setSaveForLater(rest);
      ls.setJSON("sfl", rest);
    } catch (e) {
      console.error(e);
      setError("Nu am putut adăuga produsul în coș.");
    }
  }, [saveForLater, token]);

  // Clear cart
  const clearCart = useCallback(async () => {
    const current = [...items];
    setItems([]);
    if (!token) { ls.setJSON("cart", []); return; }
    try {
      const res = await api.delete("/cart");
      const ok = (res.data ?? res)?.ok ?? true;
      if (!ok) throw new Error("fallback");
    } catch (e) {
      console.warn("fallback clear per-item", e?.message);
      await Promise.all(current.map(it => api.delete(`/cart/${it._id}`).catch(() => null)));
    }
  }, [items, token]);

  // Group by seller for UI
  const groupedBySeller = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const sellerId = it.seller?._id || "fara-seller";
      const sellerName = it.seller?.name || "Artizan";
      const key = `${sellerId}|${sellerName}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return Array.from(map.entries()).map(([key, list]) => {
      const [sellerId, sellerName] = key.split("|");
      return { sellerId, sellerName, list };
    });
  }, [items]);

  return {
    // state
    items, setItems,
    saveForLater, setSaveForLater,
    appliedCoupon, setAppliedCoupon,
    loading, error, setError,
    busyIds,

    // actions
    debouncedQty, removeItem, clearCart, moveToSFL, addBackFromSFL, applyCoupon,

    // selectors
    groupedBySeller,
  };
}
