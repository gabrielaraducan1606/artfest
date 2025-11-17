// ==============================
// File: src/pages/Cart/Cart.jsx
// ==============================
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { productPlaceholder, onImgError } from "../../components/utils/imageFallback";
import { FaMinus, FaPlus, FaTrash } from "react-icons/fa";
import { guestCart } from "../../lib/guestCart";
import styles from "./Cart.module.css";

const BACKEND_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const isHttp = (u = "") => /^https?:\/\//i.test(u);
const isDataOrBlob = (u = "") => /^(data|blob):/i.test(u);
const resolveFileUrl = (u) => {
  if (!u) return "";
  if (isHttp(u) || isDataOrBlob(u)) return u;
  const path = u.startsWith("/") ? u : `/${u}`;
  return BACKEND_BASE ? `${BACKEND_BASE}${path}`.replace(/([^:]\/)\/+/g, "$1") : path;
};

/* ===== Format bani cu cache ===== */
const nfCache = new Map();
const money = (v, currency = "RON", locale = "ro-RO") => {
  const key = `${locale}|${currency}`;
  if (!nfCache.has(key)) {
    nfCache.set(key, new Intl.NumberFormat(locale, { style: "currency", currency }));
  }
  return nfCache.get(key).format(v ?? 0);
};

/* ===== Cantități dinamice ===== */
const DEFAULT_MAX_QTY = 9999; // sau Infinity dacă vrei fără limită
const getMaxQty = (product = {}) => {
  if (Number.isFinite(product?.maxOrderQty) && product.maxOrderQty > 0) return product.maxOrderQty;
  if (Number.isFinite(product?.stock) && product.stock > 0) return product.stock;
  return DEFAULT_MAX_QTY;
};
const clampQty = (q, max = DEFAULT_MAX_QTY) => Math.max(1, Math.min(Number.isFinite(q) ? q : 1, max));

