// ==============================
// File: src/pages/Wishlist/Wishlist.jsx
// ==============================
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaTrash, FaShoppingCart } from "react-icons/fa";
import { api } from "../../lib/api";
import styles from "./Wishlist.module.css";

// === Helpers ===
const formatters = new Map();
const money = (v, currency = "RON") => {
  if (typeof v !== "number") return "";
  if (!formatters.has(currency)) {
    formatters.set(
      currency,
      new Intl.NumberFormat(undefined, { style: "currency", currency })
    );
  }
  return formatters.get(currency).format(v);
};

const BACKEND_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
const isHttp = (u = "") => /^https?:\/\//i.test(u);
const isDataOrBlob = (u = "") => /^(data|blob):/i.test(u);
const placeholder = (w, h, label) =>
  `https://placehold.co/${w}x${h}?text=${encodeURIComponent(label)}`;
const onImgError = (e, w, h, label) => {
  e.currentTarget.src = placeholder(w, h, label);
};
const resolveImg = (u) => {
  if (!u) return placeholder(480, 360, "Produs");
  if (isHttp(u) || isDataOrBlob(u)) return u;
  const path = u.startsWith("/") ? u : `/${u}`;
  return BACKEND_BASE
    ? `${BACKEND_BASE}${path}`.replace(/([^:]\/)\/+/g, "$1")
    : path;
};

// SSR-safe PAGE_SIZE (nu accesează `window` pe server)
const isClient = typeof window !== "undefined";
const PAGE_SIZE =
  isClient && window.matchMedia && window.matchMedia("(max-width: 640px)").matches
    ? 12
    : 24;

