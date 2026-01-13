// ==============================
// File: src/pages/Wishlist/Wishlist.jsx
// ==============================
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaTrash, FaShoppingCart, FaFilter } from "react-icons/fa";
import { api } from "../../lib/api";
import styles from "./Wishlist.module.css";

/* ===================== Helpers globale ===================== */
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

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

// SSR-safe PAGE_SIZE
const isClient = typeof window !== "undefined";
const PAGE_SIZE =
  isClient &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(max-width: 640px)").matches
    ? 12
    : 24;

/* ===================== UI bits ===================== */
function SkeletonCard() {
  return (
    <article className={styles.card} aria-hidden="true">
      <div className={styles.cardTop} style={{ opacity: 0.6 }}>
        <span style={{ width: 120, height: 14, display: "inline-block", background: "#eee", borderRadius: 6 }} />
      </div>
      <div className={styles.thumbBtn} style={{ cursor: "default" }}>
        <div style={{ width: "100%", aspectRatio: "4/3", background: "#eee", borderRadius: 12 }} />
      </div>
      <div className={styles.cardBody}>
        <div style={{ width: "70%", height: 14, background: "#eee", borderRadius: 6, marginBottom: 10 }} />
        <div style={{ width: "40%", height: 14, background: "#eee", borderRadius: 6, marginBottom: 10 }} />
        <div style={{ width: "55%", height: 14, background: "#eee", borderRadius: 6, marginBottom: 12 }} />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ width: 40, height: 36, background: "#eee", borderRadius: 10 }} />
          <div style={{ width: 40, height: 36, background: "#eee", borderRadius: 10 }} />
        </div>
      </div>
    </article>
  );
}

