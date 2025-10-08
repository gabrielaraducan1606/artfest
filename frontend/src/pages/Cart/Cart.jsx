// src/pages/Cart/Cart.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  return BACKEND_BASE ? `${BACKEND_BASE}${path}` : path;
};

const money = (v, currency = "RON") =>
  new Intl.NumberFormat("ro-RO", { style: "currency", currency }).format(v ?? 0);

export default function Cart() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [rows, setRows] = useState([]); // [{ productId, qty, product: { ... } }]
  const didMergeRef = useRef(false);

  const myVendorId = me?.vendor?.id || null;

  // — helper pentru badge
  const notifyCartChanged = () => {
    try {
      window.dispatchEvent(new CustomEvent("cart:changed"));
    } catch { /* ignore */ }
  };

  // === GUEST: citește detaliile produselor și compune rânduri
  const loadGuest = async () => {
    const list = guestCart.list(); // [{productId, qty}]
    if (list.length === 0) {
      setRows([]);
      return;
    }
    const ids = list.map((x) => x.productId).join(",");
    const res = await api(`/api/public/products?ids=${encodeURIComponent(ids)}&limit=${list.length}`);
    const byId = new Map((res?.items || []).map((p) => [p.id, p]));
    const rows = list.map((x) => {
      const p = byId.get(x.productId) || {};
      return {
        productId: x.productId,
        qty: x.qty,
        product: {
          id: p.id,
          title: p.title || "Produs",
          images: Array.isArray(p.images) ? p.images : [],
          price: Number.isFinite(p.priceCents) ? p.priceCents / 100 : (Number.isFinite(p.price) ? p.price : 0),
          currency: p.currency || "RON",
          vendorId: p?.service?.vendor?.id || p?.vendorId || null,
        },
      };
    });
    setRows(rows);
  };

  // === LOGGED: ia coșul din server
  const loadServer = async () => {
    const c = await api("/api/cart");
    setRows(Array.isArray(c?.items) ? c.items : []);
  };

  // === Merge automat: când userul se loghează, trimite coșul local la server
  const mergeIfNeeded = async (user) => {
    if (!user || didMergeRef.current) return;
    const local = guestCart.list();
    if (!local.length) return;
    try {
      await api("/api/cart/merge", { method: "POST", body: { items: local } });
      guestCart.clear();
      didMergeRef.current = true;
      notifyCartChanged();
    } catch { /* silent */ }
  };

  // === Load inițial
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const d = await api("/api/auth/me").catch(() => null);
        const user = d?.user || null;
        setMe(user);
        if (user) {
          await mergeIfNeeded(user);
          await loadServer();
        } else {
          await loadGuest();
        }
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dacă me se schimbă (ex: te-ai logat în alt tab), încearcă merge + reload
  useEffect(() => {
    (async () => {
      if (me) {
        await mergeIfNeeded(me);
        await loadServer();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, me?.sub]);

  const total = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.product?.price || 0) * Number(r.qty || 0)), 0),
    [rows]
  );

  // === Mutations
  const updateQty = async (productId, qty) => {
    const safe = Math.max(1, Math.min(99, qty));
    const prev = rows.slice();
    setRows((list) => list.map((r) => (r.productId === productId ? { ...r, qty: safe } : r)));

    if (!me) {
      guestCart.update(productId, safe);
      notifyCartChanged();
      return;
    }
    try {
      await api("/api/cart/update", { method: "POST", body: { productId, qty: safe } });
      notifyCartChanged();
    } catch (e) {
      alert(e?.message || "Nu am putut actualiza cantitatea.");
      setRows(prev);
    }
  };

  const removeItem = async (productId) => {
    const prev = rows.slice();
    setRows((list) => list.filter((r) => r.productId !== productId));

    if (!me) {
      guestCart.remove(productId);
      notifyCartChanged();
      return;
    }
    try {
      await api("/api/cart/remove", { method: "DELETE", body: { productId } });
      notifyCartChanged();
    } catch {
      setRows(prev);
    }
  };

  if (loading) return <div className={styles.container}>Se încarcă…</div>;

  return (
    <div className={styles.container}>
      <h2 className={styles.pageTitle}>Coș</h2>

      {rows.length === 0 ? (
        <div className={styles.empty}>Coșul tău este gol.</div>
      ) : (
        <div className={styles.layout}>
          {/* Listă articole */}
          <div className={styles.list}>
            {rows.map((r) => {
              const p = r.product || {};
              const img = p.images?.[0] ? resolveFileUrl(p.images[0]) : productPlaceholder(200, 160, "Produs");
              const isOwner = !!myVendorId && !!p.vendorId && myVendorId === p.vendorId;

              return (
                <article key={r.productId} className={styles.card}>
                  <Link to={`/produs/${p.id || r.productId}`} className={styles.media} aria-label={p.title}>
                    <img
                      className={styles.mediaImg}
                      src={img}
                      alt={p.title}
                      onError={(e) => onImgError(e, 200, 160, "Produs")}
                    />
                  </Link>

                  <div className={styles.body}>
                    <h3 className={styles.title}>{p.title}</h3>
                    {typeof p.price === "number" && (
                      <div className={styles.price}>{money(p.price, p.currency)}</div>
                    )}
                    {isOwner && me && (
                      <div className={styles.ownerNote}>
                        (Produsul îți aparține — backend blochează checkout-ul.)
                      </div>
                    )}
                  </div>

                  <div className={styles.actions}>
                    <div className={styles.qty} aria-label="Cantitate">
                      <button
                        className={styles.iconBtnOutline}
                        onClick={() => updateQty(r.productId, r.qty - 1)}
                        title="Scade cantitatea"
                        aria-label="Scade cantitatea"
                        type="button"
                      >
                        <FaMinus />
                      </button>
                      <input
                        className={styles.qtyInput}
                        value={r.qty}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        min={1}
                        max={99}
                        onChange={(e) => {
                          const v = parseInt(e.target.value || "1", 10);
                          if (Number.isFinite(v)) updateQty(r.productId, v);
                        }}
                      />
                      <button
                        className={styles.iconBtnOutline}
                        onClick={() => updateQty(r.productId, r.qty + 1)}
                        title="Crește cantitatea"
                        aria-label="Crește cantitatea"
                        type="button"
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
                    >
                      <FaTrash /> Elimină
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Sumar */}
          <aside className={styles.summary} aria-label="Sumar coș">
            <div className={styles.summaryTitle}>Sumar</div>
            <div className={styles.summaryRow}>
              <span>Subtotal</span>
              <strong>{money(total, "RON")}</strong>
            </div>
            <div className={styles.summaryNote}>
              Taxele de livrare se calculează la pasul următor (pe fiecare magazin).
            </div>
            <button
              className={styles.checkoutBtn}
              onClick={() => {
                if (!me) {
                  const redir = encodeURIComponent("/checkout");
                  return nav(`/autentificare?redirect=${redir}`);
                }
                nav("/checkout");
              }}
              type="button"
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
            <div className={styles.tot}>{money(total, "RON")}</div>
 <div className={styles.small}>Subtotal (fără livrare)</div>
          </div>
          <button
            className={styles.mobileCheckout}
            onClick={() => {
              if (!me) {
                const redir = encodeURIComponent("/checkout");
                return nav(`/autentificare?redirect=${redir}`);
              }
              nav("/checkout");
            }}
            type="button"
          >
            Checkout
          </button>
        </div>
      )}
    </div>
  );
}
