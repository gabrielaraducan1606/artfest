import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter, RotateCcw, Search as SearchIcon } from "lucide-react";
import { api } from "../../../lib/api";
import styles from "./Orders.module.css";

import ReturnRequestModal from "./ReturnRequestModal/ReturnRequestModal";
import OrderCard from "./components/OrderCard";
import EmptyState from "./components/EmptyState";
import SkeletonOrderCard from "./components/SkeletonOrderCard";

/**
 * Status UI trimis de backend (computeUiStatus):
 *  PENDING | PROCESSING | SHIPPED | DELIVERED | CANCELED | RETURNED
 */
const STATUS_TABS = [
  { key: "all", label: "Toate" },
  { key: "active", label: "Active" },
  { key: "DELIVERED", label: "Livrate" },
  { key: "CANCELED", label: "Anulate" },
  { key: "RETURNED", label: "Returnate" },
];

function isUnauthorized(err) {
  const status = err?.status || err?.response?.status || err?.data?.statusCode;
  return status === 401 || status === 403;
}

function makeCacheKey({ statusParam, q }) {
  return `${statusParam || "all"}::${(q || "").trim()}`;
}

export default function OrdersPage() {
  const [me, setMe] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");

  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [busyId, setBusyId] = useState(null);

  const [isMobile, setIsMobile] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [returnOpen, setReturnOpen] = useState(false);
  const [returnOrderId, setReturnOrderId] = useState(null);

  const cacheRef = useRef(new Map());
  const abortRef = useRef(null);

  const openReturnModal = useCallback((order) => {
    setReturnOrderId(order?.id || null);
    setReturnOpen(true);
  }, []);

  const closeReturnModal = useCallback(() => {
    setReturnOpen(false);
    setReturnOrderId(null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const check = () => setIsMobile(window.innerWidth <= 640);
    check();

    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const statusParam = useMemo(() => {
    if (tab === "all") return "";
    if (tab === "active") return "PENDING,PROCESSING,SHIPPED";
    return tab;
  }, [tab]);

  const load = useCallback(
    async (opts = { reset: false, pageOverride: null, silent: false }) => {
      try {
        abortRef.current?.abort?.();
      } catch {""}

      const controller =
        typeof AbortController !== "undefined" ? new AbortController() : null;
      abortRef.current = controller;

      const limit = 10;
      const nextPage = opts.reset ? 1 : opts.pageOverride ?? page;

      const params = new URLSearchParams();
      params.set("page", String(nextPage));
      params.set("limit", String(limit));
      if (q.trim()) params.set("q", q.trim());
      if (statusParam) params.set("status", statusParam);

      const cacheKey = makeCacheKey({ statusParam, q });
      const noItemsYet = items.length === 0 && nextPage === 1;

      if (!opts.silent) {
        if (nextPage > 1) setLoadingMore(true);
        else if (noItemsYet) setLoadingInitial(true);
        else if (opts.reset) setRefreshing(true);
      }

      try {
        const res = await api(`/api/user/orders/my?${params.toString()}`, {
          signal: controller?.signal,
        });

        const newItems = Array.isArray(res?.items) ? res.items : [];

        setItems((prev) => (opts.reset ? newItems : [...prev, ...newItems]));

        let computedHasMore = false;
        if (typeof res?.hasMore === "boolean") {
          computedHasMore = res.hasMore;
          setHasMore(res.hasMore);
        } else {
          const total = Number(res?.total || 0);
          const totalPages = Math.ceil(total / limit) || 1;
          computedHasMore = nextPage < totalPages;
          setHasMore(computedHasMore);
        }

        const merged =
          opts.reset || nextPage === 1
            ? newItems
            : [...(cacheRef.current.get(cacheKey)?.items || []), ...newItems];

        cacheRef.current.set(cacheKey, {
          items: merged,
          page: nextPage,
          hasMore: computedHasMore,
          ts: Date.now(),
        });
      } catch (e) {
        if (e?.name === "AbortError") return;

        if (isUnauthorized(e)) {
          setMe(null);
          setAuthChecked(true);
          setItems([]);
          setHasMore(false);
          return;
        }

        console.error(e);
      } finally {
        if (!opts.silent) {
          setLoadingInitial(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [page, q, statusParam, items.length]
  );

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { user } = await api("/api/auth/me");
        if (alive) setMe(user || null);
      } catch {
        if (alive) setMe(null);
      } finally {
        if (alive) setAuthChecked(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const cacheKey = makeCacheKey({ statusParam, q });
    const cached = cacheRef.current.get(cacheKey);

    if (cached?.items?.length) {
      setItems(cached.items);
      setPage(cached.page || 1);
      setHasMore(!!cached.hasMore);
      setLoadingInitial(false);
    } else {
      setItems([]);
      setPage(1);
      setHasMore(true);
    }

    load({ reset: true, pageOverride: 1, silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (page === 1) return;
    load({ reset: false, pageOverride: page, silent: false });
  }, [page, load]);

  const onSearch = useCallback(
    (e) => {
      e.preventDefault();

      const cacheKey = makeCacheKey({ statusParam, q });
      const cached = cacheRef.current.get(cacheKey);

      if (cached?.items?.length) {
        setItems(cached.items);
        setHasMore(!!cached.hasMore);
        setLoadingInitial(false);
      }

      setPage(1);
      load({ reset: true, pageOverride: 1, silent: false });
    },
    [load, q, statusParam]
  );

  const resetFilters = useCallback(() => {
    setQ("");
    setTab("all");
    setPage(1);
    setItems([]);
    setHasMore(true);
  }, []);

  const openFiltersModal = useCallback(() => setFiltersOpen(true), []);
  const closeFiltersModal = useCallback(() => setFiltersOpen(false), []);

  const applyFiltersFromModal = useCallback(() => {
    setPage(1);
    setFiltersOpen(false);

    const cacheKey = makeCacheKey({ statusParam, q });
    const cached = cacheRef.current.get(cacheKey);

    if (cached?.items?.length) {
      setItems(cached.items);
      setHasMore(!!cached.hasMore);
      setLoadingInitial(false);
    }

    load({ reset: true, pageOverride: 1, silent: false });
  }, [load, q, statusParam]);

  const cancelOrder = useCallback(
    async (id) => {
      if (
        !window.confirm(
          "Sigur vrei să anulezi această comandă? La confirmare, artizanii vor primi automat o notificare cu anularea comenzii."
        )
      ) {
        return;
      }

      setBusyId(id);

      try {
        await api(`/api/user/orders/${id}/cancel`, { method: "POST" });
        setPage(1);
        await load({ reset: true, pageOverride: 1, silent: false });
      } catch (e) {
        alert(e?.message || "Nu am putut anula comanda.");
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const reorder = useCallback(async (id) => {
    setBusyId(id);

    try {
      await api(`/api/user/orders/${id}/reorder`, { method: "POST" });
      if (window.confirm("Produsele au fost adăugate în coș. Deschizi coșul?")) {
        window.location.assign("/cos");
      }
    } catch (e) {
      alert(
        e?.message ||
          "Nu am putut re-comanda. Unele produse ar putea să nu mai fie disponibile."
      );
    } finally {
      setBusyId(null);
    }
  }, []);

  const contactVendorForOrder = useCallback(async (order) => {
    try {
      const details = await api(`/api/user/orders/${encodeURIComponent(order.id)}`);

      const shipments = Array.isArray(details?.shipments) ? details.shipments : [];
      const first = shipments.find((s) => s?.vendorId);
      const vendorId = first?.vendorId || null;

      if (!vendorId) {
        alert(
          "Nu am putut identifica artizanul pentru această comandă. Te rugăm deschide detaliile comenzii sau contactează suportul."
        );
        return;
      }

      const res = await api("/api/user-inbox/ensure-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      });

      const threadId = res?.threadId;
      if (!threadId) throw new Error("Nu am primit ID-ul conversației.");

      window.location.assign(
        `/cont/mesaje?thread=${encodeURIComponent(threadId)}`
      );
    } catch (e) {
      console.error(e);
      alert(
        e?.message ||
          "Nu am putut deschide conversația cu artizanul. Încearcă din nou sau contactează suportul."
      );
    }
  }, []);

  if (!me && authChecked) {
    return (
      <div className={styles.page}>
        Trebuie să te autentifici pentru a vedea comenzile.
      </div>
    );
  }

  return (
    <>
      <section className={styles.page}>
        <header className={styles.head}>
          <div>
            <h1 className={styles.h1}>Comenzile mele</h1>
            <p className={styles.subtle}>
              Vizualizezi statusul comenzii tale așa cum este actualizat de
              artizani și curier.
            </p>
            {refreshing && (
              <p className={styles.subtle} style={{ marginTop: 6 }}>
                Se actualizează…
              </p>
            )}
          </div>

          <div className={styles.headRight}>
            <form className={styles.searchBar} onSubmit={onSearch}>
              <button
                type="submit"
                className={styles.searchBarIconBtn}
                aria-label="Caută"
              >
                <SearchIcon size={18} />
              </button>

              <input
                className={styles.searchBarInput}
                placeholder="Caută după produs sau număr comandă…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </form>

            <div className={styles.filterButtons}>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={resetFilters}
                title="Resetează filtrele"
              >
                <RotateCcw size={18} />
              </button>

              {isMobile && (
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={openFiltersModal}
                  title="Filtre"
                >
                  <Filter size={16} />
                  <span className={styles.iconBtnLabel}>Filtre</span>
                </button>
              )}
            </div>
          </div>
        </header>

        <div className={styles.tabs}>
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              className={`${styles.tab} ${tab === t.key ? styles.tabActive : ""}`}
              onClick={() => setTab(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.list}>
          {loadingInitial && items.length === 0 && (
            <>
              <SkeletonOrderCard />
              <SkeletonOrderCard />
              <SkeletonOrderCard />
            </>
          )}

          {items.length === 0 && !loadingInitial && !refreshing && (
            <EmptyState
              title="Nu ai comenzi în această listă."
              subtitle="Explorează catalogul și adaugă produse în coș."
              ctaText="Vezi Produse"
              href="/produse"
            />
          )}

          {items.length > 0 &&
            items.map((o) => (
              <OrderCard
                key={o.id}
                order={o}
                busy={busyId === o.id}
                onCancel={cancelOrder}
                onReorder={reorder}
                onContact={contactVendorForOrder}
                onReturn={openReturnModal}
              />
            ))}
        </div>

        {hasMore && (
          <div className={styles.loadMoreWrap}>
            <button
              className={styles.btnGhost}
              disabled={loadingMore || refreshing}
              onClick={() => setPage((p) => p + 1)}
            >
              {loadingMore ? "Se încarcă…" : "Încarcă mai multe"}
            </button>
          </div>
        )}
      </section>

      {filtersOpen && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-label="Filtre comenzi"
        >
          <div className={styles.modal}>
            <div className={styles.modalHead}>
              <div className={styles.modalTitle}>Filtre comenzi</div>
              <button
                type="button"
                className={styles.iconBtn}
                onClick={closeFiltersModal}
                aria-label="Închide"
              >
                ×
              </button>
            </div>

            <div className={styles.modalBody}>
              <label className={styles.modalField}>
                <span>Căutare</span>
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Produs sau număr comandă…"
                />
              </label>

              <div>
                <div className={styles.modalSectionLabel}>Status comandă</div>
                <div className={styles.statusPills}>
                  {STATUS_TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={`${styles.statusPill} ${
                        tab === t.key ? styles.statusPillActive : ""
                      }`}
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btnGhost}
                onClick={closeFiltersModal}
              >
                Anulează
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={applyFiltersFromModal}
              >
                Aplică filtre
              </button>
            </div>
          </div>
        </div>
      )}

      <ReturnRequestModal
        open={returnOpen}
        onClose={closeReturnModal}
        orderId={returnOrderId}
      />
    </>
  );
}