// Formatter de dată coerent în toată lista
const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default function Wishlist() {
  const nav = useNavigate();

  // auth
  const [me, setMe] = useState(null);
  const myVendorId = me?.vendor?.id || null;

  // data
  const [sort, setSort] = useState("newest"); // "newest" | "oldest"
  const [pages, setPages] = useState([]); // [{ items, nextCursor, hasMore }]
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [error, setError] = useState("");

  // selection — ținută în state ca Set (clone la update)
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const selectAllRef = useRef(null);

  // ===== fetch me =====
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const d = await api("/api/auth/me", { signal: ac.signal });
        setMe(d?.user || null);
      } catch (e) {
        if (e?.name !== "AbortError") setMe(null);
      }
    })();
    return () => ac.abort();
  }, []);

  // ===== fetch first page =====
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      if (!me) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      setSelectedIds(new Set()); // clear selection
      try {
        const q = new URLSearchParams({ limit: String(PAGE_SIZE), sort });
        const res = await api(`/api/favorites?${q.toString()}`, { signal: ac.signal });
        setPages([
          { items: res?.items || [], nextCursor: res?.nextCursor || null, hasMore: !!res?.hasMore },
        ]);
        setCursor(res?.nextCursor || null);
        setHasMore(!!res?.hasMore);
      } catch (e) {
        if (e?.name === "AbortError") return;
        setError(e?.message || "Nu am putut încărca wishlist-ul.");
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [me, sort]);

  // ===== infinite scroll =====
  useEffect(() => {
    if (!hasMore || !cursor) return;
    const el = document.getElementById("wl-sentinel");
    if (!el) return;

    let unmounted = false;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach(async (entry) => {
          if (!entry.isIntersecting) return;
          if (loadingMoreRef.current) return;
          loadingMoreRef.current = true;
          setLoadingMore(true);
          try {
            const q = new URLSearchParams({ limit: String(PAGE_SIZE), sort, cursor });
            const res = await api(`/api/favorites?${q.toString()}`);
            if (!unmounted) {
              setPages((p) => [
                ...p,
                {
                  items: res?.items || [],
                  nextCursor: res?.nextCursor || null,
                  hasMore: !!res?.hasMore,
                },
              ]);
              setCursor(res?.nextCursor || null);
              setHasMore(!!res?.hasMore);
            }
          } catch {
            /* silent */
          } finally {
            setLoadingMore(false);
            loadingMoreRef.current = false;
          }
        });
      },
      { rootMargin: "200px" }
    );

    io.observe(el);
    return () => {
      unmounted = true;
      io.disconnect();
    };
  }, [cursor, hasMore, sort]);

  // items derivat — include 'pages' în deps
  const items = useMemo(() => pages.flatMap((p) => p.items || []), [pages]);

  // allIds derivat
  const allIds = useMemo(() => items.map((it) => it.card.id), [items]);

  // selection helpers
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const selectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      allIds.forEach((id) => next.add(id));
      return next;
    });
  }, [allIds]);

  const allSelected = selectedIds.size && selectedIds.size === allIds.length;
  const someSelected = selectedIds.size && selectedIds.size < allIds.length;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = !!someSelected;
  }, [someSelected]);

  // mutations
  const removeOne = useCallback(
    async (productId) => {
      if (!window.confirm("Sigur vrei să elimini produsul din wishlist?")) return;
      const prev = JSON.parse(JSON.stringify(pages));
      setPages((p) =>
        p.map((pg) => ({ ...pg, items: pg.items.filter((it) => it.card.id !== productId) }))
      );
      try {
        await api(`/api/favorites/${encodeURIComponent(productId)}`, { method: "DELETE" });
      } catch {
        setPages(prev);
      }
    },
    [pages]
  );

  const removeSelected = useCallback(
    async () => {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;
      const prevPages = pages;
      const prevSelection = new Set(selectedIds);
      setPages((p) =>
        p.map((pg) => ({ ...pg, items: pg.items.filter((it) => !ids.includes(it.card.id)) }))
      );
      clearSelection();
      try {
        await api("/api/favorites/bulk", { method: "POST", body: { remove: ids, add: [] } });
      } catch {
        setPages(prevPages);
        setSelectedIds(prevSelection);
      }
    },
    [clearSelection, pages, selectedIds]
  );

  const addToCart = useCallback(
    async (row) => {
      const isOwner = !!myVendorId && !!row.card.vendorId && myVendorId === row.card.vendorId;
      if (isOwner) return;
      try {
        await api("/api/cart/add", { method: "POST", body: { productId: row.card.id, qty: 1 } });
      } catch {
        /* toast error optional */
      }
    },
    [myVendorId]
  );

  // === RENDER ===
  if (loading) return <div className={styles.container}>Se încarcă…</div>;

  if (!me) {
    return (
      <div className={styles.container}>
        <h2 className={styles.title}>Wishlist</h2>
        <p>
          Te rugăm să te{" "}
          <Link to="/autentificare" className={styles.linkPrimary}>
            autentifici
          </Link>{" "}
          pentru a-ți vedea wishlist-ul.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* ===== Header ===== */}
      <div className={styles.head}>
        <h2 className={styles.title}>Wishlist</h2>
        <div className={styles.controls}>
          <label className={styles.muted}>
            Sortare:&nbsp;
            <select className={styles.select} value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="newest">Cele mai noi</option>
              <option value="oldest">Cele mai vechi</option>
            </select>
          </label>

          <label className={styles.muted}>
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={!!allSelected}
              onChange={() => (allSelected ? clearSelection() : selectAll())}
            />
            &nbsp;Selectează tot
          </label>

          <button
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={removeSelected}
            disabled={!selectedIds.size}
          >
            Elimină selecția
          </button>
        </div>
      </div>

      {error && <div className={styles.alert}>{error}</div>}

      {items.length === 0 ? (
        <div className={styles.empty}>Nu ai produse în wishlist.</div>
      ) : (
        <div className={styles.grid}>
          {items.map((it) => {
            const img = resolveImg(it.card.images?.[0]);
            const isOwner = !!myVendorId && !!it.card.vendorId && myVendorId === it.card.vendorId;
            const checked = selectedIds.has(it.card.id);

            return (
              <article
                key={it.card.id}
                className={styles.card}
                data-selected={checked ? "true" : "false"} // fallback fără :has()
              >
                <label className={styles.cardTop}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelect(it.card.id)}
                  />
                  <span className={styles.cardDate}>
                    Adăugat: {dateFmt.format(new Date(it.createdAt))}
                  </span>
                </label>

                <button
                  className={styles.thumbBtn}
                  onClick={() => nav(`/produs/${it.card.id}`)}
                  aria-label={`Deschide ${it.card.title || "Produs"}`}
                >
                  <img
                    className={styles.thumb}
                    src={img}
                    alt={it.card.title || "Produs"}
                    decoding="async"
                    loading="lazy"
                    onError={(e) => onImgError(e, 480, 360, "Produs")}
                  />
                </button>

                <div className={styles.cardBody}>
                  <div className={styles.cardTitle}>{it.card.title}</div>
                  {typeof it.card.price === "number" && (
                    <div className={styles.cardPrice}>
                      {money(it.card.price, it.card.currency)}
                    </div>
                  )}
                  <div className={styles.cardMeta}>
                    Magazin:{" "}
                    {it.card.vendorSlug ? (
                      <Link to={`/magazin/${it.card.vendorSlug}`} className={styles.linkPrimary}>
                        {it.card.vendorName}
                      </Link>
                    ) : (
                      it.card.vendorName
                    )}
                  </div>

                  <div className={styles.actions}>
                    {!isOwner && (
                      <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => addToCart(it)}>
                        <FaShoppingCart style={{ marginRight: 6 }} /> Adaugă în coș
                      </button>
                    )}
                    <button className={styles.btn} onClick={() => removeOne(it.card.id)}>
                      <FaTrash style={{ marginRight: 6 }} /> Elimină
                    </button>
                  </div>

                  {it.card.isActive === false && (
                    <div className={styles.stateWarning}>Produsul nu mai este activ.</div>
                  )}
                  {it.card.stock === 0 && <div className={styles.stateDanger}>Stoc epuizat.</div>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div id="wl-sentinel" className={styles.sentinel} />
      {loadingMore && <div>Se încarcă mai multe…</div>}
    </div>
  );
}
