// ==============================
// File: src/pages/Wishlist/Wishlist.jsx
// ==============================
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { FaTrash, FaShoppingCart, FaFilter } from "react-icons/fa";
import { api } from "../../lib/api";
import styles from "./Wishlist.module.css";

// === Helpers globale pentru wishlist ===
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
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const [error, setError] = useState("");
  const [totalCount, setTotalCount] = useState(null); // total din backend

  // referință la ultima stare de pages pentru rollback sigur
  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  // selection
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const selectAllRef = useRef(null);

  // feedback mic (bară info)
  const [info, setInfo] = useState("");
  const infoTimeoutRef = useRef(null);

  // UI mobil – panou acțiuni / filtre
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);

  const showInfo = useCallback((msg) => {
    setInfo(msg);
    if (!msg) return;

    if (infoTimeoutRef.current) {
      clearTimeout(infoTimeoutRef.current);
    }

    infoTimeoutRef.current = setTimeout(() => {
      setInfo((cur) => (cur === msg ? "" : cur));
      infoTimeoutRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (infoTimeoutRef.current) {
        clearTimeout(infoTimeoutRef.current);
      }
    };
  }, []);

  // ===== fetch me =====
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

  // ===== fetch first page =====
  useEffect(() => {
    if (authLoading) return;
    const ac = new AbortController();
    (async () => {
      if (!me) {
        // guest: curățăm datele și nu mai încărcăm nimic
        setPages([]);
        setCursor(null);
        setHasMore(false);
        setTotalCount(0);
        setLoading(false);
        setSelectedIds(new Set());
        return;
      }

      setLoading(true);
      setError("");
      setSelectedIds(new Set()); // clear selection

      try {
        const q = new URLSearchParams({ limit: String(PAGE_SIZE), sort });
        const res = await api(`/api/favorites?${q.toString()}`, {
          signal: ac.signal,
        });
        const firstItems = res?.items || [];
        const hasMoreRes = !!res?.hasMore;
        const nextCursorRes = res?.nextCursor || null;

        setPages([
          {
            items: firstItems,
            nextCursor: nextCursorRes,
            hasMore: hasMoreRes,
          },
        ]);
        setCursor(nextCursorRes);
        setHasMore(hasMoreRes);

        if (typeof res?.totalCount === "number") {
          setTotalCount(res.totalCount);
        } else {
          // păstrăm ce aveam deja sau fallback la nr. de iteme
          setTotalCount((prev) =>
            typeof prev === "number" ? prev : firstItems.length
          );
        }
      } catch (e) {
        if (e?.name === "AbortError") return;
        setError(e?.message || "Nu am putut încărca wishlist-ul.");
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [me, sort, authLoading]);

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
            const q = new URLSearchParams({
              limit: String(PAGE_SIZE),
              sort,
              cursor,
            });
            const res = await api(`/api/favorites?${q.toString()}`);
            if (!unmounted) {
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
            }
          } catch (e) {
            console.error("Wishlist infinite scroll failed:", e);
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

  // items derivat
  const items = useMemo(
    () => pages.flatMap((p) => p.items || []),
    [pages]
  );

  const allIds = useMemo(
    () => items.map((it) => it.card.id),
    [items]
  );

  // selection helpers
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(
    () => setSelectedIds(new Set()),
    []
  );

  const selectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      allIds.forEach((id) => next.add(id));
      return next;
    });
  }, [allIds]);

  const allSelected =
    selectedIds.size && selectedIds.size === allIds.length;
  const someSelected =
    selectedIds.size && selectedIds.size < allIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !!someSelected;
    }
  }, [someSelected]);

  // mutations
  const removeOne = useCallback(
    async (productId) => {
      if (
        !window.confirm(
          "Sigur vrei să elimini produsul din wishlist?"
        )
      )
        return;

      const prevPages = pagesRef.current;

      setPages((p) =>
        p.map((pg) => ({
          ...pg,
          items: pg.items.filter((it) => it.card.id !== productId),
        }))
      );

      try {
        await api(
          `/api/favorites/${encodeURIComponent(productId)}`,
          { method: "DELETE" }
        );
        setTotalCount((prevCount) =>
          typeof prevCount === "number"
            ? Math.max(prevCount - 1, 0)
            : prevCount
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

      if (
        !window.confirm(
          `Sigur vrei să elimini ${ids.length} produs(e) din wishlist?`
        )
      ) {
        return;
      }

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
          typeof prevCount === "number"
            ? Math.max(prevCount - ids.length, 0)
            : prevCount
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

  // clear all wishlist
  const clearAll = useCallback(
    async () => {
      if (
        !items.length ||
        !window.confirm("Sigur vrei să golești complet wishlist-ul?")
      ) {
        return;
      }

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

  // add to cart (single)
  const addToCart = useCallback(
    async (row) => {
      const isOwner =
        !!myVendorId &&
        !!row.card.vendorId &&
        myVendorId === row.card.vendorId;

      if (isOwner) {
        alert("Nu poți adăuga în coș un produs care îți aparține.");
        return;
      }

      if (row.card.isActive === false || row.card.stock === 0) {
        alert("Acest produs nu este disponibil pentru comandă.");
        return;
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
        } catch {
          /* ignore */
        }

        showInfo("Produs adăugat în coș.");
      } catch (e) {
        console.error("addToCart failed:", e);
        alert(
          e?.message ||
            "Nu am putut adăuga produsul în coș. Încearcă din nou."
        );
      }
    },
    [myVendorId, showInfo]
  );

  // add selected to cart (bulk)
  const addSelectedToCart = useCallback(
    async () => {
      const ids = Array.from(selectedIds);
      if (!ids.length) return;

      if (
        !window.confirm(
          `Adaugi în coș ${ids.length} produs(e) selectate?`
        )
      ) {
        return;
      }

      const idsSet = new Set(ids);
      const targetItems = items.filter((row) =>
        idsSet.has(row.card.id)
      );

      let success = 0;
      let failed = 0;

      for (const row of targetItems) {
        const isOwner =
          !!myVendorId &&
          !!row.card.vendorId &&
          myVendorId === row.card.vendorId;

        if (
          isOwner ||
          row.card.isActive === false ||
          row.card.stock === 0
        ) {
          failed++;
          continue;
        }

        try {
          const res = await api("/api/cart/add", {
            method: "POST",
            body: { productId: row.card.id, qty: 1 },
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
        } catch {
          /* ignore */
        }
      }

      if (success && !failed) {
        showInfo(`Am adăugat ${success} produs(e) în coș.`);
      } else if (success && failed) {
        showInfo(
          `Am adăugat ${success} produs(e) în coș. ${failed} au fost sărite (indisponibile sau produse proprii).`
        );
      } else {
        alert(
          "Nu am putut adăuga niciun produs în coș (pot fi indisponibile sau îți aparțin)."
        );
      }
    },
    [items, myVendorId, selectedIds, showInfo]
  );

  // === RENDER ===
  if (authLoading || loading) {
    return <div className={styles.container}>Se încarcă…</div>;
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
  const totalItems =
    typeof totalCount === "number" ? totalCount : items.length;

  return (
    <div className={styles.container}>
      {/* ===== Header DESKTOP ===== */}
      <div className={styles.head}>
        <div>
          <h2 className={styles.title}>Wishlist</h2>
          <p className={styles.muted}>
            Ai {totalItems} produs(e) în wishlist.
          </p>
        </div>

        <div className={styles.controls}>
          <label className={styles.muted}>
            Sortare:&nbsp;
            <select
              className={styles.select}
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="newest">Cele mai noi</option>
              <option value="oldest">Cele mai vechi</option>
            </select>
          </label>

          <label className={styles.muted}>
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={!!allSelected}
              onChange={() =>
                allSelected ? clearSelection() : selectAll()
              }
            />
            &nbsp;Selectează tot (vizibil)
          </label>

          <span className={styles.muted}>
            Selectate: {selectedCount}
          </span>

          <button
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={addSelectedToCart}
            disabled={!selectedCount}
          >
            <FaShoppingCart style={{ marginRight: 6 }} />
            Adaugă selecția în coș
          </button>

          <button
            className={`${styles.btn} ${styles.btnDanger}`}
            onClick={removeSelected}
            disabled={!selectedCount}
          >
            Elimină selecția
          </button>

          <button
            className={`${styles.btn} ${styles.btnGhost || ""}`}
            onClick={clearAll}
            disabled={!items.length}
          >
            Golește tot
          </button>
        </div>
      </div>

      {/* ===== Header MOBIL compact cu buton filtrare/acțiuni ===== */}
      <div className={styles.headMobile}>
        <div>
          <h2 className={styles.title}>Wishlist</h2>
          <p className={styles.muted}>
            Ai {totalItems} produs(e) în wishlist.
          </p>
        </div>
        <button
          type="button"
          className={styles.controlsMobileToggle}
          onClick={() =>
            setMobileControlsOpen((open) => !open)
          }
          aria-expanded={mobileControlsOpen ? "true" : "false"}
          aria-controls="wishlist-mobile-controls"
        >
          <FaFilter className={styles.controlsMobileIcon} />
          <span>Acțiuni</span>
        </button>
      </div>

      {mobileControlsOpen && (
        <div
          id="wishlist-mobile-controls"
          className={styles.controlsMobilePanel}
        >
          <div className={styles.controlsMobileRow}>
            <label className={styles.muted}>
              Sortare:&nbsp;
              <select
                className={styles.select}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="newest">Cele mai noi</option>
                <option value="oldest">Cele mai vechi</option>
              </select>
            </label>
          </div>

          <div className={styles.controlsMobileRow}>
            <label className={styles.muted}>
              <input
                type="checkbox"
                checked={!!allSelected}
                onChange={() =>
                  allSelected ? clearSelection() : selectAll()
                }
              />
              &nbsp;Selectează tot (vizibil)
            </label>
            <span className={styles.muted}>
              Selectate: {selectedCount}
            </span>
          </div>

          <div className={styles.controlsMobileActions}>
            <button
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={addSelectedToCart}
              disabled={!selectedCount}
            >
              <FaShoppingCart style={{ marginRight: 6 }} />
              În coș (selecția)
            </button>

            <button
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={removeSelected}
              disabled={!selectedCount}
            >
              Elimină selecția
            </button>

            <button
              className={`${styles.btn} ${styles.btnGhost || ""}`}
              onClick={clearAll}
              disabled={!items.length}
            >
              Golește tot
            </button>
          </div>
        </div>
      )}

      {info && (
        <div
          className={styles.infoBar}
          role="status"
          aria-live="polite"
        >
          {info}
        </div>
      )}

      {error && (
        <div className={styles.alert} role="alert">
          {error}
        </div>
      )}

      {items.length === 0 ? (
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
            const isOwner =
              !!myVendorId &&
              !!it.card.vendorId &&
              myVendorId === it.card.vendorId;
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
                  <span
                    className={styles.cardDate}
                    title={createdAtDate.toISOString()}
                  >
                    Adăugat: {dateFmt.format(createdAtDate)}
                  </span>
                </label>

                <button
                  className={styles.thumbBtn}
                  onClick={() => nav(`/produs/${it.card.id}`)}
                  aria-label={`Deschide ${
                    it.card.title || "Produs"
                  }`}
                >
                  <img
                    className={styles.thumb}
                    src={img}
                    alt={it.card.title || "Produs"}
                    decoding="async"
                    loading="lazy"
                    onError={(e) =>
                      onImgError(e, 480, 360, "Produs")
                    }
                  />
                </button>

                <div className={styles.cardBody}>
                  <div className={styles.cardTitle}>
                    {it.card.title}
                  </div>

                  {typeof it.card.price === "number" && (
                    <div className={styles.cardPrice}>
                      {money(it.card.price, it.card.currency)}
                    </div>
                  )}

                  <div className={styles.cardMeta}>
                    Magazin:{" "}
                    {it.card.vendorSlug ? (
                      <Link
                        to={`/magazin/${it.card.vendorSlug}`}
                        className={styles.linkPrimary}
                      >
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
      disabled={
        it.card.isActive === false ||
        it.card.stock === 0
      }
      title={
        it.card.isActive === false
          ? "Produsul nu mai este activ."
          : it.card.stock === 0
          ? "Stoc epuizat."
          : "Adaugă în coș"
      }
      aria-label={
        it.card.isActive === false
          ? "Produsul nu mai este activ."
          : it.card.stock === 0
          ? "Stoc epuizat."
          : "Adaugă în coș"
      }
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
                    <div className={styles.stateWarning}>
                      Produsul nu mai este activ.
                    </div>
                  )}
                  {it.card.stock === 0 && (
                    <div className={styles.stateDanger}>
                      Stoc epuizat.
                    </div>
                  )}
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