export default function Cart() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [rows, setRows] = useState([]); // [{ productId, qty, _localQty, product: {...} }]
  const didMergeRef = useRef(false);
  const announceRef = useRef(null); // aria-live
  const [pending, setPending] = useState(() => new Set()); // ids în lucru (update/remove)

  const myVendorId = me?.vendor?.id || null;

  const notifyCartChanged = useCallback(() => {
    try {
      window.dispatchEvent(new CustomEvent("cart:changed"));
    } catch {
      /* noop */
    }
  }, []);

  const announce = useCallback((msg) => {
    if (!announceRef.current) return;
    announceRef.current.textContent = msg;
    setTimeout(() => {
      if (announceRef.current) announceRef.current.textContent = "";
    }, 1500);
  }, []);

  const withPending = useCallback(async (id, fn) => {
    setPending((s) => new Set(s).add(id));
    try {
      return await fn();
    } finally {
      setPending((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }, []);

  /* ================= Guest ================= */
  const loadGuest = useCallback(async (signal) => {
    const list = guestCart.list(); // [{productId, qty}]
    if (list.length === 0) {
      if (!signal?.aborted) setRows([]);
      return;
    }

    const ids = list.map((x) => x.productId).join(",");
    const res = await api(`/api/public/products?ids=${encodeURIComponent(ids)}&limit=${list.length}`, { signal });
    const byId = new Map((res?.items || []).map((p) => [p.id, p]));
    const mapped = list.map((x) => {
      const p = byId.get(x.productId);
      if (!p) {
        const qty = clampQty(x.qty, 1);
        return {
          productId: x.productId,
          qty,
          _localQty: qty,
          product: {
            id: x.productId,
            title: "Produs indisponibil",
            images: [],
            price: 0,
            currency: "RON",
            vendorId: null,
            vendorName: null,
            available: false,
          },
        };
      }
      const price = Number.isFinite(p.priceCents) ? p.priceCents / 100 : (Number.isFinite(p.price) ? p.price : 0);
      const product = {
        id: p.id,
        title: p.title || "Produs",
        images: Array.isArray(p.images) ? p.images : [],
        price,
        currency: p.currency || "RON",
        vendorId: p?.service?.vendor?.id || p?.vendorId || null,
        vendorName: p?.service?.vendor?.displayName || null,
        maxOrderQty: p?.maxOrderQty,
        stock: p?.stock,
        available: true,
      };
      const max = getMaxQty(product);
      const qty = clampQty(x.qty, max);
      return { productId: x.productId, qty, _localQty: qty, product };
    });
    if (!signal?.aborted) setRows(mapped);
  }, []);

  /* ================= Logged-in ================= */
  const loadServer = useCallback(async (signal) => {
    const c = await api("/api/cart", { signal });
    const items = Array.isArray(c?.items) ? c.items : [];
    const mapped = items.map((it) => {
      const productRaw = it?.product || {};
      const product = {
        ...productRaw,
        title: productRaw?.title || "Produs",
        images: Array.isArray(productRaw?.images) ? productRaw.images : [],
        price: Number.isFinite(productRaw?.priceCents)
          ? productRaw.priceCents / 100
          : (Number.isFinite(productRaw?.price) ? productRaw.price : 0),
        currency: productRaw?.currency || "RON",
        vendorId: productRaw?.vendorId || productRaw?.service?.vendor?.id || null,
        vendorName: productRaw?.service?.vendor?.displayName || null,
        maxOrderQty: productRaw?.maxOrderQty,
        stock: productRaw?.stock,
        available: !!it?.product,
      };
      const max = getMaxQty(product);
      const qty = clampQty(it.qty, max);
      return { ...it, qty, _localQty: qty, product };
    });
    if (!signal?.aborted) setRows(mapped);
  }, []);

  const mergeIfNeeded = useCallback(async (user) => {
    if (!user || didMergeRef.current) return;
    const local = guestCart.list();
    if (!local.length) return;
    try {
      await api("/api/cart/merge", { method: "POST", body: { items: local } });
      guestCart.clear();
      didMergeRef.current = true;
      notifyCartChanged();
      announce("Am sincronizat coșul tău.");
    } catch {
      /* noop */
    }
  }, [announce, notifyCartChanged]);

  /* ================= Load init ================= */
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const d = await api("/api/auth/me", { signal: ac.signal }).catch(() => null);
        const user = d?.user || null;
        if (!ac.signal.aborted) setMe(user);
        if (user) {
          await mergeIfNeeded(user);
          await loadServer(ac.signal);
        } else {
          await loadGuest(ac.signal);
        }
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [loadGuest, loadServer, mergeIfNeeded]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      if (me) {
        await mergeIfNeeded(me);
        await loadServer(ac.signal);
      }
    })();
    return () => ac.abort();
  }, [me?.id, me?.sub, loadServer, mergeIfNeeded, me]);

  /* ================= Derivate ================= */
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const vid = r.product?.vendorId || "unknown";
      if (!map.has(vid)) map.set(vid, []);
      map.get(vid).push(r);
    }
    return map;
  }, [rows]);

  const grandTotal = useMemo(() => {
    let s = 0;
    for (const r of rows) s += (Number(r.product?.price || 0) * Number(r.qty || 0));
    return s;
  }, [rows]);

  const hasOwnItems = useMemo(() => {
    if (!myVendorId) return false;
    return rows.some(r => r.product?.vendorId && r.product.vendorId === myVendorId);
  }, [rows, myVendorId]);

  /* ================= Mutations ================= */
  const setLocalQty = useCallback((productId, value) => {
    setRows(list => list.map(r => r.productId === productId ? { ...r, _localQty: value } : r));
  }, []);

  const commitQty = useCallback(async (productId, qty) => {
    const row = rows.find(r => r.productId === productId);
    const max = getMaxQty(row?.product);
    const safe = clampQty(qty, max);
    const prev = rows.slice();

    setRows((list) =>
      list.map((r) => (r.productId === productId ? { ...r, qty: safe, _localQty: safe } : r))
    );

    if (!me) {
      guestCart.update(productId, safe);
      notifyCartChanged();
      return;
    }
    await withPending(productId, async () => {
      try {
        await api("/api/cart/update", { method: "POST", body: { productId, qty: safe } });
        notifyCartChanged();
        announce("Cantitate actualizată.");
      } catch (e) {
        alert(e?.message || "Nu am putut actualiza cantitatea.");
        setRows(prev);
      }
    });
  }, [rows, me, notifyCartChanged, withPending, announce]);

  const inc = useCallback((productId, current) => {
    const row = rows.find(r => r.productId === productId);
    const max = getMaxQty(row?.product);
    return commitQty(productId, Math.min(current + 1, max));
  }, [rows, commitQty]);

  const dec = useCallback((productId, current) => commitQty(productId, Math.max(current - 1, 1)), [commitQty]);

  const removeItem = useCallback(async (productId) => {
    const prev = rows.slice();
    setRows((list) => list.filter((r) => r.productId !== productId));

    if (!me) {
      guestCart.remove(productId);
      notifyCartChanged();
      announce("Produs eliminat.");
      return;
    }
    await withPending(productId, async () => {
      try {
        await api("/api/cart/remove", { method: "DELETE", body: { productId } });
        notifyCartChanged();
        announce("Produs eliminat.");
      } catch {
        setRows(prev);
      }
    });
  }, [rows, me, withPending, notifyCartChanged, announce]);

  const clearVendor = useCallback(async (vendorId) => {
    const ids = rows.filter(r => (r.product?.vendorId || "unknown") === vendorId).map(r => r.productId);
    if (!ids.length) return;
    if (!confirm("Elimini toate produsele acestui magazin din coș?")) return;

    const prev = rows.slice();
    setRows(list => list.filter(r => !ids.includes(r.productId)));

    if (!me) {
      ids.forEach(id => guestCart.remove(id));
      notifyCartChanged();
      announce("Produsele magazinului au fost eliminate.");
      return;
    }
    try {
      // Dacă nu ai batch în backend, facem fallback individual
      await api("/api/cart/remove-batch", { method: "POST", body: { productIds: ids } }).catch(async () => {
        for (const id of ids) {
          await api("/api/cart/remove", { method: "DELETE", body: { productId: id } }).catch(() => {});
        }
      });
      notifyCartChanged();
      announce("Produsele magazinului au fost eliminate.");
    } catch {
      setRows(prev);
    }
  }, [rows, me, notifyCartChanged, announce]);

  const clearAll = useCallback(async () => {
    if (!rows.length) return;
    if (!confirm("Sigur vrei să golești tot coșul?")) return;

    const prev = rows.slice();
    setRows([]);

    if (!me) {
      guestCart.clear();
      notifyCartChanged();
      announce("Coș golit.");
      return;
    }
    try {
      await api("/api/cart/clear", { method: "POST" }).catch(async () => {
        for (const r of prev) {
          await api("/api/cart/remove", { method: "DELETE", body: { productId: r.productId } }).catch(() => {});
        }
      });
      notifyCartChanged();
      announce("Coș golit.");
    } catch {
      setRows(prev);
    }
  }, [rows, me, notifyCartChanged, announce]);

  const goCheckout = useCallback(() => {
    if (!me) {
      const redir = encodeURIComponent("/checkout");
      return nav(`/autentificare?redirect=${redir}`);
    }
    if (hasOwnItems) return;
    nav("/checkout");
  }, [me, hasOwnItems, nav]);

  const isRowPending = useCallback((id) => pending.has(id), [pending]);

  /* ================= Render ================= */
  if (loading) return <div className={styles.container}>Se încarcă…</div>;

  return (
    <div className={styles.container}>
      {/* aria-live pentru anunțuri scurte */}
      <div ref={announceRef} aria-live="polite" className={styles.srOnly} />

      <div className={styles.headerRow}>
        <h2 className={styles.pageTitle}>Coș</h2>
        {rows.length > 0 && (
          <button className={styles.linkBtn} onClick={clearAll} type="button">
            Golește coșul
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>Coșul tău este gol.</div>
      ) : (
        <div className={styles.layout}>
          {/* Listă grupată pe vendor */}
          <div className={styles.list}>
            {[...groups.entries()].map(([vendorId, items]) => {
              const vName = items[0]?.product?.vendorName || (vendorId === "unknown" ? "Magazin" : "Magazin");
              const vendorSubtotal = items.reduce((s, r) => s + (Number(r.product?.price || 0) * Number(r.qty || 0)), 0);

              return (
                <section key={vendorId} className={styles.vendorSection} aria-label={`Magazin ${vName || ""}`}>
                  <header className={styles.vendorHead}>
                    <div className={styles.vendorTitle}>
                      <span>{vName || "Magazin"}</span>
                      <small className={styles.vendorSub}>Subtotal: {money(vendorSubtotal, "RON")}</small>
                    </div>
                    <button className={styles.linkBtn} type="button" onClick={() => clearVendor(vendorId)}>
                      Elimină tot de la acest magazin
                    </button>
                  </header>

                  {items.map((r) => {
                    const p = r.product || {};
                    const img = p.images?.[0] ? resolveFileUrl(p.images[0]) : productPlaceholder(200, 160, "Produs");
                    const isOwner = !!myVendorId && !!p.vendorId && myVendorId === p.vendorId;
                    const max = getMaxQty(p);
                    const canDec = r._localQty > 1;
                    const canInc = r._localQty < max;
                    const unavailable = p.available === false;
                    const rowBusy = isRowPending(r.productId);

                    return (
                      <article key={r.productId} className={styles.card}>
                        <Link
                          to={p.id ? `/produs/${p.id}` : "#"}
                          className={styles.media}
                          aria-label={p.title}
                          onClick={(e) => { if (!p.id) e.preventDefault(); }}
                        >
                          <img
                            className={styles.mediaImg}
                            src={img}
                            alt={p.title}
                            onError={(e) => onImgError(e, 200, 160, "Produs")}
                            decoding="async"
                            loading="lazy"
                          />
                        </Link>

                        <div className={styles.body}>
                          <h3 className={styles.title}>
                            {p.title}{unavailable ? " (indisponibil)" : ""}
                          </h3>
                          {typeof p.price === "number" && (
                            <div className={styles.price}>{money(p.price, p.currency)}</div>
                          )}
                          {r._localQty >= 1000 && (
                            <div className={styles.meta}>
                              Comenzile mari pot avea timpi de procesare/livrare suplimentari.
                            </div>
                          )}
                          {isOwner && me && (
                            <div className={styles.ownerNote}>
                              (Produsul îți aparține — checkout-ul va fi blocat.)
                            </div>
                          )}
                        </div>

                        <div className={styles.actions}>
                          <div className={styles.qty} aria-label="Cantitate">
                            <button
                              className={styles.iconBtnOutline}
                              onClick={() => dec(r.productId, r.qty)}
                              title="Scade cantitatea"
                              aria-label="Scade cantitatea"
                              type="button"
                              disabled={!canDec || unavailable || rowBusy}
                            >
                              <FaMinus />
                            </button>

                            <input
                              className={styles.qtyInput}
                              value={String(r._localQty)}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              min={1}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^\d]/g, "");
                                const v = clampQty(parseInt(raw || "1", 10), max);
                                setLocalQty(r.productId, v);
                              }}
                              onBlur={() => {
                                if (r._localQty !== r.qty) commitQty(r.productId, r._localQty);
                              }}
                              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                              aria-label="Cantitate"
                              disabled={unavailable || rowBusy}
                            />

                            <button
                              className={styles.iconBtnOutline}
                              onClick={() => inc(r.productId, r.qty)}
                              title="Crește cantitatea"
                              aria-label="Crește cantitatea"
                              type="button"
                              disabled={!canInc || unavailable || rowBusy}
                            >
                              <FaPlus />
                            </button>
                          </div>

                          <button
                            className={styles.removeBtn}
                            onClick={() => removeItem(r.productId)}
                            title="Elimină din coș"
                            aria-label="Elimină din coș"
                            type="button"
                            disabled={rowBusy}
                          >
                            <FaTrash /> Elimină
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </section>
              );
            })}
          </div>

          {/* Sumar global */}
          <aside className={styles.summary} aria-label="Sumar coș">
            <div className={styles.summaryTitle}>Sumar</div>

            {[...groups.entries()].map(([vendorId, items]) => {
              const vName = items[0]?.product?.vendorName || (vendorId === "unknown" ? "Magazin" : "Magazin");
              const vendorSubtotal = items.reduce((s, r) => s + (Number(r.product?.price || 0) * Number(r.qty || 0)), 0);
              return (
                <div className={styles.summaryRow} key={`sum-${vendorId}`}>
                  <span>{vName}</span>
                  <strong>{money(vendorSubtotal, "RON")}</strong>
                </div>
              );
            })}

            <div className={styles.summaryRow}>
              <span>Subtotal</span>
              <strong>{money(grandTotal, "RON")}</strong>
            </div>

            <div className={styles.summaryNote}>
              Taxele de livrare se calculează la pasul următor (separat pe fiecare magazin).
            </div>

            {hasOwnItems && (
              <div className={styles.errorBar} role="alert">
                Ai produse din propriul magazin în coș. Elimină-le pentru a continua la checkout.
              </div>
            )}

            <button
              className={styles.checkoutBtn}
              onClick={goCheckout}
              type="button"
              disabled={hasOwnItems || rows.every(r => r.product?.available === false)}
            >
              Continuă la checkout
            </button>
          </aside>
        </div>
      )}

      {/* Sticky checkout bar – mobil */}
      {rows.length > 0 && (
        <div className={styles.mobileBar} role="region" aria-label="Rezumat rapid și checkout">
          <div>
            <div className={styles.tot}>{money(grandTotal, "RON")}</div>
            <div className={styles.small}>Subtotal (fără livrare)</div>
          </div>
          <button
            className={styles.mobileCheckout}
            onClick={goCheckout}
            type="button"
            disabled={hasOwnItems || rows.every(r => r.product?.available === false)}
            aria-disabled={hasOwnItems}
            title={hasOwnItems ? "Ai produse din propriul magazin în coș" : "Continuă la checkout"}
          >
            Checkout
          </button>
        </div>
      )}
    </div>
  );
}