/* ===================== Component ===================== */
export default function Wishlist() {
  const nav = useNavigate();

  // auth
  const [me, setMe] = useState(undefined); // undefined = încă nu știm
  const [authLoading, setAuthLoading] = useState(true);
  const myVendorId = me?.vendor?.id || null;

  // data
  const [sort, setSort] = useState("newest"); // "newest" | "oldest"
  const [pages, setPages] = useState([]); // [{ items, nextCursor, hasMore }]
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [totalCount, setTotalCount] = useState(null);

  // loading states (separate ca UI-ul să nu se blocheze)
  const [initialLoading, setInitialLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // guards
  const loadingMoreRef = useRef(false);
  const inflightKeyRef = useRef(""); // de-dupe pentru first fetch
  const prefetchRef = useRef({ key: "", promise: null, data: null });

  // referință la ultima stare de pages pentru rollback sigur
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // selection
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const selectAllRef = useRef(null);

  // info bar
  const [info, setInfo] = useState("");
  const infoTimeoutRef = useRef(null);

  // UI mobil
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);

  const showInfo = useCallback((msg) => {
    setInfo(msg);
    if (!msg) return;

    if (infoTimeoutRef.current) clearTimeout(infoTimeoutRef.current);

    infoTimeoutRef.current = setTimeout(() => {
      setInfo((cur) => (cur === msg ? "" : cur));
      infoTimeoutRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (infoTimeoutRef.current) clearTimeout(infoTimeoutRef.current);
    };
  }, []);

  /* ===================== fetch me (non-blocking UI) ===================== */
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const d = await api("/api/auth/me", { signal: ac.signal });
        setMe(d?.user || null);
      } catch (e) {
        if (e?.name !== "AbortError") setMe(null);
      } finally {
        setAuthLoading(false);
      }
    })();
    return () => ac.abort();
  }, []);

  /* ===================== helpers fetch favorites ===================== */
  const fetchFavoritesPage = useCallback(async ({ limit, sort, cursor, signal }) => {
    const q = new URLSearchParams({
      limit: String(limit),
      sort,
      ...(cursor ? { cursor } : {}),
    });
    return api(`/api/favorites?${q.toString()}`, { signal });
  }, []);

  /* ===================== first page ===================== */
  useEffect(() => {
    if (authLoading) return;

    const ac = new AbortController();

    (async () => {
      if (!me) {
        setPages([]);
        setCursor(null);
        setHasMore(false);
        setTotalCount(0);
        setInitialLoading(false);
        setSelectedIds(new Set());
        setError("");
        return;
      }

      const key = `first:${sort}:${PAGE_SIZE}`;
      if (inflightKeyRef.current === key) return;
      inflightKeyRef.current = key;

      setInitialLoading(true);
      setError("");
      setSelectedIds(new Set());

      try {
        const res = await fetchFavoritesPage({
          limit: PAGE_SIZE,
          sort,
          cursor: null,
          signal: ac.signal,
        });

        const firstItems = res?.items || [];
        const hasMoreRes = !!res?.hasMore;
        const nextCursorRes = res?.nextCursor || null;

        setPages([
          { items: firstItems, nextCursor: nextCursorRes, hasMore: hasMoreRes },
        ]);
        setCursor(nextCursorRes);
        setHasMore(hasMoreRes);

        if (typeof res?.totalCount === "number") setTotalCount(res.totalCount);
        else setTotalCount(firstItems.length);

        // pregătește prefetch imediat dacă există next cursor
        prefetchRef.current = { key: "", promise: null, data: null };
      } catch (e) {
        if (e?.name === "AbortError") return;
        setError(e?.message || "Nu am putut încărca wishlist-ul.");
      } finally {
        setInitialLoading(false);
        inflightKeyRef.current = "";
      }
    })();

    return () => ac.abort();
  }, [authLoading, me, sort, fetchFavoritesPage]);

  /* ===================== prefetch next page (smooth scroll) ===================== */
  useEffect(() => {
    if (!me) return;
    if (!hasMore || !cursor) return;

    const key = `prefetch:${sort}:${PAGE_SIZE}:${cursor}`;
    if (prefetchRef.current.key === key) return;

    const ac = new AbortController();
    prefetchRef.current.key = key;
    prefetchRef.current.data = null;

    prefetchRef.current.promise = (async () => {
      try {
        const res = await fetchFavoritesPage({
          limit: PAGE_SIZE,
          sort,
          cursor,
          signal: ac.signal,
        });
        prefetchRef.current.data = res || null;
      } catch {
        // ignore
      }
    })();

    return () => ac.abort();
  }, [me, hasMore, cursor, sort, fetchFavoritesPage]);

  /* ===================== infinite scroll (consumes prefetch first) ===================== */
  useEffect(() => {
    if (!hasMore || !cursor) return;

    const el = document.getElementById("wl-sentinel");
    if (!el) return;

    let unmounted = false;

    const io = new IntersectionObserver(
      async (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (loadingMoreRef.current) continue;

          loadingMoreRef.current = true;
          setLoadingMore(true);

          try {
            // 1) dacă avem prefetch gata pentru cursor curent, îl folosim
            const preKey = `prefetch:${sort}:${PAGE_SIZE}:${cursor}`;
            let res = null;

            if (prefetchRef.current.key === preKey) {
              // așteaptă puțin dacă încă rulează
              if (prefetchRef.current.promise) {
                await prefetchRef.current.promise;
              }
              res = prefetchRef.current.data;
            }

            // 2) fallback: fetch direct
            if (!res) {
              res = await fetchFavoritesPage({
                limit: PAGE_SIZE,
                sort,
                cursor,
                signal: undefined,
              });
            }

            if (unmounted) return;

            const itemsRes = res?.items || [];
            const hasMoreRes = !!res?.hasMore;
            const nextCursorRes = res?.nextCursor || null;

            setPages((p) => [
              ...p,
              {
                items: itemsRes,
                nextCursor: nextCursorRes,
                hasMore: hasMoreRes,
              },
            ]);
            setCursor(nextCursorRes);
            setHasMore(hasMoreRes);

            // consumăm prefetch-ul
            prefetchRef.current = { key: "", promise: null, data: null };
          } catch (e) {
            console.error("Wishlist infinite scroll failed:", e);
          } finally {
            setLoadingMore(false);
            loadingMoreRef.current = false;
          }
        }
      },
      { rootMargin: "600px" } // ✅ mai devreme => pare instant
    );

    io.observe(el);
    return () => {
      unmounted = true;
      io.disconnect();
    };
  }, [cursor, hasMore, sort, fetchFavoritesPage]);

  /* ===================== derived items ===================== */
  const items = useMemo(() => pages.flatMap((p) => p.items || []), [pages]);
  const allIds = useMemo(() => items.map((it) => it.card.id), [items]);

  /* ===================== selection helpers ===================== */
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

  /* ===================== mutations ===================== */
  const removeOne = useCallback(
    async (productId) => {
      if (!window.confirm("Sigur vrei să elimini produsul din wishlist?")) return;

      const prevPages = pagesRef.current;

      setPages((p) =>
        p.map((pg) => ({
          ...pg,
          items: pg.items.filter((it) => it.card.id !== productId),
        }))
      );

      try {
        await api(`/api/favorites/${encodeURIComponent(productId)}`, { method: "DELETE" });
        setTotalCount((prevCount) =>
          typeof prevCount === "number" ? Math.max(prevCount - 1, 0) : prevCount
        );
        showInfo("Produs eliminat din wishlist.");
      } catch (e) {
        console.error("removeOne failed:", e);
        setPages(prevPages);
        alert("Nu am putut elimina produsul din wishlist.");
      }
    },
    [showInfo]
  );

  const removeSelected = useCallback(
    async () => {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;

      if (!window.confirm(`Sigur vrei să elimini ${ids.length} produs(e) din wishlist?`)) return;

      const idsSet = new Set(ids);
      const prevPages = pagesRef.current;
      const prevSelection = new Set(selectedIds);

      setPages((p) =>
        p.map((pg) => ({
          ...pg,
          items: pg.items.filter((it) => !idsSet.has(it.card.id)),
        }))
      );
      clearSelection();

      try {
        await api("/api/favorites/bulk", {
          method: "POST",
          body: { remove: ids, add: [] },
        });
        setTotalCount((prevCount) =>
          typeof prevCount === "number" ? Math.max(prevCount - ids.length, 0) : prevCount
        );
        showInfo("Selecția a fost eliminată din wishlist.");
      } catch (e) {
        console.error("removeSelected failed:", e);
        setPages(prevPages);
        setSelectedIds(prevSelection);
        alert("Nu am putut elimina selecția.");
      }
    },
    [clearSelection, selectedIds, showInfo]
  );

  const clearAll = useCallback(
    async () => {
      if (!items.length || !window.confirm("Sigur vrei să golești complet wishlist-ul?")) return;

      const prevPages = pagesRef.current;

      setPages([]);
      setSelectedIds(new Set());
      setTotalCount(0);

      try {
        await api("/api/favorites", { method: "DELETE" });
        showInfo("Ai golit wishlist-ul.");
      } catch (e) {
        console.error("clearAll failed:", e);
        setPages(prevPages);
        alert("Nu am putut goli wishlist-ul.");
      }
    },
    [items, showInfo]
  );

  const addToCart = useCallback(
    async (row) => {
      const isOwner = !!myVendorId && !!row.card.vendorId && myVendorId === row.card.vendorId;
      if (isOwner) return alert("Nu poți adăuga în coș un produs care îți aparține.");

      if (row.card.isActive === false || row.card.stock === 0) {
        return alert("Acest produs nu este disponibil pentru comandă.");
      }

      try {
        const res = await api("/api/cart/add", {
          method: "POST",
          body: { productId: row.card.id, qty: 1 },
        });

        if (res?.error === "cannot_add_own_product") {
          alert("Nu poți adăuga în coș un produs care îți aparține.");
          return;
        }

        try {
          window.dispatchEvent(new CustomEvent("cart:changed"));
        } catch {""}

        showInfo("Produs adăugat în coș.");
      } catch (e) {
        console.error("addToCart failed:", e);
        alert(e?.message || "Nu am putut adăuga produsul în coș. Încearcă din nou.");
      }
    },
    [myVendorId, showInfo]
  );

  // ✅ bulk add: încearcă /api/cart/merge (1 request). fallback loop.
  const addSelectedToCart = useCallback(
    async () => {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;

      if (!window.confirm(`Adaugi în coș ${ids.length} produs(e) selectate?`)) return;

      const idsSet = new Set(ids);
      const targetItems = items.filter((row) => idsSet.has(row.card.id));

      const valid = [];
      let skipped = 0;

      for (const row of targetItems) {
        const isOwner = !!myVendorId && !!row.card.vendorId && myVendorId === row.card.vendorId;
        if (isOwner || row.card.isActive === false || row.card.stock === 0) {
          skipped++;
          continue;
        }
        valid.push({ productId: row.card.id, qty: 1 });
      }

      if (!valid.length) {
        alert("Nu am putut adăuga niciun produs în coș (pot fi indisponibile sau îți aparțin).");
        return;
      }

      // 1) merge (rapid)
      try {
        const res = await api("/api/cart/merge", { method: "POST", body: { items: valid } });
        // dacă route există, aici e super rapid
        try {
          window.dispatchEvent(new CustomEvent("cart:changed"));
        } catch {""}
        const merged = typeof res?.merged === "number" ? res.merged : valid.length;
        const skippedRes = typeof res?.skipped === "number" ? res.skipped : skipped;

        if (merged && !skippedRes) showInfo(`Am adăugat ${merged} produs(e) în coș.`);
        else showInfo(`Am adăugat ${merged} produs(e) în coș. ${skippedRes} au fost sărite.`);
        return;
      } catch {
        // 2) fallback loop
      }

      let success = 0;
      let failed = skipped;

      for (const it of valid) {
        try {
          const res = await api("/api/cart/add", {
            method: "POST",
            body: { productId: it.productId, qty: 1 },
          });
          if (res?.error === "cannot_add_own_product") {
            failed++;
            continue;
          }
          success++;
        } catch {
          failed++;
        }
      }

      if (success > 0) {
        try {
          window.dispatchEvent(new CustomEvent("cart:changed"));
        } catch {""}
      }

      if (success && !failed) showInfo(`Am adăugat ${success} produs(e) în coș.`);
      else if (success && failed)
        showInfo(
          `Am adăugat ${success} produs(e) în coș. ${failed} au fost sărite (indisponibile sau produse proprii).`
        );
      else alert("Nu am putut adăuga niciun produs în coș (pot fi indisponibile sau îți aparțin).");
    },
    [items, myVendorId, selectedIds, showInfo]
  );

  /* ===================== RENDER ===================== */

  // ✅ nu mai blocăm cu "Se încarcă…" full screen
  if (authLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.head}>
          <div>
            <h2 className={styles.title}>Wishlist</h2>
            <p className={styles.muted}>Se pregătește…</p>
          </div>
        </div>

        <div className={styles.grid}>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

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

  const selectedCount = selectedIds.size;
  const totalItems = typeof totalCount === "number" ? totalCount : items.length;

  return (
    <div className={styles.container}>
      {/* ===== Header DESKTOP ===== */}
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>Wishlist</h2>
          <p className={styles.muted}>Ai {totalItems} produs(e) în wishlist.</p>
        </div>

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
            &nbsp;Selectează tot (vizibil)
          </label>

          <span className={styles.muted}>Selectate: {selectedCount}</span>

          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={addSelectedToCart}
            disabled={!selectedCount}
          >
            <FaShoppingCart style={{ marginRight: 6 }} />
            Adaugă selecția în coș
          </button>

          <button className={`${styles.btn} ${styles.btnDanger}`} onClick={removeSelected} disabled={!selectedCount}>
            Elimină selecția
          </button>

          <button className={`${styles.btn} ${styles.btnGhost || ""}`} onClick={clearAll} disabled={!items.length}>
            Golește tot
          </button>
        </div>
      </div>

      {/* ===== Header MOBIL ===== */}
      <div className={styles.headMobile}>
        <div>
          <h2 className={styles.title}>Wishlist</h2>
          <p className={styles.muted}>Ai {totalItems} produs(e) în wishlist.</p>
        </div>
        <button
          type="button"
          className={styles.controlsMobileToggle}
          onClick={() => setMobileControlsOpen((open) => !open)}
          aria-expanded={mobileControlsOpen ? "true" : "false"}
          aria-controls="wishlist-mobile-controls"
        >
          <FaFilter className={styles.controlsMobileIcon} />
          <span>Acțiuni</span>
        </button>
      </div>

      {mobileControlsOpen && (
        <div id="wishlist-mobile-controls" className={styles.controlsMobilePanel}>
          <div className={styles.controlsMobileRow}>
            <label className={styles.muted}>
              Sortare:&nbsp;
              <select className={styles.select} value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">Cele mai noi</option>
                <option value="oldest">Cele mai vechi</option>
              </select>
            </label>
          </div>

          <div className={styles.controlsMobileRow}>
            <label className={styles.muted}>
              <input type="checkbox" checked={!!allSelected} onChange={() => (allSelected ? clearSelection() : selectAll())} />
              &nbsp;Selectează tot (vizibil)
            </label>
            <span className={styles.muted}>Selectate: {selectedCount}</span>
          </div>

          <div className={styles.controlsMobileActions}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={addSelectedToCart} disabled={!selectedCount}>
              <FaShoppingCart style={{ marginRight: 6 }} />
              În coș (selecția)
            </button>

            <button className={`${styles.btn} ${styles.btnDanger}`} onClick={removeSelected} disabled={!selectedCount}>
              Elimină selecția
            </button>

            <button className={`${styles.btn} ${styles.btnGhost || ""}`} onClick={clearAll} disabled={!items.length}>
              Golește tot
            </button>
          </div>
        </div>
      )}

      {info && (
        <div className={styles.infoBar} role="status" aria-live="polite">
          {info}
        </div>
      )}

      {error && (
        <div className={styles.alert} role="alert">
          {error}
        </div>
      )}

      {/* ✅ skeleton în timp ce vine first page (fără flicker) */}
      {initialLoading && items.length === 0 ? (
        <div className={styles.grid}>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>
          Nu ai produse în wishlist.{" "}
          <Link to="/produse" className={styles.linkPrimary}>
            Vezi produsele recomandate
          </Link>
          .
        </div>
      ) : (
        <div className={styles.grid}>
          {items.map((it) => {
            const img = resolveImg(it.card.images?.[0]);
            const isOwner = !!myVendorId && !!it.card.vendorId && myVendorId === it.card.vendorId;
            const checked = selectedIds.has(it.card.id);
            const createdAtDate = new Date(it.createdAt);

            return (
              <article
                key={it.card.id}
                className={styles.card}
                data-selected={checked ? "true" : "false"}
              >
                <label className={styles.cardTop}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelect(it.card.id)}
                  />
                  <span className={styles.cardDate} title={createdAtDate.toISOString()}>
                    Adăugat: {dateFmt.format(createdAtDate)}
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
                      <button
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() => addToCart(it)}
                        disabled={it.card.isActive === false || it.card.stock === 0}
                        title={
                          it.card.isActive === false
                            ? "Produsul nu mai este activ."
                            : it.card.stock === 0
                            ? "Stoc epuizat."
                            : "Adaugă în coș"
                        }
                        aria-label="Adaugă în coș"
                      >
                        <FaShoppingCart />
                      </button>
                    )}

                    <button
                      className={`${styles.btn} ${styles.btnDanger}`}
                      onClick={() => removeOne(it.card.id)}
                      aria-label="Elimină din wishlist"
                    >
                      <FaTrash />
                    </button>
                  </div>

                  {it.card.isActive === false && (
                    <div className={styles.stateWarning}>Produsul nu mai este activ.</div>
                  )}
                  {it.card.stock === 0 && (
                    <div className={styles.stateDanger}>Stoc epuizat.</div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div id="wl-sentinel" className={styles.sentinel} />

      {loadingMore && <div className={styles.muted}>Se încarcă mai multe…</div>}
    </div>
  );
}
